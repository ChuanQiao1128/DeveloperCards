using Npgsql;
using RecallSmith.Lambda.Common;
using Amazon.Lambda.APIGatewayEvents;

namespace RecallSmith.Lambda.Vpc.Db;

// Only reached after the existing DB ping's RequireAdmin check; no schema creation or repair.
public static class Readiness
{
  public const int MinimumSchema = 55;
  public static async Task<APIGatewayProxyResponse> Check(NpgsqlConnection conn, Res res)
  {
    var exists = await DbUtil.ExecuteScalarAsync(conn, null,
      "select to_regclass('public.schema_migrations') is not null", []) is true;
    if (!exists) return res.Raw(503, new { ok = false, code = "SCHEMA_NOT_READY" });
    var version = Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, null,
      "select coalesce(max(version),0) from schema_migrations", []));
    // Probe an ordinary deployed data table as well as the migration ledger. No rows are disclosed.
    await DbUtil.ExecuteScalarAsync(conn, null, "select exists(select 1 from decks limit 1)", []);
    var ok = version >= MinimumSchema;
    return res.Raw(ok ? 200 : 503, new { ok, schemaVersion = version, minimumSchema = MinimumSchema });
  }
}
