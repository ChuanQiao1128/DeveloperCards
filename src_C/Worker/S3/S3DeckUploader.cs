using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Worker.Content;

namespace RecallSmith.Lambda.Worker.S3;

public class S3DeckUploader : IS3DeckUploader
{
  /// <summary>
  /// 构建目录下的不可变对象（deck.json / package.json / chunks / patches）使用一年 immutable 缓存；
  /// manifest.json 不经过本类写入，不受影响。
  /// </summary>
  public const string ImmutableCacheControl = "public, max-age=31536000, immutable";

  private const string DefaultCacheControl = "public, max-age=300, s-maxage=300";

  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string? PremiumBucket = Environment.GetEnvironmentVariable("PREMIUM_BUCKET");

  private static AmazonS3Client? _s3;
  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  // Used by SnapStart runtime hooks
  public static void Reset()
  {
    var s3Client = _s3;
    _s3 = null;
    if (s3Client is not null) try { s3Client.Dispose(); } catch { /* best-effort */ }
  }

  /// <summary>
  /// 根据 s3Key 前缀判断使用哪个 bucket（与历史行为保持一致）
  /// </summary>
  private static string ResolveBucket(string s3Key)
  {
    var prefix = s3Key.Split('/')[0];
    var bucket = prefix switch
    {
      "premium" => PremiumBucket,
      _ => ContentBucket
    };

    if (string.IsNullOrEmpty(bucket))
    {
      throw new InvalidOperationException($"Missing bucket config for prefix: {prefix}");
    }

    return bucket;
  }

  public async Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data)
  {
    var bucket = ResolveBucket(s3Key);

    // 💡 核心优化：利用 /tmp 临时文件实现极低内存占用的流式序列化和上传
    var tmpPath = Path.Combine("/tmp", $"{Guid.NewGuid()}.json");

    try
    {
      // 1. 流式将 JSON 写入磁盘，避免在内存中拼接巨大的 JSON 字符串
      await using (var fs = new FileStream(tmpPath, FileMode.Create, FileAccess.Write))
      {
        await JsonSerializer.SerializeAsync(fs, data, ContentJson.Options);
      }

      var result = await VerifyAndHashAsync(tmpPath, data);

      // 2. 调用 SDK 的 FilePath 上传 (SDK 自动按 8MB 分块上传，极低内存消耗)
      var putRequest = new PutObjectRequest
      {
        BucketName = bucket,
        Key = s3Key,
        FilePath = tmpPath,
        ContentType = "application/json; charset=utf-8",
      };

      // 构建目录下的对象内容不可变（路径含 buildId），可放心长缓存
      putRequest.Headers.CacheControl = s3Key.Contains("/builds/", StringComparison.Ordinal)
        ? ImmutableCacheControl
        : DefaultCacheControl;

      await PutBuildAsync(putRequest, result);

      return result;
    }
    finally
    {
      // 3. 清理现场，防止 Lambda 实例复用导致磁盘爆满
      if (File.Exists(tmpPath))
      {
        File.Delete(tmpPath);
      }
    }
  }

  public async Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl)
  {
    var bucket = ResolveBucket(s3Key);
    var bytes = Encoding.UTF8.GetBytes(json);

    var putRequest = new PutObjectRequest
    {
      BucketName = bucket,
      Key = s3Key,
      InputStream = new MemoryStream(bytes),
      ContentType = "application/json; charset=utf-8",
    };
    putRequest.Headers.CacheControl = cacheControl;

    var result = new S3UploadResult
    {
      Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
      Bytes = bytes.LongLength,
    };
    await PutBuildAsync(putRequest, result);
    return result;
  }

  private static async Task PutBuildAsync(PutObjectRequest request, S3UploadResult expected)
  {
    // All build artifacts (including previews/chunks/patches) use the same immutable cache contract.
    var immutable = request.Key.Contains("/builds/", StringComparison.Ordinal)
      || request.Headers.CacheControl == ImmutableCacheControl;
    if (immutable) request.IfNoneMatch = "*";
    try
    {
      await S3().PutObjectAsync(request);
    }
    catch (AmazonS3Exception ex) when (immutable && ex.StatusCode == HttpStatusCode.PreconditionFailed)
    {
      // A retry may reuse exactly the uploaded bytes. Never replace a conflicting committed key.
      using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
      using var existing = await S3().GetObjectAsync(new GetObjectRequest
      { BucketName = request.BucketName, Key = request.Key }, deadline.Token);
      if (existing.ContentLength != expected.Bytes)
        throw new InvalidOperationException("Immutable build object has different bytes");
      using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
      var buffer = new byte[64 * 1024];
      long bytesRead = 0;
      int read;
      while ((read = await existing.ResponseStream.ReadAsync(buffer, deadline.Token)) > 0)
      {
        bytesRead += read;
        if (bytesRead > expected.Bytes) throw new InvalidOperationException("Immutable build object exceeds expected size");
        hash.AppendData(buffer, 0, read);
      }
      if (bytesRead != expected.Bytes || Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant() != expected.Sha256)
        throw new InvalidOperationException("Immutable build object has different SHA-256");
    }
  }

  public async Task<string> DownloadJsonAsync(string s3Key)
  {
    var bucket = ResolveBucket(s3Key);

    using var response = await S3().GetObjectAsync(bucket, s3Key);
    using var reader = new StreamReader(response.ResponseStream, Encoding.UTF8);
    return await reader.ReadToEndAsync();
  }

  internal static async Task<S3UploadResult> VerifyAndHashAsync(string path, DeckExportData data)
  {
    await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read);
    if (data.VerifyReviewedContent)
    {
      await ContentJson.VerifyReviewedArtifactAsync(fs, data);
      fs.Position = 0;
    }
    using var sha = SHA256.Create();
    var hash = await sha.ComputeHashAsync(fs);
    return new S3UploadResult
    {
      Sha256 = Convert.ToHexString(hash).ToLowerInvariant(),
      Bytes = fs.Length,
      ReviewedContentVerified = data.VerifyReviewedContent,
    };
  }
}
