using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class ContentReferencePublishTests(PostgresFixture db)
{
  private static AuthContext Admin => AutomationTestKit.Ctx("reference-admin", agent: false);
  private static Task<APIGatewayProxyResponse> Submit(long id, bool preview = false) => AutomationTestKit.CallAsync(Publish.HandleAuthoringPublish, "POST", "/api/v1/authoring/publish", new { deckId = id }, Admin,
    preview ? new Dictionary<string, string> { ["mode"] = "preview" } : null);
  private async Task<long> Deck() => Convert.ToInt64(await db.ScalarAsync("insert into decks(slug,title,author) values($1,'refs','tests') returning id", $"ref-{Guid.NewGuid():N}"));
  private async Task Card(long deck, string uid, string? reference = null, bool deleted = false) => await db.QueryAsync("insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,teaching,is_deleted) values($1,$2,(select coalesce(max(order_in_deck),0)+1 from cards where deck_id=$1),'question','answer',$3::jsonb,$4)", deck, uid,
    reference is null ? null : JsonSerializer.Serialize(new { schema = "teaching-v1", answer = "A", keyPoint = "K", mustAnswer = new[] { "A" }, prerequisites = new[] { reference } }), deleted ? 1 : 0);

  [Theory]
  [InlineData("missing", "MISSING_PREREQUISITE")]
  [InlineData("self", "SELF_REFERENCE")]
  [InlineData("deleted", "DELETED_PREREQUISITE")]
  [InlineData("cycle", "PREREQUISITE_CYCLE")]
  public async Task PreviewAndDispatch_RejectInvalidCompleteDeck_BeforeEnqueue(string kind, string code)
  {
    var deck = await Deck();
    await Card(deck, "a", kind == "self" ? "a" : "b");
    if (kind == "deleted") await Card(deck, "b", deleted: true);
    if (kind == "cycle") await Card(deck, "b", "a");
    var sends = 0; Publish.TestEnqueueSeam = new("queue", "bucket", _ => { sends++; return Task.CompletedTask; });
    try
    {
      foreach (var preview in new[] { true, false })
      {
        var response = await Submit(deck, preview);
        Assert.True(response.StatusCode == 400, response.Body);
        Assert.Contains("CONTENT_REFERENCE_GATE", response.Body);
        Assert.Contains(code, response.Body);
      }
      Assert.Equal(0, sends);
      Assert.Equal(0L, await db.ScalarAsync("select count(*) from deck_publishes where deck_id=$1", deck));
    }
    finally { Publish.TestEnqueueSeam = null; }
  }

  [Fact]
  public async Task PartialDraftsImport_ThenCompleteCandidatePublishes_AndWorkerRejectsLaterInvalidGraph()
  {
    var deck = await Deck();
    var imported = await AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", "/api/v1/authoring/cards/import", new { deckId = deck, cards = new[] { new { stableUid = "a", orderInDeck = 1, question = "Q", explanation = "A", teaching = new { answer = "A", keyPoint = "K", mustAnswer = new[] { "A" }, prerequisites = new[] { "b" } } } } }, Admin);
    Assert.True(imported.StatusCode == 200, imported.Body);
    await Card(deck, "b");
    Publish.TestEnqueueSeam = new("queue", "bucket", _ => Task.CompletedTask);
    string job;
    try
    {
      var response = await Submit(deck);
      Assert.True(response.StatusCode == 200, response.Body);
      job = JsonDocument.Parse(response.Body).RootElement.GetProperty("data").GetProperty("jobId").GetString()!;
    }
    finally { Publish.TestEnqueueSeam = null; }
    // A legacy queued job can lack a snapshot; the worker must still run its content gate.
    await db.QueryAsync("update deck_publishes set status='FAILED' where job_id=$1", job);
    job = Guid.NewGuid().ToString();
    await db.QueryAsync("insert into deck_publishes(job_id,build_id,s3_key,deck_id,deck_slug,status,published_by_admin_sub) select $1,'legacy','test-key',id,slug,'PENDING','tests' from decks where id=$2", job, deck);
    await db.QueryAsync("update cards set is_deleted=1 where deck_id=$1 and stable_uid='b'", deck);
    var upload = new NoUpload();
    var error = await Assert.ThrowsAsync<BusinessException>(() => new PublishJobProcessor(new JobRepository(), upload, new NoArtifacts()).ProcessAsync(job));
    Assert.Contains("CONTENT_REFERENCE_GATE", error.Message);
    Assert.Equal(0, upload.Calls);
  }

  [Fact]
  public async Task ControlledDispatchAndMappedDeck_UseTheSameCompleteGate()
  {
    var cs = await db.CreateScratchDatabaseAsync("refs_" + Guid.NewGuid().ToString("N"));
    await using var conn = new NpgsqlConnection(cs); await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
    var oldDatabase = Environment.GetEnvironmentVariable("PGDATABASE");
    Publish.TestEnqueueSeam = new("queue", "bucket", _ => throw new InvalidOperationException("Invalid content must not enqueue"));
    Environment.SetEnvironmentVariable("PGDATABASE", new NpgsqlConnectionStringBuilder(cs).Database); Pg.Reset();
    try
    {
      var deck = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into decks(slug,title,author) values('aws-saa-fundamentals','refs','tests') returning id", []));
      await DbUtil.ExecuteAsync(conn, null, "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,teaching) values($1,'a',1,'Q','A',$2::jsonb)", [deck, JsonSerializer.Serialize(new { answer = "A", keyPoint = "K", mustAnswer = new[] { "A" }, prerequisites = new[] { "missing" } })]);
      var editing = (string)(await DbUtil.ExecuteScalarAsync(conn, null, "select content_editing_snapshot($1)", [deck]))!;
      var snapshot = PublishSnapshot.Digest((await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deck])).Select(PublishSnapshot.FromRow));
      var receipt = Guid.NewGuid().ToString();
      await DbUtil.ExecuteAsync(conn, null, "insert into content_review_receipts(id,deck_id,release_id,action_id,payload_hash,editing_snapshot,publish_snapshot,policy,evidence,submitted_by,expires_at) values($1,$2,'refs','review','hash',$3,$4,'aws-codex-bilingual-v1','{}','tests',now()+interval '1 hour')", [receipt, deck, editing, snapshot]);
      var response = await AutomationTestKit.CallAsync(Publish.HandleAuthoringPublish, "POST", "/api/v1/authoring/publish", new { deckId = deck, releaseId = "refs", actionId = "publish", receiptId = receipt, expectedEditingSnapshot = editing, expectedLive = (string?)null }, Admin);
      Assert.True(response.StatusCode == 400, response.Body);
      Assert.Contains("MISSING_PREREQUISITE", response.Body);
      Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null, "select release_generation from decks where id=$1", [deck]));
      Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from deck_publishes where deck_id=$1", [deck]));

      var mapped = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into decks(slug,title,author) values('aws-saa-c03','refs','tests') returning id", []));
      await DbUtil.ExecuteAsync(conn, null, "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,tags) values($1,'a',1,'Q','A','{\"domain\":\"2\",\"examTask\":\"1.1\"}')", [mapped]);
      response = await Submit(mapped);
      Assert.True(response.StatusCode == 400, response.Body);
      Assert.Contains("DOMAIN_TASK_MISMATCH", response.Body);
      var job = Guid.NewGuid().ToString();
      await DbUtil.ExecuteAsync(conn, null, "insert into deck_publishes(job_id,build_id,s3_key,deck_id,deck_slug,status,published_by_admin_sub) values($1,'legacy','key',$2,'aws-saa-c03','PENDING','tests')", [job, mapped]);
      var uploader = new NoUpload();
      var error = await Assert.ThrowsAsync<BusinessException>(() => new PublishJobProcessor(new JobRepository(), uploader, new NoArtifacts()).ProcessAsync(job));
      Assert.Contains("DOMAIN_TASK_MISMATCH", error.Message);
      Assert.Equal(0, uploader.Calls);
    }
    finally { Publish.TestEnqueueSeam = null; Environment.SetEnvironmentVariable("PGDATABASE", oldDatabase); Pg.Reset(); }
  }

  private sealed class NoUpload : IS3DeckUploader
  {
    public int Calls;
    public Task<S3UploadResult> UploadAsync(string key, DeckExportData data) { Calls++; return Task.FromResult(new S3UploadResult()); }
    public Task<S3UploadResult> UploadJsonAsync(string key, string json, string cache) => throw new InvalidOperationException("No upload");
    public Task<string> DownloadJsonAsync(string key) => throw new InvalidOperationException("No download");
  }
  private sealed class NoArtifacts : IContentArtifactsGenerator
  { public Task GenerateAsync(JobInfo job, DeckExportData deck, S3UploadResult result) => Task.CompletedTask; }

  [Fact]
  public async Task ProtectedMetadataChanges_InvalidateSnapshots_WithoutRemastery_WhileCoreChangesIncrementRevision()
  {
    var cs = await db.CreateScratchDatabaseAsync("revision_" + Guid.NewGuid().ToString("N"));
    await using var conn = new NpgsqlConnection(cs); await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
    var deck = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into decks(slug,title,author) values('aws-saa-fundamentals','rev','tests') returning id", []));
    var id = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,revision) values($1,'a',1,'Q','A',7) returning id", [deck]));
    async Task<long> Revision() => Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select revision from cards where id=$1", [id]));
    async Task<string> Snapshot() => (string)(await DbUtil.ExecuteScalarAsync(conn, null, "select content_editing_snapshot($1)", [deck]))!;
    foreach (var assignment in new[] { "translations='{\"zh-CN\":{\"v\":1,\"question\":\"中文\",\"explanation\":\"解释\"}}'::jsonb", "translation_basis='{\"zh-CN\":\"basis\"}'::jsonb", "tags='{\"domain\":\"1\",\"examTask\":\"1.1\"}'::jsonb", "order_in_deck=2,topic='navigation'" })
    {
      var before = await Snapshot();
      await DbUtil.ExecuteAsync(conn, null, $"update cards set {assignment} where id=$1", [id]);
      Assert.Equal(7, await Revision());
      Assert.NotEqual(before, await Snapshot());
    }
    await DbUtil.ExecuteAsync(conn, null, "update cards set question='new question' where id=$1", [id]);
    Assert.Equal(8, await Revision());
    await DbUtil.ExecuteAsync(conn, null, "update cards set teaching='{\"schema\":\"teaching-v1\",\"answer\":\"A\",\"keyPoint\":\"K\",\"mustAnswer\":[\"A\"]}'::jsonb where id=$1", [id]);
    Assert.Equal(9, await Revision());
    var beforeZh = await Snapshot();
    await DbUtil.ExecuteAsync(conn, null, "update cards set teaching=jsonb_set(teaching,'{zh-CN}','{\"answer\":\"中文\",\"keyPoint\":\"解释\"}'::jsonb) where id=$1", [id]);
    Assert.Equal(9, await Revision());
    Assert.NotEqual(beforeZh, await Snapshot());
    await DbUtil.ExecuteAsync(conn, null, "update cards set teaching=jsonb_set(teaching,'{answer}','\"new answer\"'::jsonb) where id=$1", [id]);
    Assert.Equal(10, await Revision());
    var immutable = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null, "update cards set stable_uid='changed' where id=$1", [id]));
    Assert.Equal("RELEASE_UID_IMMUTABLE", immutable.MessageText);
    await DbUtil.ExecuteAsync(conn, null, "update cards set is_deleted=1 where id=$1", [id]);
    await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null, "update cards set is_deleted=0 where id=$1", [id]));
  }
}
