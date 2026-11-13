using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Publish enqueue resilience (CBE-15) against a real Postgres, reaching the enqueue path through
/// the internal <see cref="Publish.EnqueueSeam"/> so no AWS client is ever built and PUBLISH_JOB_QUEUE_URL
/// stays unset. Covers ambiguous SQS results without state downgrades, the concurrent-publish invariant
/// (exactly one active job), the stale-active-row 409, the 15-minute resume, and the message payload.
/// Every test sets the seam in a try and resets it to null in a finally.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishEnqueueResilienceTests
{
  private readonly PostgresFixture _db;
  public PublishEnqueueResilienceTests(PostgresFixture db) => _db = db;

  private const string PublishPath = "/api/v1/authoring/publish";
  private const string SeamQueueUrl = "https://sqs.test/000000000000/f14";
  private const string SeamBucket = "it-f14-bucket";

  private static string Slug(string tag) => $"it-f14-{tag}-{Guid.NewGuid():N}";
  private static string NewSub() => $"it-f14-adm-{Guid.NewGuid():N}";

  private static JsonElement Event(string sub, string body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = PublishPath,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = sub,
              ["cognito:groups"] = new[] { "super_admin" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> PublishAsync(long deckId, string? sub = null, string? note = null)
  {
    var req = new LambdaRequest(Event(sub ?? NewSub(), JsonSerializer.Serialize(new { deckId, note })));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    return await Publish.HandleAuthoringPublish(req, res, auth);
  }

  /// <summary>A free deck (deck_type 1) with one plain (non-MCQ) Q/A card, so the pre-enqueue gate passes.</summary>
  private async Task<long> SeedFreeDeckWithCardAsync(string tag)
  {
    await using var conn = await _db.OpenAsync();
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author, deck_type) values ($1,$2,$3,1) returning id",
      [Slug(tag), "f14 deck", "tests"]);
    var deckId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck) values ($1,$2,$3,$4,$5)",
      [deckId, $"uid-{Guid.NewGuid():N}", "q", "a", 1]);
    return deckId;
  }

  private async Task<List<Dictionary<string, object?>>> ActiveRowsAsync(long deckId) =>
    await _db.QueryAsync(
      "select job_id as \"jobId\", status from deck_publishes where deck_id = $1 and status in ('PENDING','PROCESSING')",
      deckId);

  private static string? DataJobId(APIGatewayProxyResponse resp)
  {
    using var doc = JsonDocument.Parse(resp.Body ?? "{}");
    return doc.RootElement.GetProperty("data").GetProperty("jobId").GetString();
  }

  private static string? ErrorCode(APIGatewayProxyResponse resp)
  {
    using var doc = JsonDocument.Parse(resp.Body ?? "{}");
    return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
  }

  private static string AssertDispatchUnconfirmed(APIGatewayProxyResponse response)
  {
    Assert.Equal(503, response.StatusCode);
    using var doc = JsonDocument.Parse(response.Body);
    var root = doc.RootElement;
    Assert.False(root.GetProperty("success").GetBoolean());
    Assert.Equal("PUBLISH_DISPATCH_UNCONFIRMED", root.GetProperty("error").GetProperty("code").GetString());
    var data = root.GetProperty("data");
    Assert.Equal("dispatch_unconfirmed", data.GetProperty("outcome").GetString());
    Assert.False(string.IsNullOrWhiteSpace(data.GetProperty("buildId").GetString()));
    return Assert.IsType<string>(data.GetProperty("jobId").GetString());
  }

  // ---- ambiguous send results ----------------------------------------------------------------

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task SendFailure_LeavesPendingJob_WithStableUnconfirmedIdentity(bool acceptedResponseLost)
  {
    var deckId = await SeedFreeDeckWithCardAsync("sqsfail");
    string? acceptedJobId = null;
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, request =>
    {
      if (acceptedResponseLost)
      {
        using var message = JsonDocument.Parse(request.MessageBody);
        acceptedJobId = message.RootElement.GetProperty("jobId").GetString();
        throw new TimeoutException("accepted, but response was lost");
      }
      throw new InvalidOperationException("send result unavailable");
    });
    APIGatewayProxyResponse response;
    try
    {
      response = await PublishAsync(deckId);
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    var row = Assert.Single(await _db.QueryAsync("select job_id, status from deck_publishes where deck_id = $1", deckId));
    Assert.Equal("PENDING", row["status"]);
    var jobId = AssertDispatchUnconfirmed(response);
    Assert.Equal(jobId, row["job_id"]);
    if (acceptedResponseLost) Assert.Equal(acceptedJobId, jobId);
  }

  [Theory]
  [InlineData("PROCESSING")]
  [InlineData("SUCCESS")]
  public async Task SendResponseLost_AfterWorkerAdvances_PreservesWorkerStatus(string status)
  {
    var deckId = await SeedFreeDeckWithCardAsync("advanced");
    string? sentJobId = null;
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, async request =>
    {
      using var message = JsonDocument.Parse(request.MessageBody);
      sentJobId = message.RootElement.GetProperty("jobId").GetString();
      await using var conn = await _db.OpenAsync();
      await DbUtil.ExecuteAsync(conn, null,
        "update deck_publishes set status = $2, updated_at = now() where job_id = $1", [sentJobId, status]);
      throw new TimeoutException("worker received message, but send response was lost");
    });
    APIGatewayProxyResponse response;
    try
    {
      response = await PublishAsync(deckId);
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    var row = Assert.Single(await _db.QueryAsync("select job_id, status from deck_publishes where deck_id = $1", deckId));
    Assert.Equal(sentJobId, row["job_id"]);
    Assert.Equal(status, row["status"]);
    Assert.Equal(sentJobId, AssertDispatchUnconfirmed(response));
  }

  [Fact]
  public async Task RetryUnconfirmedPending_RedeliversSameJob_WithOriginalMetadata()
  {
    var deckId = await SeedFreeDeckWithCardAsync("retry");
    var actor = NewSub();
    var sent = new List<string>();
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, request =>
    {
      sent.Add(request.MessageBody);
      if (sent.Count == 1) throw new TimeoutException("response lost");
      return Task.CompletedTask;
    });
    try
    {
      var jobId = AssertDispatchUnconfirmed(await PublishAsync(deckId, actor, "original note"));
      Assert.Equal(200,(await PublishAsync(deckId,NewSub(),"lease-held")).StatusCode);
      Assert.Single(sent);
      await _db.QueryAsync("update publish_dispatch set lease_until=now()-interval '1 second' where job_id=$1",jobId);
      var retry = await PublishAsync(deckId, NewSub(), "retry note");
      Assert.Equal(200, retry.StatusCode);
      Assert.Equal(jobId, DataJobId(retry));
      Assert.Equal(2, sent.Count);
      Assert.Equal(sent[0], sent[1]);
      using var message = JsonDocument.Parse(sent[1]);
      Assert.Equal(actor, message.RootElement.GetProperty("adminSub").GetString());
      Assert.Equal("original note", message.RootElement.GetProperty("note").GetString());
      var row = Assert.Single(await _db.QueryAsync("select job_id, status from deck_publishes where deck_id = $1", deckId));
      Assert.Equal(jobId, row["job_id"]);
      Assert.Equal("PENDING", row["status"]);
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }
  }

  // ---- concurrency invariant ------------------------------------------------------------------

  [Fact]
  public async Task ConcurrentPublishes_LeaveExactlyOneActiveJob()
  {
    var deckId = await SeedFreeDeckWithCardAsync("conc");

    Func<SendMessageRequest, Task> send = _ => Task.CompletedTask;
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, send);
    List<APIGatewayProxyResponse> responses;
    try
    {
      responses = (await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => PublishAsync(deckId)))).ToList();
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    // Exactly one active row for the deck.
    var active = await ActiveRowsAsync(deckId);
    Assert.Single(active);
    var activeJobId = Convert.ToString(active[0]["jobId"], CultureInfo.InvariantCulture);

    var ok = responses.Where(r => r.StatusCode == 200).ToList();
    Assert.NotEmpty(ok);

    // Every success carries the active row's job id.
    foreach (var r in ok) Assert.Equal(activeJobId, DataJobId(r));

    // Every non-success is a 409 PUBLISH_IN_PROGRESS.
    foreach (var r in responses.Where(r => r.StatusCode != 200))
    {
      Assert.Equal(409, r.StatusCode);
      Assert.Equal("PUBLISH_IN_PROGRESS", ErrorCode(r));
    }
  }

  // ---- stale active row -----------------------------------------------------------------------

  [Fact]
  public async Task StaleActiveRow_BlocksNewPublish_With409PublishInProgress()
  {
    var deckId = await SeedFreeDeckWithCardAsync("stale");

    // A PENDING row older than the 15-minute dedupe window: the dedupe misses it, but the
    // partial unique index (uq_deck_publishes_active) still forbids a second active row.
    await using (var conn = await _db.OpenAsync())
    {
      var slug = Convert.ToString(
        await DbUtil.ExecuteScalarAsync(conn, null, "select slug from decks where id = $1", [deckId]),
        CultureInfo.InvariantCulture);
      await DbUtil.ExecuteAsync(conn, null,
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, updated_at) values ($1,$2,$3,$4,$5,'PENDING', now() - interval '20 minutes')",
        [deckId, slug, "b-stale", "content/b-stale", Guid.NewGuid().ToString()]);
    }

    var calls = 0;
    Func<SendMessageRequest, Task> send = _ => { Interlocked.Increment(ref calls); return Task.CompletedTask; };
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, send);
    try
    {
      var resp = await PublishAsync(deckId);
      Assert.Equal(409, resp.StatusCode);
      Assert.Equal("PUBLISH_IN_PROGRESS", ErrorCode(resp));
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    Assert.Equal(0, calls);
  }

  // ---- resume within window -------------------------------------------------------------------

  [Fact]
  public async Task RepeatPublish_WithinWindow_RedeliversPendingJob()
  {
    var deckId = await SeedFreeDeckWithCardAsync("resume");

    var calls = 0;
    Func<SendMessageRequest, Task> send = _ => { Interlocked.Increment(ref calls); return Task.CompletedTask; };
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, send);
    try
    {
      var first = await PublishAsync(deckId);
      Assert.Equal(200, first.StatusCode);
      var firstJobId = DataJobId(first);

      var second = await PublishAsync(deckId);
      Assert.Equal(200, second.StatusCode);
      Assert.Equal(firstJobId, DataJobId(second));
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    // A confirmed wake-up is not multiplied by an immediate duplicate request.
    Assert.Equal(1, calls);
  }

  [Fact]
  public async Task RepeatProcessingPublish_ResumesWithoutRedelivery()
  {
    var deckId = await SeedFreeDeckWithCardAsync("processing");
    var calls = 0;
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, _ => { calls++; return Task.CompletedTask; });
    try
    {
      var jobId = DataJobId(await PublishAsync(deckId));
      await using var conn = await _db.OpenAsync();
      await DbUtil.ExecuteAsync(conn, null, "update deck_publishes set status = 'PROCESSING' where job_id = $1", [jobId]);
      var retry = await PublishAsync(deckId);
      Assert.Equal(200, retry.StatusCode);
      Assert.Equal(jobId, DataJobId(retry));
      Assert.Equal(1, calls);
      Assert.Equal("PROCESSING", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId));
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }
  }

  // ---- message payload ------------------------------------------------------------------------

  [Fact]
  public async Task PublishedMessage_CarriesJobAndDeck()
  {
    var deckId = await SeedFreeDeckWithCardAsync("msg");

    SendMessageRequest? captured = null;
    Func<SendMessageRequest, Task> send = req => { captured = req; return Task.CompletedTask; };
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, send);
    string? responseJobId;
    try
    {
      var resp = await PublishAsync(deckId);
      Assert.Equal(200, resp.StatusCode);
      responseJobId = DataJobId(resp);
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    Assert.NotNull(captured);
    Assert.Equal(SeamQueueUrl, captured!.QueueUrl);

    using var body = JsonDocument.Parse(captured.MessageBody);
    Assert.Equal(responseJobId, body.RootElement.GetProperty("jobId").GetString());
    Assert.Equal(deckId, body.RootElement.GetProperty("deckId").GetInt64());
  }
}
