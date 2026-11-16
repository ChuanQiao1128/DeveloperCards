using System.Text;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.OperationsObserver;
using Testcontainers.PostgreSql;
using Observer = RecallSmith.Lambda.OperationsObserver.Function;

namespace RecallSmith.Lambda.IntegrationTests;

public sealed class OperationsObserverPostgres : IAsyncLifetime
{
  private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17-alpine")
    .WithDatabase("observer_test").WithUsername("fixture").WithPassword("fixture_local_only").Build();
  public string Admin => _container.GetConnectionString();
  public string Reader => new NpgsqlConnectionStringBuilder(Admin) { Username = "observer", Password = "observer_local_only",
    Pooling = false, Timeout = 2, CommandTimeout = 2, CancellationTimeout = 250,
    Options = "-c default_transaction_read_only=on -c search_path=public" }.ConnectionString;

  public async Task InitializeAsync()
  {
    await _container.StartAsync();
    await Execute("""
      create table deck_publishes(job_id varchar(100) primary key,deck_slug text not null,build_id text not null,
        status varchar(30) not null,created_at timestamptz not null,updated_at timestamptz not null);
      create table publish_dispatch(job_id varchar(100) primary key references deck_publishes(job_id), attempts int not null default 0,delivered_at timestamptz);
      create table publish_manifest_delivery(job_id varchar(100) primary key references deck_publishes(job_id),state text not null);
      create role observer login noinherit password 'observer_local_only';
      grant connect on database observer_test to observer;
      grant usage on schema public to observer;
      grant select on deck_publishes,publish_dispatch,publish_manifest_delivery to observer;
      alter role observer set default_transaction_read_only=on;
      """);
  }
  public async Task Execute(string sql)
  {
    await using var connection = new NpgsqlConnection(Admin);
    await connection.OpenAsync();
    await new NpgsqlCommand(sql, connection).ExecuteNonQueryAsync();
  }
  public Task Reset() => Execute("truncate publish_dispatch,publish_manifest_delivery,deck_publishes");
  public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}

public sealed class OperationsObserverTests(OperationsObserverPostgres database) : IClassFixture<OperationsObserverPostgres>
{
  private static JsonElement Event(string raw = "{\"schemaVersion\":1,\"job\":\"observe-publishing\"}") => JsonSerializer.Deserialize<JsonElement>(raw);
  private Observer Handler(List<string> lines, string? ns = "DeveloperCardsConsoleS2_local") => new(() => new NpgsqlConnection(database.Reader), lines.Add, () => ns);

