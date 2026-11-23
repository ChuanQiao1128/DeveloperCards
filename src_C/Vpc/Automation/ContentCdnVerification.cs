using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>Signed callback from the public-network verifier for one reviewed public build.</summary>
internal static class ContentCdnVerification
{
  internal const string Prepare = "prepare-content-cdn";
  internal const string Report = "report-content-cdn";

  internal static async Task<APIGatewayProxyResponse> HandleAsync(JsonElement body, string operation, Res res)
  {
    if (!body.TryGetProperty("v", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var v) || v != 1 ||
        !Guid.TryParseExact(AutomationBody.OptionalString(body, "jobId", 36), "D", out var id))
      return res.BadRequest("BAD_REQUEST", "A v1 publish job ID is required.");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing database configuration");
    if (!await PublishCdnVerification.ReadyAsync(conn)) return res.Ok(new { skip = true });
    var jobId = id.ToString("D");
    return operation == Prepare
      ? res.Ok(await PrepareAsync(conn, jobId))
      : res.Ok(await RecordAsync(conn, jobId, body));
  }

  private const string Current = $$"""
    from publish_cdn_verification v join deck_publishes p using(job_id)
    join decks d on d.id=p.deck_id left join publish_manifest_delivery m using(job_id)
    where p.job_id=$1 and d.slug=p.deck_slug and d.is_deleted=0
      and ((p.deck_slug='aws-saa-fundamentals' and p.release_receipt_id is not null and p.release_generation=d.release_generation)
        or (p.deck_slug<>'aws-saa-fundamentals' and exists(select 1 from publish_dispatch s where s.job_id=p.job_id
          and starts_with(s.action_id,'{{PublishCdnVerification.ReviewedBatchActionPrefix}}'))))
      and p.content_sha256=v.sha256 and v.verified_at is null and v.failure_code is null
      and (p.status='PROCESSING' or (p.status='SUCCESS' and d.live_build_id=p.build_id))
    """;

  internal static async Task<object> PrepareAsync(NpgsqlConnection conn, string jobId)
  {
    const string sql = "select p.status,p.deck_slug,p.build_id,p.content_bytes,v.sha256,v.card_count,m.state " + Current;
    var rows = await DbUtil.QueryAsync(conn, null, sql, [jobId]);
    if (rows.Count == 0) return new { skip = true };
    if (rows[0]["status"] as string != "SUCCESS") return new { retry = true };
    if (rows[0]["state"] as string == "pending")
    {
      await PublishDelivery.DeliverManifest(conn, jobId, () => Publish.RebuildControlledManifest(conn));
      rows = await DbUtil.QueryAsync(conn, null, sql, [jobId]);
      if (rows.Count == 0) return new { skip = true };
    }
    var row = rows[0];
    if (row["state"] as string == "needs_attention") return new { skip = true };
    if (row["state"] as string != "delivered") return new { retry = true };
    return new { slug = row["deck_slug"], buildId = row["build_id"], sha256 = row["sha256"], cards = row["card_count"], bytes = row["content_bytes"] };
  }

  internal static async Task<object> RecordAsync(NpgsqlConnection conn, string jobId, JsonElement body)
  {
    var buildId = AutomationBody.OptionalString(body, "buildId", 100);
    var sha256 = AutomationBody.OptionalString(body, "sha256", 64);
    if (string.IsNullOrEmpty(buildId) || sha256 is null || sha256.Length != 64)
      throw new ValidationError("The checked build and its expected hash are required.", "buildId");
    var failure = AutomationBody.OptionalString(body, "failure", 40);
    if (failure is not (null or "INDEX_MISMATCH" or "HASH_MISMATCH" or "CDN_UNAVAILABLE"))
      throw new ValidationError("Unknown CDN verification result.", "failure");

    await using var tx = await conn.BeginTransactionAsync(RequestBudget.Token);
    // Use the same deck lock as the publish/rollback path during the final current-version check.
    var current = await DbUtil.QueryAsync(conn, tx,
      "select d.id " + Current + " and p.status='SUCCESS' and m.state='delivered' and p.build_id=$2 and v.sha256=$3 for update of d",
      [jobId, buildId, sha256]);
    if (current.Count == 0) return new { skip = true };
    // Recheck after acquiring the deck lock, including any manifest reset by rollback.
    var updated = await DbUtil.ExecuteAsync(conn, tx, $"""
      update publish_cdn_verification set verified_at=case when $4::text is null then clock_timestamp() end,failure_code=$4
      where job_id in (select p.job_id {Current}
       and p.status='SUCCESS' and m.state='delivered' and p.build_id=$2 and v.sha256=$3)
      and verified_at is null and failure_code is null
      """, [jobId, buildId, sha256, failure]);
    if (updated != 1) return new { skip = true };
    if (failure is not null) await ContentPublishFailureEvents.EnqueueAsync(jobId, "verification", 30);
    await tx.CommitAsync(RequestBudget.Token);
    return new { recorded = true };
  }
}
