using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class ProgressEventsSchemaCompatibilityTests
{
  private readonly PostgresFixture _db;
  private static readonly long T = DateTimeOffset.UtcNow.AddDays(-5).ToUnixTimeMilliseconds();
  private const long DayMs = 24L * 60 * 60 * 1000;

  public ProgressEventsSchemaCompatibilityTests(PostgresFixture db) => _db = db;

  private static object Review(string id, long time, int rating, int stage, int revision, bool model = false)
  {
    var progress = new Dictionary<string, object> { ["stage"] = stage, ["lastSeenRevision"] = revision };
    if (model)
    {
      progress["lapses"] = rating;
      progress["hardStreak"] = stage;
      progress["fsrsStability"] = (double)rating;
      progress["fsrsDifficulty"] = 5.0;
      progress["fsrsAnchorAt"] = time;
      progress["fsrsReviewedAt"] = time;
    }
    return new
    {
      eventId = id, deckSlug = "schema-compat", stableUid = "one", rating,
      eventTimeMs = time, nextReviewAtMs = time + rating * DayMs,
      schedulerVersion = $"v{rating}", progressAfter = progress,
    };
  }

  private static Task<JsonElement> Push(string user, params object[] events) =>
    LambdaHost.PostProgressEventsAsync(user, new { events });

  private static async Task<JsonElement> Get(string user) =>
    (await LambdaHost.GetProgressAsync(user)).GetProperty("items").EnumerateArray().Single();

  private static async Task<APIGatewayProxyResponse> PushResponse(string user, params object[] events)
  {
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/progress/events",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
      headers = new Dictionary<string, string>(), body = JsonSerializer.Serialize(new { events }),
      isBase64Encoded = false,
    });
    var req = new LambdaRequest(evt);
    var auth = new AuthContext(new Dictionary<string, JsonElement>(), user, user, [], false, false, false);
    return await ProgressEvents.HandleProgressEvents(req, new Res(req.TraceId), auth);
  }

  [Theory]
  [InlineData(44)]
  [InlineData(47)]
  public async Task LegacySchema_AcceptsStageOnlyReplay_AndDefersWholeModelBatch(int maxVersion)
  {
    var database = $"progress_legacy_{Guid.NewGuid():N}";
    var cs = await _db.CreateScratchDatabaseAsync(database);
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion);
    var previousDatabase = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", database);
      Pg.Reset();
      var user = $"legacy-{Guid.NewGuid():N}";
      var newest = Review(Guid.NewGuid().ToString(), T + 1000, 4, 6, 2);
      var oldest = Review(Guid.NewGuid().ToString(), T, 1, 0, 9);
      Assert.Equal(1, (await Push(user, newest)).GetProperty("acceptedCount").GetInt32());
      Assert.Equal(1, (await Push(user, oldest)).GetProperty("acceptedCount").GetInt32());
      var replay = await Push(user, newest, oldest);
      Assert.Equal(0, replay.GetProperty("acceptedCount").GetInt32());
      Assert.Equal(2, replay.GetProperty("duplicateEventIds").GetArrayLength());
      var row = await Get(user);
      Assert.Equal(2, row.GetProperty("reviewCount").GetInt32());
      Assert.Equal(4, row.GetProperty("lastRating").GetInt32());
      Assert.Equal(6, row.GetProperty("srsStage").GetInt32());
      Assert.Equal(T + 1000 + 4 * DayMs, row.GetProperty("nextReviewAtMs").GetInt64());
      Assert.Equal(9, row.GetProperty("lastSeenRevision").GetInt32());
      Assert.Equal(JsonValueKind.Null, row.GetProperty("lastReviewEventId").ValueKind);
      Assert.Equal(JsonValueKind.Null, row.GetProperty("schedulerState").ValueKind);
      Assert.Equal(2L, await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from user_progress_events where user_sub=$1", [user]));
      if (maxVersion == 44)
        Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from analytics_event_outbox", []));

      var deferred = $"deferred-{Guid.NewGuid():N}";
      var response = await PushResponse(deferred, oldest,
        Review(Guid.NewGuid().ToString(), T, 3, 2, 1, model: true));
      Assert.Equal(503, response.StatusCode);
      using var body = JsonDocument.Parse(response.Body);
      Assert.Equal("SCHEDULER_STATE_NOT_READY", body.RootElement.GetProperty("error").GetProperty("code").GetString());
      Assert.False(body.RootElement.TryGetProperty("acceptedEventIds", out _));
      Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from user_progress_events where user_sub=$1", [deferred]));
      Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from users where user_sub=$1", [deferred]));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", previousDatabase);
      Pg.Reset();
    }
  }

  [Fact]
  public async Task Migration057_WarmWriterObservesNewColumn_AndKeepsLegacyBaseline()
  {
    var database = $"progress_order_rollout_{Guid.NewGuid():N}";
    var cs = await _db.CreateScratchDatabaseAsync(database);
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 56);
    var previousDatabase = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", database);
      Pg.Reset();
      var user = $"order-rollout-{Guid.NewGuid():N}";
      Assert.Equal(1, (await Push(user,
        Review(Guid.NewGuid().ToString(), T, 2, 3, 3, model: true))).GetProperty("acceptedCount").GetInt32());
      var legacy = await Get(user);
      Assert.Equal(JsonValueKind.Null, legacy.GetProperty("lastReviewEventId").ValueKind);
      Assert.Equal(2, legacy.GetProperty("schedulerState").GetProperty("lapses").GetInt32());
      await DbUtil.ExecuteAsync(conn, null,
        "update user_progress set review_count=7, status=2 where user_sub=$1", [user]);

      var sql = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "057_progress_event_order.sql"));
      await DbUtil.ExecuteAsync(conn, null, sql, []);
      await DbUtil.ExecuteAsync(conn, null, sql, []);
      var baseline = await Get(user);
      Assert.Equal(JsonValueKind.Null, baseline.GetProperty("lastReviewEventId").ValueKind);
      Assert.Equal(2, baseline.GetProperty("schedulerState").GetProperty("lapses").GetInt32());

      // No Pg.Reset or readiness reset: the false capability result must not be cached.
      var suffix = Guid.NewGuid().ToString()[1..];
      var highId = "f" + suffix;
      var high = Review(highId, T, 4, 6, 2, model: true);
      var low = Review("1" + suffix, T, 1, 0, 9, model: true);
      Assert.Equal(1, (await Push(user, high)).GetProperty("acceptedCount").GetInt32());
      Assert.Equal(1, (await Push(user, low)).GetProperty("acceptedCount").GetInt32());
      Assert.Equal(0, (await Push(user, high, low)).GetProperty("acceptedCount").GetInt32());
      var row = await Get(user);
      Assert.Equal(highId, row.GetProperty("lastReviewEventId").GetString());
      Assert.Equal(9, row.GetProperty("reviewCount").GetInt32());
      Assert.Equal(2, row.GetProperty("status").GetInt32());
      Assert.Equal(4, row.GetProperty("lastRating").GetInt32());
      Assert.Equal(6, row.GetProperty("srsStage").GetInt32());
      Assert.Equal(9, row.GetProperty("lastSeenRevision").GetInt32());
      Assert.Equal(T + 4 * DayMs, row.GetProperty("nextReviewAtMs").GetInt64());
      var state = row.GetProperty("schedulerState");
      Assert.Equal(6, state.EnumerateObject().Count());
      Assert.Equal(4, state.GetProperty("lapses").GetInt32());
      Assert.Equal(6, state.GetProperty("hardStreak").GetInt32());
      Assert.Equal(4.0, state.GetProperty("fsrsStability").GetDouble());
      Assert.Equal(5.0, state.GetProperty("fsrsDifficulty").GetDouble());
      Assert.Equal(T, state.GetProperty("fsrsAnchorAt").GetInt64());
      Assert.Equal(T, state.GetProperty("fsrsReviewedAt").GetInt64());
      Assert.Equal("v4", await DbUtil.ExecuteScalarAsync(conn, null,
        "select last_scheduler_version from user_progress where user_sub=$1", [user]));
      Assert.Equal(3L, await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from user_progress_events where user_sub=$1", [user]));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", previousDatabase);
      Pg.Reset();
    }
  }
}
