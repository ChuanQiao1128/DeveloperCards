using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class ReviewedBatchPublishTests(PostgresFixture db)
{
  private static readonly AuthContext Admin = AutomationTestKit.Ctx("reviewed-batch-publisher", agent: false);
  private static object Card(string stableUid, int orderInDeck, int expectedVersion, string question) =>
    new { stableUid, orderInDeck, expectedVersion, question, difficulty = 2, explanation = "Answer.\n\nReason.",
      codeSnippet = "", codeLanguage = "", realWorldUsage = "", topic = "",
      source = (object?)null, frontHelp = (object?)null, translations = (object?)null,
      mcq = (object?)null, teaching = (object?)null, tags = (object?)null };

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, response.Body);
    return JsonDocument.Parse(response.Body).RootElement.GetProperty("data").Clone();
  }

  private static Task<APIGatewayProxyResponse> CallPublish(long id, object body, string? mode = null, AuthContext? actor = null)
  {
    var request = new LambdaRequest(JsonSerializer.SerializeToElement(new {
      rawPath = "/api/v1/authoring/publish", requestContext = new { http = new { method = "POST" } },
      queryStringParameters = mode is null ? null : new { mode }, body = JsonSerializer.Serialize(body),
    }));
    return Publish.HandleAuthoringPublish(request, new Res("reviewed-batch"), actor ?? Admin);
  }

  private static async Task<JsonElement> Baseline(long id) =>
    Data(await CallPublish(id, new { deckId = id }, "reviewed-batch-preview")).GetProperty("baseline");
  private static Task<APIGatewayProxyResponse> Import(long id, string slug, string operationId, JsonElement baseline, params object[] cards) =>
    AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", "/api/v1/authoring/cards/import",
      new { deckId = id, expectedDeckSlug = slug, operationId, reviewedPublishBaseline = baseline, cards }, Admin);

  [Fact]
  public async Task FirstReleaseAndMixedUpdateShareSnapshotAndRetry()
  {
    var (id, slug) = await AutomationTestKit.NewDeckAsync(db, "reviewed-batch");
    var sends = 0;
    Publish.TestEnqueueSeam = new("queue", "bucket", _ => { sends++; return Task.CompletedTask; });
    var oldQueue = Environment.GetEnvironmentVariable("AUTOMATION_NOTIFY_QUEUE_URL");
    Environment.SetEnvironmentVariable("AUTOMATION_NOTIFY_QUEUE_URL", "test-notify");
    ContentPublishFailureEvents.TestSendSeam = _ => Task.CompletedTask;
    try
    {
      var firstOp = Guid.NewGuid().ToString("D");
      var first = await Baseline(id);
      Assert.Equal(JsonValueKind.Null, first.GetProperty("liveBuildId").ValueKind);
      Data(await Import(id, slug, firstOp, first, Card("first-card", 10, 0, "First question")));
      var body = new { deckId = id, reviewedImportOperationId = firstOp };
      var firstJob = Data(await CallPublish(id, body)).GetProperty("jobId").GetString()!;
      Assert.Equal(firstJob, Data(await CallPublish(id, body)).GetProperty("jobId").GetString());
      Assert.Equal(1, sends);

      var repo = new JobRepository();
      Assert.True(await repo.TryAcquireJobAsync(firstJob));
      var sha = new string('a', 64);
      await using var conn = await db.OpenAsync();
      await using (var tx = await conn.BeginTransactionAsync())
      {
        await DbUtil.ExecuteAsync(conn, tx, "update deck_publishes set content_sha256=$2 where job_id=$1", [firstJob, sha]);
        await PublishCdnVerification.StageAsync(conn, tx, firstJob, sha, 1);
        await tx.CommitAsync();
      }
      await repo.CompleteJobAsync(firstJob, 1);
      await db.QueryAsync("update publish_manifest_delivery set state='delivered' where job_id=$1", firstJob);
      Assert.Equal(JsonValueKind.Null, (await Baseline(id)).ValueKind);
      var build = (string)(await db.ScalarAsync("select live_build_id from decks where id=$1", id))!;
      var target = JsonSerializer.SerializeToElement(await ContentCdnVerification.PrepareAsync(conn, firstJob));
      Assert.Equal(slug, target.GetProperty("slug").GetString());
      Assert.Equal(build, target.GetProperty("buildId").GetString());
      Assert.True(JsonSerializer.SerializeToElement(await ContentCdnVerification.RecordAsync(conn, firstJob,
        JsonSerializer.SerializeToElement(new { buildId = build, sha256 = sha }))).GetProperty("recorded").GetBoolean());

      var next = await Baseline(id);
      var nextOp = Guid.NewGuid().ToString("D");
      var imported = Data(await Import(id, slug, nextOp, next,
        Card("first-card", 10, 1, "Changed question"), Card("second-card", 20, 0, "Second question")));
      Assert.Equal(1, imported.GetProperty("created").GetInt32());
      Assert.Equal(1, imported.GetProperty("updated").GetInt32());
      var nextJob = Data(await CallPublish(id, new { deckId = id, reviewedImportOperationId = nextOp })).GetProperty("jobId").GetString();
      Assert.NotEqual(firstJob, nextJob);
      Assert.Equal(2, sends);
      Assert.True(await repo.TryAcquireJobAsync(nextJob!));
      await db.QueryAsync("update decks set live_build_id=null where id=$1", id);
      await Assert.ThrowsAsync<RecallSmith.Lambda.Worker.BusinessException>(() => repo.CompleteJobAsync(nextJob!, 2));
      Assert.Null(await db.ScalarAsync("select live_build_id from decks where id=$1", id));
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
      ContentPublishFailureEvents.TestSendSeam = null;
      Environment.SetEnvironmentVariable("AUTOMATION_NOTIFY_QUEUE_URL", oldQueue);
    }
  }

  [Fact]
  public async Task OutsideEditsBlockBeforeImportAndBeforeQueueing()
  {
    var (id, slug) = await AutomationTestKit.NewDeckAsync(db, "reviewed-batch");
    Publish.TestEnqueueSeam = new("queue", "bucket", _ => throw new InvalidOperationException("Unexpected publish"));
    try
    {
      var baseline = await Baseline(id);
      await db.QueryAsync("update decks set title='Other edit' where id=$1", id);
      var denied = await Import(id, slug, Guid.NewGuid().ToString("D"), baseline, Card("first-card", 10, 0, "First question"));
      Assert.Equal(409, denied.StatusCode);
      Assert.Empty(await db.QueryAsync("select id from cards where deck_id=$1", id));

      var operation = Guid.NewGuid().ToString("D");
      Data(await Import(id, slug, operation, await Baseline(id), Card("first-card", 10, 0, "First question")));
      await db.QueryAsync("update cards set question='Concurrent card edit' where deck_id=$1", id);
      var publish = await CallPublish(id, new { deckId = id, reviewedImportOperationId = operation });
      Assert.Equal(409, publish.StatusCode);
      Assert.Empty(await db.QueryAsync("select job_id from deck_publishes where deck_id=$1", id));
      Assert.Equal(JsonValueKind.Null, (await Baseline(id)).ValueKind);
    }
    finally { Publish.TestEnqueueSeam = null; }
  }
}