  [Fact]
  public async Task RealQueryFindsSilentDispatchProcessingAndManifestWithoutActivity()
  {
    await database.Reset();
    await database.Execute("""
      insert into deck_publishes values
        ('no-dispatch','deck','b1','PENDING',now()-interval '11 minutes',now()),
        ('delivered-not-picked','deck','b2','PENDING',now()-interval '12 minutes',now()),
        ('attempts','deck','b3','PENDING',now(),now()),
        ('processing','deck','b4','PROCESSING',now()-interval '1 hour',now()-interval '31 minutes'),
        ('manifest-pending','deck','b5','SUCCESS',now()-interval '1 hour',now()-interval '11 minutes'),
        ('attention','deck','b6','SUCCESS',now(),now()),
        ('recent','deck','b7','PENDING',now(),now()),
        ('recent-processing','deck','b8','PROCESSING',now(),now()),
        ('recent-manifest','deck','b9','SUCCESS',now(),now()),
        ('legacy-missing-manifest','deck','b10','SUCCESS',now()-interval '1 hour',now()-interval '1 hour'),
        ('delivered-manifest','deck','b11','SUCCESS',now()-interval '1 hour',now()-interval '1 hour'),
        ('failed','deck','b12','FAILED',now()-interval '1 hour',now()-interval '1 hour');
      insert into publish_dispatch values ('delivered-not-picked',1,now()),('attempts',5,null);
      insert into publish_manifest_delivery values ('manifest-pending','pending'),('attention','needs_attention'),
        ('recent-manifest','pending'),('delivered-manifest','delivered');
      """);
    var lines = new List<string>();
    var response = await Handler(lines).Handler(Event(), null);
    Assert.Equal("known", response.Status);
    Assert.Equal(0, response.ObservedAt.Ticks % 10);
    Console.WriteLine("OperationsObserver wire " + JsonSerializer.Serialize(response));
    Assert.True(response.Stalled);
    Assert.False(response.Truncated);
    Assert.Equal(new[] { "processing", "delivered-not-picked", "manifest-pending", "no-dispatch", "attempts", "attention" }, response.Items.Select(i => i.JobId));
    Assert.Equal(new[] { "processing", "dispatch", "manifest", "dispatch", "dispatch", "manifest" }, response.Items.Select(i => i.Phase));
    using var emf = JsonDocument.Parse(lines[0]);
    Assert.Equal(1, emf.RootElement.GetProperty("ObserverSuccess").GetInt32());
    Assert.Equal(1, emf.RootElement.GetProperty("PublishStalled").GetInt32());
    Assert.Contains("operations-observer", lines[0]);
    Assert.DoesNotContain("jobId", lines[0]);
    // Local EXPLAIN proves PostgreSQL accepts the fixed query, not production plan capacity.
    await using var connection = new NpgsqlConnection(database.Reader);
    await connection.OpenAsync();
    await using var plan = new NpgsqlCommand("EXPLAIN (FORMAT JSON) " + Observer.Query, connection);
    var explanation = (string)(await plan.ExecuteScalarAsync())!;
    Assert.Contains("Limit", explanation);
    Console.WriteLine("OperationsObserver local EXPLAIN " + explanation);
  }

