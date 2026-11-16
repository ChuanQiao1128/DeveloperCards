using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Operations;

public static partial class ConsoleOperations
{
  public const string OverviewPath = "/api/v1/admin/operations/overview";
  public const string LearnersPath = "/api/v1/admin/learners";
  private const string UserColumns = "user_sub, email, created_at, last_seen_at, last_platform, last_version";
  public static bool IsRoute(string path) => path.TrimEnd('/') == OverviewPath || path.TrimEnd('/') == LearnersPath || path.StartsWith(LearnersPath + "/", StringComparison.Ordinal);
  // The verifier logs its request path on denial. Preserve its claims/headers but bound that path before it runs.
  public static LambdaRequest AuthRequest(LambdaRequest req)
  {
    var fields = req.RawEvent.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
    fields["rawPath"] = JsonSerializer.SerializeToElement(RouteMetrics.RouteFor(req.Path));
    fields["path"] = fields["rawPath"];
    return new LambdaRequest(JsonSerializer.SerializeToElement(fields));
  }
  public static APIGatewayProxyResponse Private(APIGatewayProxyResponse response)
  {
    response.Headers ??= new Dictionary<string, string>();
    response.Headers["Cache-Control"] = "private, no-store";
    return response;
  }
  private static APIGatewayProxyResponse? Deny(AuthContext auth, Res res)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return Private(deny);
    if (auth.IsAgentClient || string.IsNullOrWhiteSpace(auth.UserSub)) return Private(res.Forbidden("Requires a console super_admin"));
    return null;
  }
  private sealed class AuditUnavailableException : Exception;
  private static APIGatewayProxyResponse Unavailable(Res res) => Private(res.ServiceUnavailable("SERVICE_UNAVAILABLE", "Required source unavailable", 30));
  private static APIGatewayProxyResponse Invalid(Res res) => Private(res.BadRequest("VALIDATION_ERROR", "Invalid request parameters"));
  private static bool Text(string? value, int max = 128) => !string.IsNullOrEmpty(value) && value.Length <= max && !value.Any(char.IsControl);
  private static bool Limit(LambdaRequest req, string key, out int limit)
  {
    limit = 25;
    return !req.Query.TryGetValue(key, out var raw) || (int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out limit) && limit is >= 1 and <= 100);
  }
  private static string Encode(object cursor) => Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(cursor)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
  private static JsonElement Decode(string raw, params string[] fields)
  {
    if (raw.Length is 0 or > 2048 || raw.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_')) throw new FormatException();
    var bytes = Convert.FromBase64String(raw.Replace('-', '+').Replace('_', '/') + new string('=', (4 - raw.Length % 4) % 4));
    using var doc = JsonDocument.Parse(bytes);
    var e = doc.RootElement;
    if (e.ValueKind != JsonValueKind.Object || e.EnumerateObject().Count() != fields.Length || e.EnumerateObject().Any(p => !fields.Contains(p.Name)) || fields.Any(f => !e.TryGetProperty(f, out _)) || e.GetProperty("v").GetInt32() != 1) throw new FormatException();
    return e.Clone();
  }
  private static object Row(Dictionary<string, object?> row) => new
  {
    sub = row["user_sub"], email = row["email"], firstObservedAt = row["created_at"], lastServerActivityAt = row["last_seen_at"], lastReportedPlatform = row["last_platform"], lastReportedVersion = row["last_version"],
  };
  private static async Task Audit(NpgsqlConnection conn, NpgsqlTransaction tx, AuthContext auth, Res res, string action, string target)
  {
    if (!await AdminAudit.RecordAsync(conn, tx, new AdminAuditEntry(auth.UserSub, null, action, target, null, null, res.TraceId))) throw new AuditUnavailableException();
  }
  public static async Task<APIGatewayProxyResponse> HandleLearners(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Deny(auth, res); if (deny is not null) return deny;
    if (req.Method != "GET") return Private(res.MethodNotAllowed());
    if (req.Query.Keys.Any(k => k is not ("query" or "limit" or "cursor")) || !Limit(req, "limit", out var limit)) return Invalid(res);
    var rawQuery = req.Query.GetValueOrDefault("query", "");
    if (rawQuery.Any(char.IsControl)) return Invalid(res);
    var query = rawQuery.Trim();
    if (query.Length > 128 || query.Any(char.IsControl)) return Invalid(res);
    var after = ""; DateTime? asOf = null;
    if (req.Query.TryGetValue("cursor", out var raw))
    {
      try
      {
        var c = Decode(raw, "v", "query", "limit", "afterSub", "asOf");
        after = c.GetProperty("afterSub").GetString()!;
        if (c.GetProperty("query").GetString() != query || c.GetProperty("limit").GetInt32() != limit || !Text(after) || after.Contains('/')) return Invalid(res);
        var stamp = Stamp(c.GetProperty("asOf"));
        if (stamp.Offset != TimeSpan.Zero || stamp > DateTimeOffset.UtcNow.AddSeconds(60)) return Invalid(res);
        asOf = stamp.UtcDateTime;
      }
      catch { return Invalid(res); }
    }
    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync(); if (conn is null) return Unavailable(res);
      await using var tx = await conn.BeginTransactionAsync(RequestBudget.Token);
      asOf ??= (DateTime)(await DbUtil.ExecuteScalarAsync(conn, tx, "select now()", []))!;
      var pattern = "%" + query.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
      var rows = await DbUtil.QueryAsync(conn, tx, $"select {UserColumns} from users where created_at <= $1 and user_sub COLLATE \"C\" > $2 COLLATE \"C\" and (user_sub ilike $3 escape '\\' or email ilike $3 escape '\\') order by user_sub COLLATE \"C\" limit $4", [asOf, after, pattern, limit + 1]);
      var more = rows.Count > limit; if (more) rows.RemoveAt(limit);
      var cursor = more ? Encode(new { v = 1, query, limit, afterSub = rows[^1]["user_sub"], asOf }) : null;
      await Audit(conn, tx, auth, res, "console.learners.list", "learners");
      await tx.CommitAsync(RequestBudget.Token);
      return Private(res.Ok(new { scope = "backend_observed_users", fetchedAt = DateTimeOffset.UtcNow, asOf, items = rows.Select(Row), nextCursor = cursor }));
    }
    catch (Exception ex) when (ex is NpgsqlException or AuditUnavailableException or OperationCanceledException or TimeoutException) { return Unavailable(res); }
    catch { return Private(res.Error500(null)); }
  }
}
