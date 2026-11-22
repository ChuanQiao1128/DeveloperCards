using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

public sealed class ContentReleaseJournalTests
{
  private const string Bucket = "test-private-journals";
  private const string Owner = "journal-owner";
  private const string OtherOwner = "second-editor";
  private static readonly AuthContext Editor = new(new Dictionary<string, JsonElement>(),
    Owner, "editor", ["editor"], false, true, true);

  [Fact]
  public async Task PublicHandlerRejectsNonConsoleAndUnsupportedMethodsBeforeStorage()
  {
    AssertError(await ContentReleaseJournal.Handle(Request("GET"), new Res("test"),
      Editor with { IsAdmin = false, IsEditor = false }), 403, "FORBIDDEN");
    AssertError(await ContentReleaseJournal.Handle(Request("GET"), new Res("test"),
      Editor with { IsAgentClient = true }), 403, "JOURNAL_CONSOLE_ONLY");
    AssertError(await ContentReleaseJournal.Handle(Request("GET"), new Res("test"),
      Editor with { UserSub = null }), 403, "JOURNAL_CONSOLE_ONLY");
    AssertError(await ContentReleaseJournal.Handle(Request("POST"), new Res("test"), Editor),
      405, "METHOD_NOT_ALLOWED");
  }

  [Fact]
  public async Task OwnerScopesPartsAndPointersEvenWithAConflictingQueryOwner()
  {
    using var s3 = new ConditionalStore();
    var payload = Encoding.UTF8.GetBytes("私有发布日志");
    var part = Hash(payload);
    var ownerPrefix = ContentReleaseJournal.OwnerPrefix(Owner);
    var otherPrefix = ContentReleaseJournal.OwnerPrefix(OtherOwner);
    Assert.StartsWith("release-input/aws-saa-fundamentals/journals/", ownerPrefix);
    Assert.DoesNotContain(Owner, ownerPrefix);
    Assert.NotEqual(ownerPrefix, otherPrefix);

    Assert.True(Ok(await Send(s3, "PUT", part, Convert.ToBase64String(payload))).GetProperty("saved").GetBoolean());
    var ownerRevision = Ok(await Commit(s3, null, [part])).GetProperty("revision").GetString();
    var otherPointer = Ok(await Send(s3, "GET", subject: OtherOwner));
    Assert.Equal(JsonValueKind.Null, otherPointer.GetProperty("revision").ValueKind);
    Assert.Empty(otherPointer.GetProperty("parts").EnumerateArray());
    AssertError(await Send(s3, "GET", part, subject: OtherOwner, queryOwner: Owner), 409, "JOURNAL_PART_MISSING");
    AssertError(await Commit(s3, null, [part], OtherOwner), 409, "JOURNAL_PART_MISSING");

    Ok(await Send(s3, "PUT", part, Convert.ToBase64String(payload), OtherOwner, queryOwner: Owner));
    Ok(await Commit(s3, null, [part], OtherOwner));
    Assert.True(s3.Objects.ContainsKey($"{ownerPrefix}/parts/{part}.json"));
    Assert.True(s3.Objects.ContainsKey($"{otherPrefix}/parts/{part}.json"));
    Assert.Equal(ownerRevision, Ok(await Send(s3, "GET")).GetProperty("revision").GetString());
    Assert.Equal(payload, Convert.FromBase64String(Ok(await Send(s3, "GET", part)).GetProperty("data").GetString()!));
    Assert.Equal(4, s3.Objects.Count);
  }

