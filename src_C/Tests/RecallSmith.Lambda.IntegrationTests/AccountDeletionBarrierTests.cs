using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class AccountDeletionBarrierTests(PostgresFixture db)
{
  private static string Sub() => $"it-delete-barrier-{Guid.NewGuid():N}";

  private static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> Invoke(
    string sub, string path, string body, Func<LambdaRequest, Res, AuthContext, Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse>> handler,
    string method = "POST")
  {
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path, requestContext = new { http = new { method } }, body,
      headers = new Dictionary<string, string>(), isBase64Encoded = false,
    }));
    var auth = new AuthContext(new Dictionary<string, JsonElement>(), sub, sub, [], false, false, false);
    return await handler(req, new Res(req.TraceId), auth);
  }

  [Fact]
  public async Task DeletedSub_OldTokenCannotBootstrapPushOrDraw_NewSubStillWorks()
  {
    var sub = Sub();
    await using var conn = await db.OpenAsync();
    await AccountDeletion.DeleteUserDataAsync(conn, sub);
    var bootstrap = await Invoke(sub, "/api/v1/user/bootstrap", "{}", Bootstrap.HandleBootstrap);
    Assert.Equal(409, bootstrap.StatusCode);
    var push = await Invoke(sub, "/api/progress/events", JsonSerializer.Serialize(new
    {
      events = new[] { new { eventId = Guid.NewGuid(), deckSlug = "d", stableUid = "u", rating = 3, eventTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() } }
    }), ProgressEvents.HandleProgressEvents);
    Assert.Equal(409, push.StatusCode);
    var draw = await Invoke(sub, "/api/v1/draw-state/sync", "{\"decks\":[]}", DrawStateSync.HandleDrawStateSync);
    Assert.Equal(409, draw.StatusCode);
    Assert.Equal(0L, Convert.ToInt64(await db.ScalarAsync("select count(*) from users where user_sub=$1", sub)));
    Assert.Equal(200, (await Invoke(Sub(), "/api/v1/user/bootstrap", "{}", Bootstrap.HandleBootstrap)).StatusCode);
    await AccountDeletion.DeleteUserDataAsync(conn, sub);
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from account_deletions where sub=$1", sub)));
  }

  [Fact]
  public async Task TwoConnections_WriterWaitsForDeletionAndCannotRecreateRows()
  {
    var sub = Sub();
    await using var deleting = await db.OpenAsync();
    await using var writing = await db.OpenAsync();
    await using var tx = await deleting.BeginTransactionAsync();
    // The same per-sub fence as DELETE; hold the commit to force an overlapping statement snapshot.
    await DbUtil.ExecuteAsync(deleting, tx, "select pg_advisory_xact_lock(hashtextextended($1, 520052)); insert into account_deletions(sub) values($1)", [sub]);
    var pending = DbUtil.ExecuteAsync(writing, null, "insert into users(user_sub) values($1) on conflict(user_sub) do update set last_seen_at=now()", [sub]);
    await Task.Delay(100);
    Assert.False(pending.IsCompleted);
    await tx.CommitAsync();
    var error = await Assert.ThrowsAsync<PostgresException>(() => pending);
    Assert.Equal("ACCOUNT_DELETION_PENDING", error.MessageText);
    Assert.Equal(0L, Convert.ToInt64(await db.ScalarAsync("select count(*) from users where user_sub=$1", sub)));
  }

  [Fact]
  public async Task TwoConnections_ActualDeletionWaitsForInFlightWriter_ThenErasesItsCommit()
  {
    var sub = Sub();
    await using var writing = await db.OpenAsync();
    await using var deleting = await db.OpenAsync();
    await using var tx = await writing.BeginTransactionAsync();
    await DbUtil.ExecuteAsync(writing, tx, "insert into users(user_sub) values($1)", [sub]);
    await DbUtil.ExecuteAsync(writing, tx, "insert into user_wallet(user_sub) values($1)", [sub]);
    var pending = AccountDeletion.DeleteUserDataAsync(deleting, sub);
    await Task.Delay(100);
    Assert.False(pending.IsCompleted);
    await tx.CommitAsync();
    Assert.Equal(1, (await pending).UserRows);
    Assert.Equal(0L, Convert.ToInt64(await db.ScalarAsync("select count(*) from user_wallet where user_sub=$1", sub)));
    var error = await Assert.ThrowsAsync<PostgresException>(() =>
      DbUtil.ExecuteAsync(writing, null, "insert into user_premium_state(app_user_id) values($1)", [sub]));
    Assert.Equal("ACCOUNT_DELETION_PENDING", error.MessageText);
  }

  [Fact]
  public async Task EveryUserOwnedTableHasEnabledInsertAndUpdateFence_AnonymousReportsStillWork()
  {
    var rows = await db.QueryAsync("""
      select c.table_name from information_schema.columns c
      where c.table_schema='public' and c.column_name in ('user_sub','app_user_id')
      and not exists (select 1 from pg_trigger t where t.tgrelid=('public.'||c.table_name)::regclass
        and t.tgname='account_deletion_barrier' and t.tgenabled='O' and t.tgtype=23)
      """);
    Assert.Empty(rows);
    await using var conn = await db.OpenAsync();
    Assert.Equal(1, await DbUtil.ExecuteAsync(conn, null,
      "insert into card_reports(user_sub, deck_slug, stable_uid, reason) values(null, 'd', $1, 'typo')", [Sub()]));
  }

  [Theory]
  [InlineData("insert into users(user_sub) values($1)")]
  [InlineData("insert into user_entitlements(user_sub, entitlement_key, tier, source) values($1, 'premium_all', 'premium', 'manual')")]
  [InlineData("insert into user_subscriptions(user_sub, provider, product_id, original_transaction_id, status) values($1, 'apple', 'p', $1, 'active')")]
  [InlineData("insert into user_progress_events(event_id, user_sub, deck_slug, stable_uid, event_time) values(gen_random_uuid(), $1, 'd', 'u', now())")]
  [InlineData("insert into user_progress(user_sub, deck_slug, stable_uid) values($1, 'd', 'u')")]
  [InlineData("insert into user_draw_owned(user_sub, deck_slug, stable_uid) values($1, 'd', 'u')")]
  [InlineData("insert into user_draw_meta(user_sub, deck_slug) values($1, 'd')")]
  [InlineData("insert into user_wallet(user_sub) values($1)")]
  [InlineData("insert into user_deck_wallet(user_sub, deck_slug) values($1, 'd')")]
  [InlineData("insert into user_premium_state(app_user_id) values($1)")]
  [InlineData("insert into rc_webhook_events(event_id, mode, app_user_id, raw) values($1, 'development', $1, '{}'::jsonb)")]
  [InlineData("insert into card_reports(user_sub, deck_slug, stable_uid, reason) values($1, 'd', 'u', 'typo')")]
  public async Task EveryOwnedTableRejectsPostDeletionWrites(string sql)
  {
    var sub = Sub();
    await using var conn = await db.OpenAsync();
    await AccountDeletion.DeleteUserDataAsync(conn, sub);
    var rejected = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null, sql, [sub]));
    Assert.Equal("ACCOUNT_DELETION_PENDING", rejected.MessageText);
  }

  [Fact]
  public async Task FixedTransactionSnapshotsAreRejectedRatherThanMissingACommittedFence()
  {
    await using var conn = await db.OpenAsync();
    await using var tx = await conn.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
    var rejected = await Assert.ThrowsAsync<PostgresException>(() =>
      DbUtil.ExecuteAsync(conn, tx, "insert into users(user_sub) values($1)", [Sub()]));
    Assert.Equal("40001", rejected.SqlState);
  }

  [Fact]
  public async Task RepeatDeleteDoesNotRequeueSuccessfulExternalDeletion_OrExpireTheFence()
  {
    var sub = Sub();
    await using var conn = await db.OpenAsync();
    await AccountDeletion.DeleteUserDataAsync(conn, sub);
    await DbUtil.ExecuteAsync(conn, null, "delete from revenuecat_deletions where sub=$1", [sub]);
    var repeated = await AccountDeletion.DeleteUserDataAsync(conn, sub);
    Assert.Equal(0, repeated.RevenueCatQueued);
    Assert.Equal("pending_owner_confirmation", (await db.QueryAsync("select identity_status from account_deletions where sub=$1", sub)).Single()["identity_status"]);
    Assert.Equal(0L, Convert.ToInt64(await db.ScalarAsync("select count(*) from revenuecat_deletions where sub=$1", sub)));
  }

  [Fact]
  public async Task Migration052IsIdempotent_AndDefinerFenceWorksWithoutRuntimeBarrierAccess()
  {
    var cs = await db.CreateScratchDatabaseAsync("deletion_definer");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 51);
    var sql = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "052_account_deletion_barrier.sql"));
    await DbUtil.ExecuteAsync(conn, null, sql, []);
    await DbUtil.ExecuteAsync(conn, null, sql, []);
    var sub = Sub();
    await AccountDeletion.DeleteUserDataAsync(conn, sub);
    const string role = "it_deletion_writer";
    await DbUtil.ExecuteAsync(conn, null, $"create role {role}; grant usage on schema public to {role}; grant select,insert,update on users to {role}", []);
    try
    {
      await DbUtil.ExecuteAsync(conn, null, $"set role {role}", []);
      var denied = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from account_deletions", []));
      Assert.Equal("42501", denied.SqlState);
      Assert.Equal(1, await DbUtil.ExecuteAsync(conn, null, "insert into users(user_sub) values($1)", [Sub()]));
      var blocked = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null, "insert into users(user_sub) values($1)", [sub]));
      Assert.Equal("ACCOUNT_DELETION_PENDING", blocked.MessageText);
    }
    finally
    {
      await DbUtil.ExecuteAsync(conn, null, $"reset role; drop owned by {role}; drop role {role}", []);
    }
  }

  [Fact]
  public async Task BeforeMigration052_DeleteFailsWithoutErasing_RegularBootstrapReadsRemainCompatible()
  {
    var cs = await db.CreateScratchDatabaseAsync("delete_pre052");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 51);
    var sub = Sub();
    await DbUtil.ExecuteAsync(conn, null, "insert into users(user_sub) values($1)", [sub]);
    await Assert.ThrowsAsync<InvalidOperationException>(() => AccountDeletion.DeleteUserDataAsync(conn, sub));
    Assert.Equal(1L, Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from users where user_sub=$1", [sub])));
    var previous = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", "delete_pre052");
    Pg.Reset();
    try
    {
      Assert.Equal(200, (await Invoke(sub, "/api/v1/user/bootstrap", "{}", Bootstrap.HandleBootstrap)).StatusCode);
      Assert.Equal(200, (await Invoke(sub, "/api/progress", "", ProgressGet.HandleProgressGet, "GET")).StatusCode);
      var rejected = await Invoke(sub, "/api/v1/user/me", "", AccountDeletion.HandleDeleteMe, "DELETE");
      Assert.Equal(503, rejected.StatusCode);
      Assert.Contains("SERVER_NOT_READY", rejected.Body);
      Assert.Equal(1L, Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from users where user_sub=$1", [sub])));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", previous);
      Pg.Reset();
    }
  }
}
