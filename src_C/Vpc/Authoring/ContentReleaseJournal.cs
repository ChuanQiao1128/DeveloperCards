using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class ContentReleaseJournal
{
  public const string Route = "/api/v1/authoring/release/journal";
  public const int PartBytes = 720_000, MaxParts = 45;
  private static readonly Dictionary<string, string> PrivateHeaders = new() { ["cache-control"] = "private, no-store" };
  private sealed record Pointer(string Nonce, string[] Parts);

  internal static string OwnerPrefix(string subject) => $"release-input/{ContentRelease.DeckSlug}/journals/{ContentRelease.Hash(subject)}";
  internal static bool ValidHash(string? value) =>
    value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
  private static string PartKey(string prefix, string sha256) => $"{prefix}/parts/{sha256}.json";

  public static async Task<APIGatewayProxyResponse> Handle(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (auth.IsAgentClient || string.IsNullOrEmpty(auth.UserSub))
      return Helpers.ErrorEnvelope(res, 403, "JOURNAL_CONSOLE_ONLY", "Use the normal authorized Console session");
    if (req.Method is not ("GET" or "PUT")) return res.MethodNotAllowed("Method not allowed");

    await using (var conn = await Pg.OpenConnectionOrNullAsync())
    {
      if (conn is null) return Helpers.ConfigError(res, "Missing PG configuration");
      if (!await ContentRelease.Applies(conn, 15)) return res.NotFound("AWS Basics deck is unavailable");
      deny = await Helpers.RequireDeckWrite(conn, auth.UserSub, 15, auth.IsSuperAdmin, res);
      if (deny is not null) return deny;
    }
    var bucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    if (string.IsNullOrEmpty(bucket)) return Helpers.ConfigError(res, "Missing content bucket");
    return await HandleStorage(ManifestBuilder.S3(), bucket, auth.UserSub, req, res);
  }

  internal static async Task<APIGatewayProxyResponse> HandleStorage(
    IAmazonS3 s3, string bucket, string subject, LambdaRequest req, Res res)
  {
    var prefix = OwnerPrefix(subject);
    try
    {
      return req.Query.TryGetValue("part", out var part)
        ? await HandlePart(s3, bucket, prefix, part, req, res)
        : await HandlePointer(s3, bucket, $"{prefix}/active.json", prefix, req, res);
    }
    catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.NotFound)
    {
      return Helpers.ErrorEnvelope(res, 409, "JOURNAL_PART_MISSING", "A saved part is missing. Reload the release journal before continuing.");
    }
    catch (JsonException)
    {
      return res.BadRequest("JOURNAL_JSON_INVALID", "The release journal record is invalid");
    }
  }

  private static async Task<APIGatewayProxyResponse> HandlePart(
    IAmazonS3 s3, string bucket, string prefix, string part, LambdaRequest req, Res res)
  {
    if (!ValidHash(part)) return res.BadRequest("JOURNAL_PART_HASH", "A lowercase SHA-256 is required");
    var key = PartKey(prefix, part);
    if (req.Method == "GET")
    {
      using var obj = await s3.GetObjectAsync(bucket, key, RequestBudget.Token);
      if (obj.ContentLength is < 1 or > PartBytes) return res.PayloadTooLarge();
      var bytes = new byte[(int)obj.ContentLength];
      await obj.ResponseStream.ReadExactlyAsync(bytes, RequestBudget.Token);
      if (Convert.ToHexStringLower(SHA256.HashData(bytes)) != part)
        return res.BadRequest("JOURNAL_PART_HASH", "A saved part did not match its checksum");
      return res.Raw(200, new { data = Convert.ToBase64String(bytes) }, PrivateHeaders);
    }

    if (req.RawBody.Length is 0 or > (PartBytes / 3 * 4)) return res.PayloadTooLarge();
    byte[] data;
    try { data = Convert.FromBase64String(req.RawBody); }
    catch (FormatException) { return res.BadRequest("JOURNAL_PART_ENCODING", "Expected a Base64 journal part"); }
    if (data.Length is < 1 or > PartBytes) return res.PayloadTooLarge();
    if (Convert.ToHexStringLower(SHA256.HashData(data)) != part)
      return res.BadRequest("JOURNAL_PART_HASH", "The part did not match its checksum");

    using var input = new MemoryStream(data);
    try
    {
      await s3.PutObjectAsync(new PutObjectRequest {
        BucketName = bucket, Key = key, InputStream = input,
        ContentType = "application/octet-stream", IfNoneMatch = "*"
      }, RequestBudget.Token);
    }
    catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.PreconditionFailed)
    {
      // This owner already saved the same content-addressed bytes.
    }
    return res.Raw(200, new { saved = true }, PrivateHeaders);
  }

  private static async Task<APIGatewayProxyResponse> HandlePointer(
    IAmazonS3 s3, string bucket, string key, string prefix, LambdaRequest req, Res res)
  {
    if (req.Method == "GET")
    {
      try
      {
        using var obj = await s3.GetObjectAsync(bucket, key, RequestBudget.Token);
        if (obj.ContentLength is < 1 or > 4096) return res.PayloadTooLarge();
        var pointer = await JsonSerializer.DeserializeAsync<Pointer>(obj.ResponseStream, cancellationToken: RequestBudget.Token);
        if (pointer?.Parts is null || pointer.Parts.Length > MaxParts || pointer.Parts.Any(p => !ValidHash(p)))
          return res.BadRequest("JOURNAL_JSON_INVALID", "The saved journal record is invalid");
        return res.Raw(200, new { revision = obj.ETag, parts = pointer.Parts }, PrivateHeaders);
      }
      catch (AmazonS3Exception e) when (e.StatusCode == HttpStatusCode.NotFound)
      {
        return res.Raw(200, new { revision = (string?)null, parts = Array.Empty<string>() }, PrivateHeaders);
      }
    }

    if (req.RawBody.Length is 0 or > 4096) return res.PayloadTooLarge();
    using var body = JsonDocument.Parse(req.RawBody);
    var root = body.RootElement;
    if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("revision", out var revision) ||
        revision.ValueKind is not (JsonValueKind.String or JsonValueKind.Null) ||
        revision.ValueKind == JsonValueKind.String && !ValidRevision(revision.GetString()) ||
        !root.TryGetProperty("parts", out var entries) || entries.ValueKind != JsonValueKind.Array ||
        entries.GetArrayLength() > MaxParts || entries.EnumerateArray().Any(p => p.ValueKind != JsonValueKind.String || !ValidHash(p.GetString())))
      return res.BadRequest("JOURNAL_POINTER_INVALID", "The journal revision or part inventory is invalid");
    var parts = entries.EnumerateArray().Select(p => p.GetString()!).ToArray();
    await Task.WhenAll(parts.Distinct().Select(part => s3.GetObjectMetadataAsync(bucket, PartKey(prefix, part), RequestBudget.Token)));

    // A new nonce gives even an empty pointer a unique revision across open/archive cycles.
    var put = new PutObjectRequest { BucketName = bucket, Key = key, ContentType = "application/json",
      ContentBody = JsonSerializer.Serialize(new Pointer(Guid.NewGuid().ToString("N"), parts)) };
    if (revision.ValueKind == JsonValueKind.Null) put.IfNoneMatch = "*";
    else put.IfMatch = revision.GetString();
    try
    {
      var saved = await s3.PutObjectAsync(put, RequestBudget.Token);
      return res.Raw(200, new { revision = saved.ETag, parts }, PrivateHeaders);
    }
    catch (AmazonS3Exception e) when (e.StatusCode is HttpStatusCode.PreconditionFailed or HttpStatusCode.Conflict)
    {
      return Helpers.ErrorEnvelope(res, 409, "JOURNAL_CHANGED", "The cloud release journal changed. Reload and reconcile its actions before continuing.");
    }
  }

  internal static bool ValidRevision(string? value) =>
    value is { Length: 34 } && value[0] == '"' && value[^1] == '"' &&
    value[1..^1].All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
}
