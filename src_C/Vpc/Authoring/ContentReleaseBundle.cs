using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class ContentReleaseBundle
{
  public const string Route = "/api/v1/authoring/release/bundle";
  public const int MaxBytes = 3_000_000;
  private const long DeckId = 15;
  private static readonly UTF8Encoding StrictUtf8 = new(false, true);
  private static readonly Dictionary<string, string> PrivateHeaders = new() { ["cache-control"] = "private, no-store" };

  private static bool IsSha256(string? value) =>
    value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

  internal static string ObjectKey(string sha256) => $"release-input/{ContentRelease.DeckSlug}/{sha256}.json";

  public static async Task<APIGatewayProxyResponse> Handle(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (auth.IsAgentClient) return Helpers.ErrorEnvelope(res, 403, "AGENT_CLIENT_FORBIDDEN", "Use the normal authorized Console session");
    if (req.Method is not ("GET" or "POST")) return res.MethodNotAllowed("Method not allowed");

    var sha256 = req.Query.GetValueOrDefault("sha256");
    if (!IsSha256(sha256)) return res.BadRequest("INVALID_BUNDLE_HASH", "A lowercase SHA-256 is required");
    var bytes = 0;
    if (req.Method == "POST" &&
        (!int.TryParse(req.Query.GetValueOrDefault("bytes"), NumberStyles.None, CultureInfo.InvariantCulture, out bytes) ||
         bytes is < 1 or > MaxBytes))
      return res.BadRequest("INVALID_BUNDLE_LENGTH", $"Bundle size must be between 1 and {MaxBytes} bytes");

    var bucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    if (string.IsNullOrEmpty(bucket)) return Helpers.ConfigError(res, "Missing content bucket");

    await using (var conn = await Pg.OpenConnectionOrNullAsync())
    {
      if (conn is null) return Helpers.ConfigError(res, "Missing PG configuration");
      if (!await ContentRelease.Applies(conn, DeckId)) return res.NotFound("AWS Basics deck is unavailable");
      deny = await Helpers.RequireDeckWrite(conn, auth.UserSub, DeckId, auth.IsSuperAdmin, res);
      if (deny is not null) return deny;
    }

    var s3 = ManifestBuilder.S3();
    var key = ObjectKey(sha256!);
    if (req.Method == "POST")
    {
      var upload = CreateUploadRequest(bucket, sha256!, bytes, DateTime.UtcNow.AddMinutes(10));
      var url = await s3.GetPreSignedURLAsync(upload);
      return res.Raw(200, new { url }, PrivateHeaders);
    }

    try
    {
      using var obj = await s3.GetObjectAsync(bucket, key, RequestBudget.Token);
      if (obj.ContentLength is < 1 or > MaxBytes) return res.PayloadTooLarge();
      var body = new byte[(int)obj.ContentLength];
      await obj.ResponseStream.ReadExactlyAsync(body, RequestBudget.Token);
      if (!string.Equals(Convert.ToHexStringLower(SHA256.HashData(body)), sha256, StringComparison.Ordinal))
        return res.BadRequest("BUNDLE_HASH_MISMATCH", "The S3 object differs from the frozen bundle hash");
      StrictUtf8.GetCharCount(body);
      var response = res.Raw(200, Convert.ToBase64String(body), PrivateHeaders);
      response.IsBase64Encoded = true;
      return response;
    }
    catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.NotFound)
    {
      return res.NotFound("No S3 release bundle has that hash");
    }
    catch (DecoderFallbackException)
    {
      return res.BadRequest("INVALID_BUNDLE_ENCODING", "The S3 bundle must be UTF-8");
    }
  }

  internal static GetPreSignedUrlRequest CreateUploadRequest(string bucket, string sha256, int bytes, DateTime expires)
  {
    var request = new GetPreSignedUrlRequest
    {
      BucketName = bucket,
      Key = ObjectKey(sha256),
      Verb = HttpVerb.PUT,
      Protocol = Protocol.HTTPS,
      ContentType = "application/json",
      Expires = expires
    };
    request.Headers.ContentLength = bytes;
    request.Headers["If-None-Match"] = "*";
    request.Headers["x-amz-checksum-sha256"] = Convert.ToBase64String(Convert.FromHexString(sha256));
    return request;
  }
}
