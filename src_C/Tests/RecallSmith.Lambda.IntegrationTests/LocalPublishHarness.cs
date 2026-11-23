using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>Loopback test storage and queue substitutes. Worker, manifest builder, and receipts are real.</summary>
public sealed class LocalPublishHarness(PostgresFixture db) : IS3DeckUploader, IContentArtifactsGenerator
{
  private static int _failNextDispatch;
  private readonly ConcurrentDictionary<string, byte[]> _objects = new(StringComparer.Ordinal);

  public static void Configure()
  {
    Environment.SetEnvironmentVariable("AUTOMATION_NOTIFY_QUEUE_URL", "test-notify");
    ContentPublishFailureEvents.TestSendSeam = _ => Task.CompletedTask;
    Publish.TestEnqueueSeam = new("test-publish", "test-content", _ =>
      Interlocked.Exchange(ref _failNextDispatch, 0) == 1 ? Task.FromException(new IOException("Test unconfirmed dispatch")) : Task.CompletedTask);
  }

  public static void FailNextDispatch() => Interlocked.Exchange(ref _failNextDispatch, 1);

  public byte[]? Read(string path) => _objects.GetValueOrDefault("content/" + path);

  public async Task<object> BuildAsync(string jobId)
  {
    var processor = new PublishJobProcessor(new JobRepository(), this, this);
    await processor.ProcessAsync(jobId, 1);
    if (!await processor.DeliverManifestAsync(jobId, async () =>
    {
      await using var conn = await db.OpenAsync();
      var manifest = await ManifestBuilder.BuildAsync(conn, "content", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
      _objects["content/manifest.json"] = Encoding.UTF8.GetBytes(manifest.Json);
    })) throw new InvalidOperationException("Manifest did not complete.");
    await using var conn = await db.OpenAsync();
    return await ContentCdnVerification.PrepareAsync(conn, jobId);
  }

  public async Task<object> RecordAsync(string jobId, JsonElement report)
  {
    await using var conn = await db.OpenAsync();
    return await ContentCdnVerification.RecordAsync(conn, jobId, report);
  }

  public Task<S3UploadResult> UploadAsync(string key, DeckExportData deck)
  {
    var bytes = JsonSerializer.SerializeToUtf8Bytes(deck, ContentJson.Options);
    _objects[key] = bytes;
    return Task.FromResult(new S3UploadResult { Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)), Bytes = bytes.LongLength });
  }

  public Task<S3UploadResult> UploadJsonAsync(string key, string json, string cacheControl) => throw new NotSupportedException();
  public Task<string> DownloadJsonAsync(string key) => throw new NotSupportedException();
  public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
}
