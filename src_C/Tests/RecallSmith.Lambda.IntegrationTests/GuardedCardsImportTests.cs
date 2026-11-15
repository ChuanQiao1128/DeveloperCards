using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class GuardedCardsImportTests(PostgresFixture db)
{
  private static readonly AuthContext Admin = AutomationTestKit.Ctx("guarded-import-admin", agent: false);
  private static object Card(string uid, int order, long expectedVersion, string question = "new question") =>
    new { stableUid = uid, orderInDeck = order, expectedVersion, question, explanation = "answer", difficulty = 2 };
  private static string Operation() => Guid.NewGuid().ToString("D");
  private static Task<APIGatewayProxyResponse> Import(long deckId, string operationId, object[] cards, AuthContext? auth = null) =>
    Raw(new { deckId, operationId, cards }, auth);
  private static Task<APIGatewayProxyResponse> Raw(object body, AuthContext? auth = null) =>
    AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", "/api/v1/authoring/cards/import", body, auth ?? Admin);
  private static string? Code(APIGatewayProxyResponse r) => JsonDocument.Parse(r.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();
  private async Task<long> Deck() => (await AutomationTestKit.NewDeckAsync(db, "guarded-import")).Id;
  private Task Seed(long deckId, string uid = "a", int order = 1) => db.QueryAsync(
    "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,difficulty) values($1,$2,$3,'original','answer',2)", deckId, uid, order);
  private Task<List<Dictionary<string, object?>>> Rows(long deckId) => db.QueryAsync(
    "select stable_uid,question,version,order_in_deck from cards where deck_id=$1 order by stable_uid", deckId);

  [Fact]
  public async Task MissingOperationOrExpectedVersion_IsRejectedWithoutWrites()
  {
    var id = await Deck();
    Assert.Equal(400, (await Raw(new { deckId = id, cards = new[] { Card("a", 1, 0) } })).StatusCode);
    Assert.Equal(400, (await Raw(new { deckId = id, operationId = Operation(), cards = new[] { new { stableUid = "a", orderInDeck = 1, question = "q" } } })).StatusCode);
    Assert.Empty(await Rows(id));
  }

  [Theory]
  [InlineData("")]
  [InlineData("not-an-operation")]
  [InlineData("00000000-0000-0000-0000-000000000000")]
  public async Task InvalidOperation_IsRejected(string operationId)
  {
    var id = await Deck();
    Assert.Equal(400, (await Import(id, operationId, [Card("a", 1, 0)])).StatusCode);
    Assert.Empty(await Rows(id));
  }

  [Theory]
  [InlineData(-1, 400)]
  [InlineData(1, 409)]
  public async Task MissingUid_RequiresCreatePrecondition(long expectedVersion, int status)
  {
    var id = await Deck();
    Assert.Equal(status, (await Import(id, Operation(), [Card("a", 1, expectedVersion)])).StatusCode);
    Assert.Empty(await Rows(id));
    Assert.Equal(0L, Convert.ToInt64(await db.ScalarAsync("select count(*) from content_release_actions where deck_id=$1", id)));
  }

  [Fact]
  public async Task StaleVersion_RejectsWholeBatchAndPreservesPreviousChunk()
  {
    var id = await Deck(); await Seed(id);
    Assert.Equal(200, (await Import(id, Operation(), [Card("previous", 5, 0)])).StatusCode);
    await db.QueryAsync("update cards set version=version+1,question='external' where deck_id=$1 and stable_uid='a'", id);
    var response = await Import(id, Operation(), [Card("new", 2, 0), Card("a", 1, 1)]);
    Assert.Equal(409, response.StatusCode); Assert.Equal("VERSION_CONFLICT", Code(response));
    var rows = await Rows(id); Assert.Equal(2, rows.Count);
    Assert.Equal("external", rows[0]["question"]); Assert.Equal(2L, Convert.ToInt64(rows[0]["version"]));
    Assert.Equal("previous", rows[1]["stable_uid"]);
  }

  [Fact]
  public async Task CreatePrecondition_DoesNotOverwriteUidCreatedSincePreview()
  {
    var id = await Deck(); await Seed(id);
    var response = await Import(id, Operation(), [Card("a", 1, 0), Card("b", 2, 0)]);
    Assert.Equal(409, response.StatusCode); Assert.Equal("VERSION_CONFLICT", Code(response));
    var row = Assert.Single(await Rows(id)); Assert.Equal("original", row["question"]); Assert.Equal(1L, Convert.ToInt64(row["version"]));
  }

  [Fact]
  public async Task ExactOperationReplay_AfterLaterEdit_ReturnsCommittedResultWithoutWritingOrLedgerRepeat()
  {
    var id = await Deck(); await Seed(id); var op = Operation(); object[] cards = [Card("a", 1, 1)];
    var first = await Import(id, op, cards); Assert.Equal(200, first.StatusCode);
    await db.QueryAsync("update cards set question='later',version=version+1 where deck_id=$1", id);
    var replay = await Import(id, op, cards); Assert.Equal(200, replay.StatusCode); Assert.Equal(first.Body, replay.Body);
    var row = Assert.Single(await Rows(id)); Assert.Equal("later", row["question"]); Assert.Equal(3L, Convert.ToInt64(row["version"]));
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from content_release_actions where deck_id=$1 and kind='cards/import'", id)));
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from automation_events where deck_id=$1 and automation='bulk_import' and outcome='success'", id)));
  }

  [Fact]
  public async Task SameOperationWithChangedPayload_IsConflictEvenAfterLaterEdit()
  {
    var id = await Deck(); await Seed(id); var op = Operation();
    Assert.Equal(200, (await Import(id, op, [Card("a", 1, 1)])).StatusCode);
    await db.QueryAsync("update cards set question='later',version=version+1 where deck_id=$1", id);
    var response = await Import(id, op, [Card("a", 1, 3, "changed")]);
    Assert.Equal(409, response.StatusCode); Assert.Equal("IDEMPOTENCY_CONFLICT", Code(response));
    Assert.Equal("later", Assert.Single(await Rows(id))["question"]);
  }

  [Theory]
  [InlineData(false, false)]
  [InlineData(true, false)]
  [InlineData(false, true)]
  [InlineData(true, true)]
  public async Task ConcurrentImports_SameOperationReplays_DifferentOperationsConflict(bool sameOperation, bool create)
  {
    var id = await Deck(); if (!create) await Seed(id);
    var op = Operation(); object[] cards = [Card("a", 1, create ? 0 : 1)];
    var responses = await Task.WhenAll(Import(id, op, cards), Import(id, sameOperation ? op : Operation(), cards));
    Assert.Equal(sameOperation ? new[] { 200, 200 } : new[] { 200, 409 }, responses.Select(r => r.StatusCode).Order().ToArray());
    Assert.Equal(create ? 1L : 2L, Convert.ToInt64(Assert.Single(await Rows(id))["version"]));
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from content_release_actions where deck_id=$1 and kind='cards/import'", id)));
  }

  [Fact]
  public async Task ConcurrentExternalEdit_HoldingRowLock_IsObservedBeforeAnyBatchWrite()
  {
    var id = await Deck(); await Seed(id);
    await using var conn = await db.OpenAsync(); await using var tx = await conn.BeginTransactionAsync();
    await DbUtil.ExecuteAsync(conn, tx, "update cards set question='external',version=version+1 where deck_id=$1", [id]);
    var pending = Import(id, Operation(), [Card("b", 2, 0), Card("a", 1, 1)]);
    // Observe the handler waiting in PostgreSQL rather than depending on scheduler timing.
    var blocked = false;
    for (var n = 0; n < 100; n++)
    {
      blocked = await db.ScalarAsync("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and datname=current_database() and pid<>pg_backend_pid())") is true;
      if (blocked) break;
      await Task.Delay(20);
    }
    Assert.True(blocked, "Import must reach and wait on the external transaction's PostgreSQL lock");
    Assert.False(pending.IsCompleted);
    await tx.CommitAsync();
    var response = await pending; Assert.Equal(409, response.StatusCode);
    Assert.Equal("external", Assert.Single(await Rows(id))["question"]);
  }

  [Fact]
  public async Task ExternalUpdate_DeadlockVictim_ReturnsConflictAndWritesNoBatchOrReceipt()
  {
    var id = await Deck(); await Seed(id);
    await using var conn = await db.OpenAsync(); await using var tx = await conn.BeginTransactionAsync();
    // The external writer takes the card first; import takes deck then card. Give the import's
    // detector the first turn, so it is deterministically the deadlock victim.
    await DbUtil.ExecuteAsync(conn, tx, "set local deadlock_timeout='10s'", []);
    await DbUtil.QueryAsync(conn, tx, "select id from cards where deck_id=$1 for update", [id]);
    var pending = Import(id, Operation(), [Card("b", 2, 0), Card("a", 1, 1)]);
    var blocked = false;
    for (var n = 0; n < 100; n++)
    {
      blocked = await db.ScalarAsync("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and datname=current_database() and pid<>pg_backend_pid())") is true;
      if (blocked) break;
      await Task.Delay(20);
    }
    Assert.True(blocked, "Import must hold the deck and wait for the external card lock");
    await DbUtil.ExecuteAsync(conn, tx, "update cards set question='external',version=version+1 where deck_id=$1", [id]);
    await tx.CommitAsync();
    var response = await pending;
    Assert.Equal(409, response.StatusCode); Assert.Equal("VERSION_CONFLICT", Code(response));
    var row = Assert.Single(await Rows(id)); Assert.Equal("external", row["question"]); Assert.Equal(2L, Convert.ToInt64(row["version"]));
    Assert.Equal(0L, Convert.ToInt64(await db.ScalarAsync("select count(*) from content_release_actions where deck_id=$1", id)));
  }

  [Fact]
  public async Task ExternalCreate_Pre053AfterBatchPrecheck_IsNotOverwrittenAndRollsBackEarlierInsert()
  {
    // 050–052 support import receipts without 053's global card/deck serialization trigger.
    // Exercise the actual CAS fallback on that supported schema, rather than disabling a safety trigger.
    const string name = "guarded_import_pre053";
    var cs = await db.CreateScratchDatabaseAsync(name);
    await using var conn = new Npgsql.NpgsqlConnection(cs); await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 52);
    var id = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
      "insert into decks(slug,title,author) values('guarded-race','Guarded race','tests') returning id", []));
    await DbUtil.ExecuteAsync(conn, null, $"""
      create function guarded_import_gate() returns trigger language plpgsql as $$
      begin
        if NEW.deck_id={id} and NEW.stable_uid='gate' then perform pg_advisory_xact_lock(74105,{id}::int); end if;
        return NEW;
      end $$;
      create trigger guarded_import_gate before insert on cards for each row execute function guarded_import_gate();
      """, []);
    var oldDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", name); Pg.Reset();
    await DbUtil.ExecuteAsync(conn, null, "select pg_advisory_lock(74105,$1::int)", [id]);
    Task<APIGatewayProxyResponse>? pending = null;
    Task? external = null;
    await using var observer = new Npgsql.NpgsqlConnection(cs); await observer.OpenAsync();
    try
    {
      pending = Import(id, Operation(), [Card("gate", 1, 0), Card("target", 2, 0)]);
      var blocked = false;
      for (var n = 0; n < 100; n++)
      {
        blocked = await DbUtil.ExecuteScalarAsync(observer, null,
          "select exists(select 1 from pg_locks where locktype='advisory' and classid=74105 and objid=$1::oid and not granted)", [id]) is true;
        if (blocked) break;
        await Task.Delay(20);
      }
      Assert.True(blocked, "Import must pass all preconditions and reach the first INSERT gate");
      external = DbUtil.ExecuteAsync(observer, null,
        "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,difficulty) values($1,'target',2,'external','answer',2)", [id]);
      Assert.Same(external, await Task.WhenAny(external, Task.Delay(2000)));
      await external;
      await DbUtil.ExecuteAsync(conn, null, "select pg_advisory_unlock(74105,$1::int)", [id]);
      var response = await pending;
      Assert.Equal(409, response.StatusCode); Assert.Equal("VERSION_CONFLICT", Code(response));
      var row = Assert.Single(await DbUtil.QueryAsync(conn, null, "select stable_uid,question,version from cards where deck_id=$1", [id]));
      Assert.Equal("target", row["stable_uid"]); Assert.Equal("external", row["question"]); Assert.Equal(1L, Convert.ToInt64(row["version"]));
      Assert.Equal(0L, Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from content_release_actions where deck_id=$1", [id])));
    }
    finally
    {
      await DbUtil.ExecuteAsync(conn, null, "select pg_advisory_unlock(74105,$1::int)", [id]);
      if (pending is not null) await pending;
      if (external is not null) { try { await external; } catch (Npgsql.PostgresException) { } }
      Environment.SetEnvironmentVariable("PGDATABASE", oldDb); Pg.Reset();
    }
  }

  [Fact]
  public async Task Replay_RechecksPermissionAndDoesNotLeakAcrossActors()
  {
    var id = await Deck(); var op = Operation(); object[] cards = [Card("a", 1, 0)];
    var actor = Admin with { UserSub = "guarded-editor-" + Operation(), IsSuperAdmin = false, IsEditor = true, Groups = ["editor"] };
    await db.QueryAsync("insert into admin_deck_permissions(admin_sub,deck_id,can_read,can_write) values($1,$2,1,1)", actor.UserSub, id);
    Assert.Equal(200, (await Import(id, op, cards, actor)).StatusCode);
    await db.QueryAsync("update admin_deck_permissions set can_write=0 where admin_sub=$1 and deck_id=$2", actor.UserSub, id);
    Assert.Equal(403, (await Import(id, op, cards, actor)).StatusCode);
    Assert.Equal(409, (await Import(id, op, cards, Admin)).StatusCode); // Another actor cannot replay this result.
    Assert.Equal(1L, Convert.ToInt64(Assert.Single(await Rows(id))["version"]));
  }
}
