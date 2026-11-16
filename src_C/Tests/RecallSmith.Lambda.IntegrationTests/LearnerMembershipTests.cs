using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Operations;
using static RecallSmith.Lambda.IntegrationTests.ConsoleOperationsCanaryTests;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class LearnerMembershipTests(PostgresFixture db)
{
  private async Task<string> User(string prefix, string suffix)
  {
    var sub = prefix + suffix;
    await db.QueryAsync("insert into users(user_sub) values($1)", sub);
    return sub;
  }

  [Fact]
  public async Task Directory_distinguishes_production_sandbox_expiry_and_scoped_legacy_access()
  {
    var prefix = "member-" + Guid.NewGuid().ToString("N");
    var now = DateTimeOffset.UtcNow;
    var production = await User(prefix, "-a"); var sandbox = await User(prefix, "-b");
    var expired = await User(prefix, "-c"); var legacy = await User(prefix, "-d"); var free = await User(prefix, "-e");
    foreach (var (sub, env, ends) in new[] { (production, "production", now.AddDays(3)), (sandbox, "sandbox", now.AddDays(20)), (expired, "production", now.AddDays(-1)) })
      await db.QueryAsync("insert into user_premium_state(app_user_id,premium_active,premium_env,expires_at_ms) values($1,true,$2,$3)", sub, env, ends.ToUnixTimeMilliseconds());
    await db.QueryAsync("insert into user_entitlements(user_sub,entitlement_key,tier,source,expires_at) values($1,'deck:aws','premium','manual',$2)", legacy, now.AddDays(2).UtcDateTime);
    var old = Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM"); Environment.SetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM", "true");
    try
    {
      var response = await ConsoleOperations.HandleLearners(Request(query: new() { ["query"] = prefix }), new Res("membership"), Admin);
      Assert.Equal(200, response.StatusCode);
      var rows = Data(response).GetProperty("items").EnumerateArray().ToDictionary(r => r.GetProperty("sub").GetString()!);
      JsonElement Membership(string sub) => rows[sub].GetProperty("membership");
      Assert.Equal("premium", Membership(production).GetProperty("tier").GetString());
      Assert.Equal("production", Membership(production).GetProperty("environment").GetString());
      Assert.True(Membership(production).GetProperty("premiumDownloadEligible").GetBoolean());
      Assert.False(Membership(sandbox).GetProperty("premiumDownloadEligible").GetBoolean());
      Assert.Equal("expired", Membership(expired).GetProperty("status").GetString());
      Assert.Equal("free", Membership(expired).GetProperty("tier").GetString());
      Assert.Equal("legacy", Membership(legacy).GetProperty("source").GetString());
      Assert.Equal("selected_decks", Membership(legacy).GetProperty("scope").GetString());
      Assert.False(Membership(legacy).GetProperty("premiumDownloadEligible").GetBoolean());
      Assert.Equal("free", Membership(free).GetProperty("status").GetString());
      foreach (var (filters, expected) in new[] {
        (new Dictionary<string,string> { ["source"]="production", ["expiry"]="next7" }, production),
        (new Dictionary<string,string> { ["source"]="sandbox", ["membership"]="premium" }, sandbox),
        (new Dictionary<string,string> { ["expiry"]="expired" }, expired),
        (new Dictionary<string,string> { ["source"]="legacy", ["expiry"]="next7" }, legacy),
      })
      {
        filters["query"] = prefix;
        var result = await ConsoleOperations.HandleLearners(Request(query: filters), new Res("filtered"), Admin);
        Assert.Equal(200, result.StatusCode);
        Assert.Equal(expected, Assert.Single(Data(result).GetProperty("items").EnumerateArray()).GetProperty("sub").GetString());
      }
    }
    finally { Environment.SetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM", old); }
  }

  [Fact]
  public async Task Membership_filter_precedes_limit_and_cursor_is_bound_to_all_filters()
  {
    var prefix = "member-page-" + Guid.NewGuid().ToString("N");
    foreach (var suffix in new[] { "a", "b", "c", "d" })
    {
      var sub = await User(prefix, suffix);
      if (suffix != "a") await db.QueryAsync("insert into user_premium_state(app_user_id,premium_active,premium_env) values($1,true,'production')", sub);
    }
    var parameters = new Dictionary<string,string> { ["query"] = prefix, ["membership"] = "premium", ["source"] = "production", ["limit"] = "1" };
    var first = await ConsoleOperations.HandleLearners(Request(query: parameters), new Res("member-first"), Admin);
    Assert.Equal(200, first.StatusCode);
    var page = Data(first);
    Assert.Equal(prefix + "b", page.GetProperty("items")[0].GetProperty("sub").GetString());
    parameters["cursor"] = page.GetProperty("nextCursor").GetString()!;
    var next = await ConsoleOperations.HandleLearners(Request(query: parameters), new Res("member-second"), Admin);
    Assert.Equal(prefix + "c", Data(next).GetProperty("items")[0].GetProperty("sub").GetString());
    foreach (var (key, value) in new[] { ("membership", "free"), ("source", "sandbox"), ("expiry", "next7") })
    {
      var changed = new Dictionary<string,string>(parameters) { [key] = value };
      Assert.Equal(400, (await ConsoleOperations.HandleLearners(Request(query: changed), new Res("cursor-mismatch"), Admin)).StatusCode);
    }
  }

  [Fact]
  public async Task Missing_membership_source_cannot_silently_label_the_directory_free()
  {
    var scratch = "member_source_" + Guid.NewGuid().ToString("N");
    var cs = await db.CreateScratchDatabaseAsync(scratch);
    await using (var conn = new Npgsql.NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      await DbUtil.ExecuteAsync(conn, null, "create table users(user_sub text,email text,created_at timestamptz default now(),last_seen_at timestamptz,last_platform text,last_version text);insert into users(user_sub) values('observed')", []);
    }
    var old = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", scratch); Pg.Reset();
      var response = await ConsoleOperations.HandleLearners(Request(), new Res("membership-source"), Admin);
      Assert.Equal(503, response.StatusCode);
      using var body = JsonDocument.Parse(response.Body);
      Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("data").ValueKind);
    }
    finally { Environment.SetEnvironmentVariable("PGDATABASE", old); Pg.Reset(); }
  }
}
