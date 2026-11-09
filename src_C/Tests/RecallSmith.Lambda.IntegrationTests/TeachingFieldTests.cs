using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class TeachingFieldTests(PostgresFixture db)
{
  private static JsonElement Json(string value) => JsonSerializer.Deserialize<JsonElement>(value);
  private static readonly JsonElement Teaching = Json("""
    {"schema":"teaching-v1","answer":"Attach a role.","keyPoint":"The agent carries the session.","watchOut":"Open SSH inbound is not required.","mustAnswer":["Attach a role","Use Session Manager"],"prerequisites":["aws-pre-1"],"goal":"免密钥访问私网实例。","zh-CN":{"answer":"关联角色。","keyPoint":"Agent承载会话。","watchOut":"无需开放SSH入站。","goal":"免密钥访问私网实例。"}}
    """);
  private static readonly JsonElement Tags = Json("""{"domain":"1","examTask":"1.1"}""");
  private static AuthContext Admin() => AutomationTestKit.Ctx($"it-teaching-{Guid.NewGuid():N}", agent: false);
  private static Task<APIGatewayProxyResponse> Call(string method, object? body, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(Cards.HandleAuthoringCards, method, "/api/v1/authoring/cards", body, Admin(), query);
  private static Task<APIGatewayProxyResponse> Import(long deckId, params object[] cards) =>
    AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", "/api/v1/authoring/cards/import", new { deckId, cards }, Admin());
  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, response.Body);
    return AutomationTestKit.Data(response);
  }
  private static string Code(APIGatewayProxyResponse response) => Json(response.Body).GetProperty("error").GetProperty("code").GetString()!;
  private async Task<long> NewDeck() => Convert.ToInt64(await db.ScalarAsync("insert into decks (slug,title,author) values ($1,'teaching deck','tests') returning id", $"it-teach-{Guid.NewGuid():N}"), CultureInfo.InvariantCulture);
  private static Dictionary<string, object?> Card(long deckId, bool teaching = true, bool tags = true)
  {
    var card = new Dictionary<string, object?> { ["deckId"] = deckId, ["stableUid"] = "u", ["orderInDeck"] = 1, ["question"] = "What is a VPC?", ["explanation"] = "A virtual network" };
    if (teaching) card["teaching"] = Teaching;
    if (tags) card["tags"] = Tags;
    return card;
  }

  [Fact]
  public async Task ApiImportPublishAndWorker_CarryTeachingAndTags_AndAgreeOnSnapshot()
  {
    var deckId = await NewDeck();
    var first = Data(await Import(deckId, Card(deckId)));
    Assert.Equal(1, first.GetProperty("created").GetInt32());
    var second = Data(await Import(deckId, Card(deckId)));
    Assert.Equal(1, second.GetProperty("unchanged").GetInt32());
    var get = Data(await Call("GET", null, new Dictionary<string, string> { ["deckId"] = deckId.ToString() }))[0];
    var id = get.GetProperty("id").GetInt64();
    Assert.Equal("Attach a role.", get.GetProperty("teaching").GetProperty("answer").GetString());
    Assert.Equal("aws-pre-1", get.GetProperty("teaching").GetProperty("prerequisites")[0].GetString());
    Assert.Equal("1", get.GetProperty("tags").GetProperty("domain").GetString());
    var page = Data(await AutomationTestKit.CallAsync(CardsPage.HandleAuthoringCardsPage, "GET", "/api/v1/authoring/cards/page", null, Admin(), new Dictionary<string, string> { ["deckId"] = deckId.ToString() }));
    Assert.Equal("Attach a role.", page.GetProperty("items")[0].GetProperty("teaching").GetProperty("answer").GetString());
    var preview = Data(await AutomationTestKit.CallAsync(Publish.HandleAuthoringPublish, "POST", "/api/v1/authoring/publish", new { deckId }, Admin(), new Dictionary<string, string> { ["mode"] = "preview" }));
    Assert.Equal("Attach a role.", preview.GetProperty("export").GetProperty("cards")[0].GetProperty("teaching").GetProperty("answer").GetString());
    await using var conn = await db.OpenAsync();
    var cards = await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId);
    Assert.Equal("Attach a role.", cards[0].Teaching!.Value.GetProperty("answer").GetString());
    Assert.Equal("1.1", cards[0].Tags!.Value.GetProperty("examTask").GetString());
    var rows = await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deckId]);
    Assert.Equal(PublishSnapshot.Digest(rows.Select(PublishSnapshot.FromRow)), PublishJobProcessor.SnapshotDigest(cards));
    // deck.json shape: teaching/tags serialize; a card without them omits both keys entirely.
    var withFields = global::RecallSmith.Lambda.Worker.Content.ContentJson.Serialize(cards[0]);
    Assert.Contains("\"teaching\"", withFields);
    Assert.Contains("\"tags\"", withFields);
    var bare = new global::RecallSmith.Lambda.Worker.S3.CardExportData { StableUid = "x", Question = "q", Explanation = "a" };
    var bareJson = global::RecallSmith.Lambda.Worker.Content.ContentJson.Serialize(bare);
    Assert.DoesNotContain("teaching", bareJson);
    Assert.DoesNotContain("tags", bareJson);
    Assert.Equal(id, get.GetProperty("id").GetInt64());
  }

  [Fact]
  public async Task OmittedTeachingPreserves_ExplicitNullClears_AndContentHashTracksChanges()
  {
    var deckId = await NewDeck();
    var created = Data(await Call("POST", Card(deckId)));
    var id = created.GetProperty("id").GetInt64();
    async Task<string> Hash() => CardContentHash.Compute((await db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id=$1", id))[0]);
    var before = await Hash();
    // An old client that knows nothing about teaching must not wipe it.
    var oldClient = Card(deckId, teaching: false, tags: false);
    Data(await Import(deckId, oldClient));
    var kept = Data(await Call("GET", null, new Dictionary<string, string> { ["id"] = id.ToString() }))[0];
    Assert.True(kept.TryGetProperty("teaching", out _));
    Assert.True(kept.TryGetProperty("tags", out _));
    Assert.Equal(before, await Hash());
    // A content change to teaching changes the hash the review binding covers.
    var changed = Card(deckId);
    changed["teaching"] = Json("""{"schema":"teaching-v1","answer":"Attach a role!","keyPoint":"The agent carries the session.","mustAnswer":["Attach a role","Use Session Manager"]}""");
    Data(await Import(deckId, changed));
    Assert.NotEqual(before, await Hash());
    // Explicit null clears both columns.
    var cleared = Card(deckId);
    cleared["teaching"] = null;
    cleared["tags"] = null;
    Data(await Import(deckId, cleared));
    var after = Data(await Call("GET", null, new Dictionary<string, string> { ["id"] = id.ToString() }))[0];
    Assert.False(after.TryGetProperty("teaching", out _));
    Assert.False(after.TryGetProperty("tags", out _));
    Assert.Null(await db.ScalarAsync("select teaching::text from cards where id = $1", id));
  }

  [Fact]
  public async Task BadShapesAreRefused()
  {
    var deckId = await NewDeck();
    var noAnswer = Card(deckId);
    noAnswer["teaching"] = Json("""{"keyPoint":"k","mustAnswer":["a"]}""");
    var missing = await Import(deckId, noAnswer);
    Assert.Equal(400, missing.StatusCode);
    Assert.Equal("TEACHING_BAD_SHAPE", Code(missing));
    var badTags = Card(deckId);
    badTags["tags"] = Json("""{"domain":"7"}""");
    var refused = await Import(deckId, badTags);
    Assert.Equal(400, refused.StatusCode);
    Assert.Equal("TAGS_BAD_SHAPE", Code(refused));
    var empty = Card(deckId);
    empty["teaching"] = new Dictionary<string, object?>();
    Data(await Import(deckId, empty));
    Assert.Null(await db.ScalarAsync("select teaching::text from cards where id = $1",
      (long)Convert.ToInt64(await db.ScalarAsync("select id from cards where deck_id=$1 and stable_uid='u'", deckId), CultureInfo.InvariantCulture)));
  }

  [Fact]
  public async Task Pre051Schema_ImportWithoutTeachingWorks_AndTeachingWriteGets503UntilMigration()
  {
    const string name = "it_teaching_pre051";
    var connectionString = await db.CreateScratchDatabaseAsync(name);
    await using var conn = new NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 50);
    var oldDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", name);
    Pg.Reset();
    try
    {
      var deckId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into decks(slug,title,author) values('teach-pre','teach','tests') returning id", []));
      Data(await Import(deckId, Card(deckId, teaching: false, tags: false)));
      var rejected = await Import(deckId, Card(deckId));
      Assert.Equal(503, rejected.StatusCode);
      Assert.Equal("MIGRATION_REQUIRED", Code(rejected));
      var migration = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "051_card_teaching_tags.sql"));
      await DbUtil.ExecuteAsync(conn, null, migration, []);
      Data(await Import(deckId, Card(deckId)));
      var stored = await DbUtil.ExecuteScalarAsync(conn, null, "select teaching->>'answer' from cards where deck_id=$1 and stable_uid='u'", [deckId]);
      Assert.Equal("Attach a role.", stored);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", oldDb);
      Pg.Reset();
    }
  }
}