  [Theory]
  [InlineData(HttpStatusCode.PreconditionFailed)]
  [InlineData(HttpStatusCode.Conflict)]
  public async Task PointerUsesConditionalCreateAndRejectsStaleUpdatesIncludingAfterArchive(HttpStatusCode conflict)
  {
    using var s3 = new ConditionalStore(conflict);
    var payload = new byte[ContentReleaseJournal.PartBytes];
    var part = Hash(payload);
    var encoded = Convert.ToBase64String(payload);
    Ok(await Send(s3, "PUT", part, encoded));
    Ok(await Send(s3, "PUT", part, encoded));
    Assert.Single(s3.Objects);
    Assert.Equal(payload, Convert.FromBase64String(Ok(await Send(s3, "GET", part)).GetProperty("data").GetString()!));

    var revision = Ok(await Commit(s3, null, [part, part])).GetProperty("revision").GetString();
    Assert.NotNull(revision);
    Assert.Equal(new[] { part, part }, Ok(await Send(s3, "GET")).GetProperty("parts")
      .EnumerateArray().Select(p => p.GetString()).ToArray());
    AssertError(await Commit(s3, null, []), 409, "JOURNAL_CHANGED");
    var archived = Ok(await Commit(s3, revision, [])).GetProperty("revision").GetString();
    Assert.NotEqual(revision, archived);
    AssertError(await Commit(s3, revision, [part]), 409, "JOURNAL_CHANGED");

    var reopened = Ok(await Commit(s3, archived, [part, part])).GetProperty("revision").GetString();
    Assert.NotEqual(revision, reopened);
    AssertError(await Commit(s3, revision, []), 409, "JOURNAL_CHANGED");
    Assert.Equal(reopened, Ok(await Send(s3, "GET")).GetProperty("revision").GetString());
  }

  [Fact]
  public async Task InvalidPartsAndPointersDoNotCreateStorageObjects()
  {
    using var s3 = new ConditionalStore();
    var bytes = Encoding.UTF8.GetBytes("release draft");
    var part = Hash(bytes);
    AssertError(await Send(s3, "GET", "../owner/active.json"), 400, "JOURNAL_PART_HASH");
    AssertError(await Send(s3, "PUT", part.ToUpperInvariant(), Convert.ToBase64String(bytes)), 400, "JOURNAL_PART_HASH");
    AssertError(await Send(s3, "PUT", part, "wrong format!"), 400, "JOURNAL_PART_ENCODING");
    AssertError(await Send(s3, "PUT", part, Convert.ToBase64String([1, 2, 3])), 400, "JOURNAL_PART_HASH");
    var oversized = Convert.ToBase64String(new byte[ContentReleaseJournal.PartBytes + 1]);
    AssertError(await Send(s3, "PUT", part, oversized), 413, "PAYLOAD_TOO_LARGE");
    AssertError(await Send(s3, "PUT", body: "{"), 400, "JOURNAL_JSON_INVALID");
    AssertError(await Commit(s3, "*", []), 400, "JOURNAL_POINTER_INVALID");
    AssertError(await Commit(s3, null, Enumerable.Repeat(part, ContentReleaseJournal.MaxParts + 1).ToArray()),
      400, "JOURNAL_POINTER_INVALID");
    Assert.Empty(s3.Objects);
  }

  [Fact]
  public async Task MissingAndCorruptPartsFailClosedWithoutRepointingTheJournal()
  {
    using var s3 = new ConditionalStore();
    var good = Encoding.UTF8.GetBytes("reviewed release");
    var part = Hash(good);
    Ok(await Send(s3, "PUT", part, Convert.ToBase64String(good)));
    var revision = Ok(await Commit(s3, null, [part])).GetProperty("revision").GetString();
    var missing = Hash([9]);
    AssertError(await Commit(s3, revision, [missing]), 409, "JOURNAL_PART_MISSING");
    AssertError(await Send(s3, "GET", missing), 409, "JOURNAL_PART_MISSING");

    var partKey = $"{ContentReleaseJournal.OwnerPrefix(Owner)}/parts/{part}.json";
    s3.Objects[partKey] = Encoding.UTF8.GetBytes("changed after storage");
    AssertError(await Send(s3, "GET", part), 400, "JOURNAL_PART_HASH");
    Assert.Equal(revision, Ok(await Send(s3, "GET")).GetProperty("revision").GetString());
  }

  private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

