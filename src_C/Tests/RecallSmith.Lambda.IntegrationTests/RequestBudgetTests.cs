using System.Diagnostics;
using System.Text.Json;
using Amazon.Lambda.Core;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class RequestBudgetTests(PostgresFixture db)
{
  [Theory]
  [InlineData(false, "reader")]
  [InlineData(true, "reader")]
  [InlineData(false, "scalar")]
  [InlineData(true, "scalar")]
  [InlineData(false, "write")]
  [InlineData(true, "write")]
  public async Task BothHelpersCancelRealSqlAndRollbackWithoutLingeringWork(bool vpc, string operation)
  {
    await using var conn = await db.OpenAsync();
    var pid = conn.ProcessID;
    await using (var setup = new NpgsqlCommand("create temporary table deadline_test(value int)", conn)) await setup.ExecuteNonQueryAsync();
    var watch = Stopwatch.StartNew();
    using (RequestBudget.BeginOnline(TimeSpan.FromMilliseconds(850)))
    {
      await using var tx = await conn.BeginTransactionAsync(RequestBudget.Token);
      await Assert.ThrowsAnyAsync<Exception>(async () =>
      {
        if (operation == "write")
        {
          const string sql = "insert into deadline_test select 1 from pg_sleep(4)";
          if (vpc) await RecallSmith.Lambda.Vpc.Db.DbUtil.ExecuteAsync(conn, tx, sql, []);
          else await DbUtil.ExecuteAsync(conn, tx, sql, []);
        }
        else if (operation == "scalar")
        {
          if (vpc) await RecallSmith.Lambda.Vpc.Db.DbUtil.ExecuteScalarAsync(conn, tx, "select pg_sleep(4)", []);
          else await DbUtil.ExecuteScalarAsync(conn, tx, "select pg_sleep(4)", []);
        }
        else
        {
          if (vpc) await RecallSmith.Lambda.Vpc.Db.DbUtil.QueryAsync(conn, tx, "select pg_sleep(4)", []);
          else await DbUtil.QueryAsync(conn, tx, "select pg_sleep(4)", []);
        }
      });
      Assert.True(RequestBudget.Expired);
    }
    Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3));
    Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from deadline_test", []));
    Assert.Equal(0L, await db.ScalarAsync("select count(*) from pg_stat_activity where pid=$1 and (state='active' or xact_start is not null)", pid));
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task BothPoolsHonorExpiredConnectionBudget(bool vpc)
  {
    // Exercise both fresh construction and a synchronously available pooled connector.
    if (vpc) RecallSmith.Lambda.Vpc.Db.Pg.Reset(); else Pg.Reset();
    using (RequestBudget.BeginOnline(TimeSpan.Zero))
    {
      await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
      {
        await using var cold = vpc ? await RecallSmith.Lambda.Vpc.Db.Pg.OpenConnectionOrNullAsync() : await Pg.OpenConnectionOrNullAsync();
      });
    }
    await using (var warm = vpc ? await RecallSmith.Lambda.Vpc.Db.Pg.OpenConnectionOrNullAsync() : await Pg.OpenConnectionOrNullAsync()) Assert.NotNull(warm);
    using (RequestBudget.BeginOnline(TimeSpan.Zero))
    {
      await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
      {
        await using var conn = vpc ? await RecallSmith.Lambda.Vpc.Db.Pg.OpenConnectionOrNullAsync() : await Pg.OpenConnectionOrNullAsync();
      });
    }
    await using var next = vpc ? await RecallSmith.Lambda.Vpc.Db.Pg.OpenConnectionOrNullAsync() : await Pg.OpenConnectionOrNullAsync();
    Assert.NotNull(next);
  }

  [Fact]
  public async Task ConcurrentRequestsKeepTheirOwnDeadlineAndNonOnlineWorkHasNoScope()
  {
    Assert.False(RequestBudget.Token.CanBeCanceled);
    async Task<bool> Run(int remaining, int delay)
    {
      using var scope = RequestBudget.BeginOnline(TimeSpan.FromMilliseconds(remaining));
      await Task.Delay(delay);
      return RequestBudget.Expired;
    }
    var results = await Task.WhenAll(Run(550, 150), Run(5000, 200));
    Assert.Equal(new[] { true, false }, results);
    Assert.False(RequestBudget.Token.CanBeCanceled);
    // Worker/migration code without an online scope retains a caller's own timeout and command limit.
    await using var conn = await db.OpenAsync();
    await using var cmd = RequestBudget.Command(new NpgsqlCommand("select pg_sleep(0.15)", conn) { CommandTimeout = 60 });
    Assert.Equal(60, cmd.CommandTimeout);
    await cmd.ExecuteScalarAsync(RequestBudget.Token);
  }

  [Fact]
  public async Task ExistingPingRequiresAdminReadsSchemaWithoutDdlAndHandlerCancelsBlockedRead()
  {
    using var key = TestJwt.NewKey();
    Auth.Configure(AuthOptions.Parse(null, null, "production", null, "deadline-spa", null),
      new StubJwks(TestJwt.Jwks(("deadline-kid", key))));
    try
    {
      var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, sub: "deadline-admin", groups: ["super_admin"]);
      payload["client_id"] = "deadline-spa";
      var token = TestJwt.Sign(key, "deadline-kid", payload);
      JsonElement Event(string? bearer, string path = "/api/v1/db/ping") => JsonSerializer.SerializeToElement(new
      {
        rawPath = path, requestContext = new { http = new { method = "GET" } },
        headers = bearer is null ? new Dictionary<string, string>() : new Dictionary<string, string> { ["authorization"] = "Bearer " + bearer }
      });
      var function = new VpcFunction();
      Assert.Equal(403, (await function.Handler(Event(null))).StatusCode);
      // Fixture applies SQL files directly; the real migration runner also records each version.
      await db.ScalarAsync("insert into schema_migrations(version,name) values(55,'n7-readiness-test') on conflict do nothing returning version");
      var before = await db.ScalarAsync("select count(*) from schema_migrations");
      Assert.Equal(200, (await function.Handler(Event(token))).StatusCode);
      Assert.Equal(before, await db.ScalarAsync("select count(*) from schema_migrations"));
      await using var locker = await db.OpenAsync();
      await using var tx = await locker.BeginTransactionAsync();
      await using (var cmd = new NpgsqlCommand("lock table schema_migrations in access exclusive mode", locker, tx)) await cmd.ExecuteNonQueryAsync();
      // health stays cheap even when the readiness read is blocked by a migration.
      Assert.Equal(200, (await function.Handler(Event(null, "/health"), new ShortContext())).StatusCode);
      var watch = Stopwatch.StartNew();
      var response = await function.Handler(Event(token), new ShortContext());
      Assert.Equal(503, response.StatusCode);
      Assert.Contains("REQUEST_DEADLINE", response.Body);
      Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3));
      Assert.Equal(0L, await db.ScalarAsync("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%schema_migrations%'"));
    }
    finally
    {
      Auth.ResetToEnvironment();
      await db.ScalarAsync("delete from schema_migrations where name='n7-readiness-test'");
    }
  }

  [Fact]
  public async Task ReadinessIsReadOnlyAndMissingLedgerDoesNotCreateSchema()
  {
    var cs = await db.CreateScratchDatabaseAsync("n7_readiness");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    var res = new Res("n7");
    Assert.Equal(503, (await RecallSmith.Lambda.Vpc.Db.Readiness.Check(conn, res)).StatusCode);
    Assert.Null(await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.schema_migrations')::text", []));
    await DbUtil.ExecuteAsync(conn, null, "create table schema_migrations(version int); insert into schema_migrations values(55); create table decks(id int)", []);
    await DbUtil.ExecuteAsync(conn, null, "set default_transaction_read_only=on", []);
    Assert.Equal(200, (await RecallSmith.Lambda.Vpc.Db.Readiness.Check(conn, res)).StatusCode);
    await DbUtil.ExecuteAsync(conn, null, "set default_transaction_read_only=off", []);
    await DbUtil.ExecuteAsync(conn, null, "update schema_migrations set version=51", []);
    Assert.Equal(503, (await RecallSmith.Lambda.Vpc.Db.Readiness.Check(conn, res)).StatusCode);
  }

  private sealed class ShortContext : ILambdaContext
  {
    public string AwsRequestId => "deadline-test";
    public IClientContext ClientContext => null!;
    public string FunctionName => "test";
    public string FunctionVersion => "test";
    public ICognitoIdentity Identity => null!;
    public string InvokedFunctionArn => "test";
    public ILambdaLogger Logger => null!;
    public string LogGroupName => "test";
    public string LogStreamName => "test";
    public int MemoryLimitInMB => 512;
    public TimeSpan RemainingTime => TimeSpan.FromMilliseconds(850);
  }
}