  [Fact]
  public async Task SentinelReturnsTwentyAndMarksLowerBoundNotTotal()
  {
    await database.Reset();
    await database.Execute("""
      insert into deck_publishes select 'job-'||lpad(n::text,2,'0'),'deck','build','PENDING',now()-interval '1 hour',now()
        from generate_series(1,30) n;
      """);
    var lines = new List<string>();
    var response = await Handler(lines).Handler(Event(), null);
    Assert.Equal(20, response.Items.Count);
    Assert.True(response.Truncated);
    Assert.True(response.Stalled);
    Assert.Equal("job-01", response.Items[0].JobId);
    Assert.Equal("job-20", response.Items[^1].JobId);
    Assert.True(Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(response)) < 16384);
  }

  [Fact]
  public async Task EmptySuccessfulReadIsOnlyCaseEmittingZero()
  {
    await database.Reset();
    var lines = new List<string>();
    var response = await Handler(lines).Handler(Event(), null);
    Assert.Equal("known", response.Status);
    Assert.False(response.Stalled);
    Assert.Contains("\"PublishStalled\":0", lines[0]);
  }

  [Fact]
  public async Task MissingTableAndDeniedSelectRemainUnknownWithoutHealthyGauge()
  {
    await database.Reset();
    foreach (var failure in new[] { "missing", "denied" })
    {
      await database.Execute(failure == "missing" ? "alter table publish_dispatch rename to held_dispatch"
        : "revoke select on publish_dispatch from observer");
      try
      {
        var lines = new List<string>();
        var response = await Handler(lines).Handler(Event(), null);
        Assert.Equal("unknown", response.Status);
        Assert.Equal("DB_UNAVAILABLE", response.Reason);
        Assert.Null(response.Stalled);
        Assert.Empty(response.Items);
        Assert.Contains("\"ObserverSuccess\":0", lines[0]);
        Assert.DoesNotContain("PublishStalled", string.Join("", lines));
        Assert.DoesNotContain("permission", string.Join("", lines));
      }
      finally
      {
        await database.Execute(failure == "missing" ? "alter table held_dispatch rename to publish_dispatch"
          : "grant select on publish_dispatch to observer");
      }
    }
  }

  [Fact]
  public async Task RealTableLockTimeoutIsUnavailableAndDoesNotMutate()
  {
    await database.Reset();
    await using var blocker = new NpgsqlConnection(database.Admin);
    await blocker.OpenAsync();
    await using var held = await blocker.BeginTransactionAsync();
    await new NpgsqlCommand("lock table deck_publishes in access exclusive mode", blocker, held).ExecuteNonQueryAsync();
    var lines = new List<string>();
    var response = await Handler(lines).Handler(Event(), null);
    Assert.Equal("QUERY_TIMEOUT", response.Reason);
    Assert.Null(response.Stalled);
    Assert.DoesNotContain("PublishStalled", lines[0]);
    await held.RollbackAsync();
  }

  [Fact]
  public async Task TransactionRejectsWritesEvenForOwnerAndEnforcesStatementTimeout()
  {
    await using var connection = new NpgsqlConnection(database.Admin);
    await connection.OpenAsync();
    await using (var transaction = await Observer.BeginReadOnlyAsync(connection, CancellationToken.None))
    {
      var error = await Assert.ThrowsAsync<PostgresException>(() => new NpgsqlCommand("delete from deck_publishes", connection, transaction).ExecuteNonQueryAsync());
      Assert.Equal("25006", error.SqlState);
      await transaction.RollbackAsync();
    }
    await using (var transaction = await Observer.BeginReadOnlyAsync(connection, CancellationToken.None))
    {
      var error = await Assert.ThrowsAsync<PostgresException>(() => new NpgsqlCommand("select pg_sleep(4)", connection, transaction) { CommandTimeout = 5 }.ExecuteNonQueryAsync());
      Assert.Equal("57014", error.SqlState);
      await transaction.RollbackAsync();
    }
  }

  [Theory]
  [InlineData("{}")] [InlineData("null")] [InlineData("{\"schemaVersion\":true,\"job\":\"observe-publishing\"}")]
  [InlineData("{\"schemaVersion\":1,\"job\":\"other\"}")]
  [InlineData("{\"schemaVersion\":1,\"job\":\"observe-publishing\",\"extra\":0}")]
  [InlineData("{\"schemaVersion\":1,\"schemaVersion\":1,\"job\":\"observe-publishing\"}")]
  public async Task InvalidEventsNeverOpenConnection(string input)
  {
    var opened = false;
    var lines = new List<string>();
    var function = new Observer(() => { opened = true; throw new Exception(); }, lines.Add, () => "DeveloperCardsConsoleS2_local");
    var response = await function.Handler(Event(input), null);
    Assert.False(opened);
    Assert.Equal("INVALID_CONFIG", response.Reason);
    Assert.DoesNotContain("PublishStalled", lines[0]);
  }

  [Fact]
  public async Task InvalidNamespaceNeverOpensConnectionOrEmitsMetric()
  {
    var opened = false;
    var lines = new List<string>();
    var function = new Observer(() => { opened = true; throw new Exception(); }, lines.Add, () => "bad\nnamespace");
    Assert.Equal("INVALID_CONFIG", (await function.Handler(Event(), null)).Reason);
    Assert.False(opened);
    Assert.DoesNotContain("_aws", string.Join("", lines));
    Assert.DoesNotContain("DeveloperCards", string.Join("", lines));
  }

  [Fact]
  public async Task UntrustedIdentifiersAreRedactedAndLogBytesBounded()
  {
    await database.Reset();
    await database.Execute("""
      insert into deck_publishes select 'job-'||n,repeat('x',128),repeat('y',128),'PENDING',now()-interval '1 hour',now()
        from generate_series(1,21) n;
      update deck_publishes set build_id='secret@example.com' where job_id='job-1';
      """);
    var lines = new List<string>();
    var response = await Handler(lines).Handler(Event(), null);
    Assert.DoesNotContain("secret@example.com", JsonSerializer.Serialize(response));
    Assert.Equal("redacted", response.Items.First(i => i.JobId == "job-1").BuildId);
    Assert.Equal(2, lines.Count);
    Assert.True(Encoding.UTF8.GetByteCount(lines[1]) <= 8192);
    Assert.True(lines.Sum(line => Encoding.UTF8.GetByteCount(line) + 1) <= 12288);
  }
}
