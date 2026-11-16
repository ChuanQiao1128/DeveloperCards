using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;
using static RecallSmith.Lambda.IntegrationTests.ConsoleOperationsCanaryTests;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class EntitlementAvailabilityTests(PostgresFixture db)
{
  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task Missing_subscription_source_is_unavailable_even_with_a_legacy_grant(bool legacy)
  {
    var scratch = "entitlement_failure_" + Guid.NewGuid().ToString("N");
    var connectionString = await db.CreateScratchDatabaseAsync(scratch);
    await using (var conn = new Npgsql.NpgsqlConnection(connectionString))
    {
      await conn.OpenAsync();
      await DbUtil.ExecuteAsync(conn, null, "create table user_entitlements(user_sub text,entitlement_key text,tier text,expires_at timestamptz)", []);
      if (legacy) await DbUtil.ExecuteAsync(conn, null, "insert into user_entitlements values('paying-user','premium_all','premium',null)", []);
    }
    var previous = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", scratch); Pg.Reset();
      var response = await Entitlements.HandleEntitlements(Request(), new Res("source-unavailable"), Admin with { UserSub = "paying-user" });
      AssertUnavailable(response);
      Assert.DoesNotContain("user_premium_state", response.Body);
      Assert.DoesNotContain("paying-user", response.Body);
    }
    finally { Environment.SetEnvironmentVariable("PGDATABASE", previous); Pg.Reset(); }
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task Missing_database_configuration_never_becomes_free_or_a_payment_denial(bool download)
  {
    _ = db;
    var settings = new Dictionary<string, string?> { ["PGHOST"] = null, ["CONTENT_BUCKET"] = "test-content", ["PREMIUM_BUCKET"] = "test-premium", ["DEV_BYPASS_ENABLED"] = "false" };
    var previous = settings.Keys.ToDictionary(key => key, Environment.GetEnvironmentVariable);
    try
    {
      foreach (var pair in settings) Environment.SetEnvironmentVariable(pair.Key, pair.Value);
      Pg.Reset();
      var response = download
        ? await PremiumDeckUrl.HandlePremiumDeckUrl(Request(), new Dictionary<string, string> { ["slug"] = "test-premium" }, new Res("download-unavailable"), Admin with { UserSub = "paying-user" })
        : await Entitlements.HandleEntitlements(Request(), new Res("entitlements-unavailable"), Admin with { UserSub = "paying-user" });
      AssertUnavailable(response);
      Assert.DoesNotContain("Requires premium", response.Body);
    }
    finally { foreach (var pair in previous) Environment.SetEnvironmentVariable(pair.Key, pair.Value); Pg.Reset(); }
  }

  private static void AssertUnavailable(Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse response)
  {
    Assert.Equal(503, response.StatusCode);
    using var body = JsonDocument.Parse(response.Body);
    Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("data").ValueKind);
    Assert.Equal("ENTITLEMENTS_UNAVAILABLE", body.RootElement.GetProperty("error").GetProperty("code").GetString());
    Assert.Equal("30", response.Headers["Retry-After"]);
  }
}