  private static LambdaRequest Request(string method, string? part = null, string? body = null, string? queryOwner = null)
  {
    var query = new Dictionary<string, string>();
    if (part is not null) query.Add("part", part);
    if (queryOwner is not null) query.Add("owner", queryOwner);
    return new LambdaRequest(JsonSerializer.SerializeToElement(new {
      rawPath = "/api/v1/authoring/release/journal", requestContext = new { http = new { method } },
      queryStringParameters = query, body, isBase64Encoded = false
    }));
  }

  private static Task<APIGatewayProxyResponse> Send(ConditionalStore store, string method, string? part = null,
    string? body = null, string subject = Owner, string? queryOwner = null) =>
    ContentReleaseJournal.HandleStorage(store, Bucket, subject, Request(method, part, body, queryOwner), new Res("test"));

  private static Task<APIGatewayProxyResponse> Commit(ConditionalStore store, string? revision, string[] parts,
    string subject = Owner) =>
    Send(store, "PUT", body: JsonSerializer.Serialize(new { revision, parts }), subject: subject);

  private static JsonElement Ok(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, response.Body);
    Assert.Equal("private, no-store", response.Headers["cache-control"]);
    return JsonSerializer.Deserialize<JsonElement>(response.Body);
  }

  private static void AssertError(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, response.Body);
    Assert.Equal(code, JsonSerializer.Deserialize<JsonElement>(response.Body).GetProperty("error").GetProperty("code").GetString());
  }

  private sealed class ConditionalStore(HttpStatusCode pointerConflict = HttpStatusCode.PreconditionFailed)
    : AmazonS3Client(new AnonymousAWSCredentials(), new AmazonS3Config {
      ServiceURL = "http://127.0.0.1:1", ForcePathStyle = true, AuthenticationRegion = "ap-southeast-2", MaxErrorRetry = 0
    })
  {
    public readonly Dictionary<string, byte[]> Objects = new();

    public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest request, CancellationToken cancellationToken = default)
    {
      var bytes = Read(request.BucketName, request.Key);
      return Task.FromResult(new GetObjectResponse {
        ContentLength = bytes.Length, ETag = ETag(bytes), ResponseStream = new MemoryStream(bytes)
      });
    }

    public override Task<GetObjectMetadataResponse> GetObjectMetadataAsync(GetObjectMetadataRequest request,
      CancellationToken cancellationToken = default)
    {
      var bytes = Read(request.BucketName, request.Key);
      return Task.FromResult(new GetObjectMetadataResponse { ContentLength = bytes.Length, ETag = ETag(bytes) });
    }

    public override Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request, CancellationToken cancellationToken = default)
    {
      Assert.Equal(Bucket, request.BucketName);
      var exists = Objects.TryGetValue(request.Key, out var existing);
      Assert.True((request.IfNoneMatch == "*") != (request.IfMatch is not null), "Journal writes must specify one precondition");
      var duplicate = request.IfNoneMatch == "*" && exists;
      var stale = request.IfMatch is not null && (!exists || request.IfMatch != ETag(existing!));
      if (duplicate || stale)
        throw S3Error(request.ContentType == "application/json" ? pointerConflict : HttpStatusCode.PreconditionFailed);

      var bytes = request.InputStream is { } stream ? ReadStream(stream) : Encoding.UTF8.GetBytes(request.ContentBody);
      Objects[request.Key] = bytes;
      return Task.FromResult(new PutObjectResponse { ETag = ETag(bytes) });
    }

    private byte[] Read(string bucket, string key)
    {
      Assert.Equal(Bucket, bucket);
      return Objects.TryGetValue(key, out var bytes) ? bytes : throw S3Error(HttpStatusCode.NotFound);
    }

    private static byte[] ReadStream(Stream source)
    {
      using var buffer = new MemoryStream();
      source.CopyTo(buffer);
      return buffer.ToArray();
    }

    private static string ETag(byte[] bytes) => $"\"{Hash(bytes)[..32]}\"";
    private static AmazonS3Exception S3Error(HttpStatusCode code) => new("In-memory S3 condition") { StatusCode = code };
  }
}
