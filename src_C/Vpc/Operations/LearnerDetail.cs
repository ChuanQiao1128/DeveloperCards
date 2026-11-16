using System.Data;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Operations;

public static partial class ConsoleOperations
{
  public static async Task<APIGatewayProxyResponse> HandleLearner(LambdaRequest req, Res res, AuthContext auth, DateTimeOffset? evaluatedAt = null)
  {
    var deny = Deny(auth, res); if (deny is not null) return deny;
    if (req.Method != "GET") return Private(res.MethodNotAllowed());
    string sub;
    try
    {
      var encoded = req.Path[(LearnersPath.Length + 1)..];
      for (var i = 0; i < encoded.Length; i++)
        if (encoded[i] == '%' && (i + 2 >= encoded.Length || !Uri.IsHexDigit(encoded[i + 1]) || !Uri.IsHexDigit(encoded[i + 2]))) return Invalid(res);
      sub = Uri.UnescapeDataString(encoded);
    }
    catch { return Invalid(res); }
    if (!Text(sub) || sub.Contains('/') || req.Query.Keys.Any(k => k is not ("deckLimit" or "deckCursor")) || !Limit(req, "deckLimit", out var limit)) return Invalid(res);
    var after = "";
    if (req.Query.TryGetValue("deckCursor", out var raw))
    {
      try
      {
        var c = Decode(raw, "v", "sub", "afterSlug"); after = c.GetProperty("afterSlug").GetString()!;
        if (c.GetProperty("sub").GetString() != sub || !Text(after, 256)) return Invalid(res);
      }
      catch { return Invalid(res); }
    }
    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync(); if (conn is null) return Unavailable(res);
      // A single repeatable-read snapshot includes existence, evidence and the required audit.
      await using var tx = await conn.BeginTransactionAsync(IsolationLevel.RepeatableRead, RequestBudget.Token);
      var users = await DbUtil.QueryAsync(conn, tx, $"select {UserColumns} from users where user_sub=$1", [sub]);
      if (users.Count == 0) return Private(res.NotFound("Learner not found"));
      var now = evaluatedAt ?? DateTimeOffset.UtcNow;
      var rc = await Optional(conn, tx, "select premium_active,premium_env,product_id,expires_at_ms,updated_at,last_event_ts_ms from user_premium_state where app_user_id=$1", [sub]);
      var legacy = await Optional(conn, tx, "select entitlement_key,tier,source,expires_at,updated_at from user_entitlements where user_sub=$1 order by entitlement_key COLLATE \"C\" limit 101", [sub]);
      var activeLegacy = await Optional(conn, tx, "select exists(select 1 from user_entitlements where user_sub=$1 and tier='premium' and (entitlement_key='premium_all' or starts_with(entitlement_key,'deck:')) and (expires_at is null or expires_at>$2)) as active", [sub, now.UtcDateTime]);
      var entitlements = EntitlementEvidence(rc, legacy, activeLegacy, now, (Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM")?.Trim().ToLowerInvariant() is "1" or "true" or "yes"));
      var totals = await Optional(conn, tx, """
        select (select count(*) from user_progress_events where user_sub=$1) as events,
          (select max(event_time) from user_progress_events where user_sub=$1) as event_at,
          (select max(server_received_at) from user_progress_events where user_sub=$1) as received_at,
          (select count(*) from user_progress where user_sub=$1) as cards,
          (select coalesce(sum(review_count),0) from user_progress where user_sub=$1) as reviews
        """, [sub]);
      var decks = await Optional(conn, tx, """
        with p as (select deck_slug,count(*) as cards,sum(review_count) as reviews from user_progress where user_sub=$1 group by deck_slug),
        e as (select deck_slug,count(*) as events,max(event_time) as event_at,max(server_received_at) as received_at from user_progress_events where user_sub=$1 group by deck_slug)
        select coalesce(p.deck_slug,e.deck_slug) as slug,coalesce(p.cards,0) as cards,coalesce(p.reviews,0) as reviews,coalesce(e.events,0) as events,e.event_at,e.received_at
        from p full join e on p.deck_slug=e.deck_slug where coalesce(p.deck_slug,e.deck_slug) COLLATE "C" > $2 COLLATE "C"
        order by coalesce(p.deck_slug,e.deck_slug) COLLATE "C" limit $3
        """, [sub, after, limit + 1]);
      var known = totals is not null && decks is not null;
      var more = known && decks!.Count > limit; if (more) decks!.RemoveAt(limit);
      var progress = new
      {
        state = known ? "known" : "unknown",
        uniqueReceivedEventCount = known ? totals![0]["events"] : null,
        latestEventAt = known ? totals![0]["event_at"] : null,
        latestReceivedAt = known ? totals![0]["received_at"] : null,
        projectedCardCount = known ? totals![0]["cards"] : null,
        projectedReviewCount = known ? totals![0]["reviews"] : null,
        decks = known ? decks!.Select(d => new { deckSlug = d["slug"], projectedCardCount = d["cards"], projectedReviewCount = d["reviews"], uniqueReceivedEventCount = d["events"], latestEventAt = d["event_at"], latestReceivedAt = d["received_at"] }).ToArray() : [],
        nextDeckCursor = more ? Encode(new { v = 1, sub, afterSlug = decks![^1]["slug"] }) : null,
      };
      await Audit(conn, tx, auth, res, "console.learners.detail", sub);
      await tx.CommitAsync(RequestBudget.Token);
      return Private(res.Ok(new { scope = "backend_observed_users", fetchedAt = DateTimeOffset.UtcNow, learner = Row(users[0]), entitlements, progress, device = new { queueState = "unknown", pendingEventCount = (int?)null, completeSyncState = "unknown", runningOtaVersion = (string?)null } }));
    }
    catch (Exception ex) when (ex is Npgsql.NpgsqlException or AuditUnavailableException or OperationCanceledException or TimeoutException) { return Unavailable(res); }
    catch { return Private(res.Error500(null)); }
  }
  private static async Task<List<Dictionary<string, object?>>?> Optional(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, object?[] args)
  {
    await tx.SaveAsync("optional_source", RequestBudget.Token);
    try { var rows = await DbUtil.QueryAsync(conn, tx, sql, args); await tx.ReleaseAsync("optional_source", RequestBudget.Token); return rows; }
    catch { await tx.RollbackAsync("optional_source", RequestBudget.Token); await tx.ReleaseAsync("optional_source", RequestBudget.Token); return null; }
  }
  private static bool Truth(object? value) => Convert.ToString(value)?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "y";
  private static object EntitlementEvidence(List<Dictionary<string, object?>>? rc, List<Dictionary<string, object?>>? legacy, List<Dictionary<string, object?>>? activeLegacy, DateTimeOffset now, bool sandboxBlocked)
  {
    var r = rc?.FirstOrDefault();
    var expires = r?["expires_at_ms"] is { } x ? Convert.ToInt64(x) : (long?)null;
    bool? active = rc is null ? null : expires is not null ? expires > now.ToUnixTimeMilliseconds() : r is not null && Truth(r["premium_active"]);
    var sandbox = string.Equals(Convert.ToString(r?["premium_env"])?.Trim(), "sandbox", StringComparison.OrdinalIgnoreCase);
    var legacyActive = activeLegacy is null ? (bool?)null : (bool)activeLegacy[0]["active"]!;
    // Unknown RC can change the winning source even when legacy independently proves premium.
    var tier = active == true || legacyActive == true ? "premium" : active is null || legacyActive is null ? "unknown" : "free";
    var source = active == true ? "revenuecat" : active is null ? "unknown" : legacyActive == true ? "legacy" : legacyActive is null ? "unknown" : "none";
    return new
    {
      state = rc is null && legacy is null && activeLegacy is null ? "unknown" : rc is null || legacy is null || activeLegacy is null ? "partial" : "known",
      evaluatedAt = now,
      revenueCat = new { state = rc is null ? "unknown" : r is null ? "absent" : "present", premiumActiveRaw = r?["premium_active"], environment = r?["premium_env"], productId = r?["product_id"], expiresAtMs = expires, updatedAt = r?["updated_at"], lastEventAtMs = r?["last_event_ts_ms"] },
      legacy = new { state = legacy is null ? "unknown" : "known", items = legacy?.Take(100).Select(l => new { key = l["entitlement_key"], tier = l["tier"], source = l["source"], expiresAt = l["expires_at"], updatedAt = l["updated_at"] }).ToArray() ?? [], truncated = legacy?.Count > 100 },
      effective = new { entitlementsTier = tier, entitlementsSource = source, premiumDownloadEligible = active is null ? (bool?)null : active.Value && !(sandboxBlocked && sandbox), downloadReason = active is null ? "source_unavailable" : active != true ? "inactive_or_absent_rc" : sandboxBlocked && sandbox ? "sandbox_disallowed" : "active_rc", disallowSandboxPremium = sandboxBlocked, devBypass = "not_evaluated" },
    };
  }
}
