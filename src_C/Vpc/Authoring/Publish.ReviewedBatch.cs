using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static partial class Publish
{
  internal static bool CanPublishReviewedBatch(AuthContext auth) =>
    auth.IsSuperAdmin && !auth.IsAgentClient && !string.IsNullOrWhiteSpace(auth.UserSub);

  internal sealed record ReviewedBaseline(string EditingSnapshot, string? LiveBuildId);

  internal static async Task<ReviewedBaseline?> ReviewedBatchBaseline(NpgsqlConnection conn, NpgsqlTransaction tx, long deckId)
  {
    // The last live build must be the entire editing baseline. This prevents
    // an unrelated unpublished edit from riding along with a reviewed batch.
    if (!await PublishDelivery.Ready(conn, tx) || !await PublishCdnVerification.ReadyAsync(conn, tx)) return null;
    var rows = await DbUtil.QueryAsync(conn, tx, """
      select d.slug,d.live_build_id,d.deck_type,d.tier,d.availability,content_editing_snapshot(d.id) as editing,
        p.publish_editing_snapshot as published,
        exists(select 1 from cards c where c.deck_id=d.id and c.is_deleted=0) as has_cards,
        exists(select 1 from deck_publishes a where a.deck_id=d.id and a.status in ('PENDING','PROCESSING')) as active_publish,
        coalesce(starts_with(s.action_id,$2),false) and v.verified_at is null as awaiting_cdn
      from decks d left join deck_publishes p on p.deck_id=d.id and p.build_id=d.live_build_id and p.status='SUCCESS'
      left join publish_dispatch s on s.job_id=p.job_id left join publish_cdn_verification v on v.job_id=p.job_id
      where d.id=$1 and d.is_deleted=0
      """, [deckId, PublishCdnVerification.ReviewedBatchActionPrefix]);
    if (rows.Count != 1) return null;
    var row = rows[0];
    if (row["slug"] as string == ContentRelease.DeckSlug ||
        InferTier(Convert.ToInt64(row["deck_type"]), row["tier"]) != "free" ||
        row["availability"] as string != "live" || row["active_publish"] is true || row["awaiting_cdn"] is true) return null;
    var editing = (string)row["editing"]!;
    var live = row["live_build_id"] as string;
    return (live is null ? row["has_cards"] is false : Equals(editing, row["published"])) ? new(editing, live) : null;
  }

  private static async Task<APIGatewayProxyResponse> PreviewReviewedBatch(
    NpgsqlConnection conn, long deckId, AuthContext auth, Res res)
  {
    if (!CanPublishReviewedBatch(auth)) return res.Forbidden();
    await using var tx = await conn.BeginTransactionAsync(RequestBudget.Token);
    await DbUtil.QueryAsync(conn, tx, "select id from decks where id=$1 for update", [deckId]);
    var baseline = await ReviewedBatchBaseline(conn, tx, deckId);
    return res.Ok(new { baseline });
  }

  private static string ReviewedActionPrefix(string actorHash) =>
    PublishCdnVerification.ReviewedBatchActionPrefix + actorHash[..24] + ":";

  private static async Task<APIGatewayProxyResponse> FindReviewedBatch(
    NpgsqlConnection conn, long deckId, AuthContext auth, Res res)
  {
    if (!CanPublishReviewedBatch(auth)) return res.Forbidden();
    if (!await PublishDelivery.Ready(conn)) return res.Ok(new { batch = (object?)null });

    var actorHash = ContentRelease.Hash(auth.UserSub!);
    var rows = await DbUtil.QueryAsync(conn, null, """
      with latest as (
        select action_id, coalesce(result->>'body',result->>'Body')::jsonb #> '{data,reviewedPublish}' as approval
        from content_release_actions
        where deck_id=$1 and release_id=$2 and kind='cards/import'
          and jsonb_typeof(coalesce(result->>'body',result->>'Body')::jsonb #> '{data,reviewedPublish}')='object'
        order by created_at desc, action_id desc
        limit 1
      )
      select a.action_id,s.job_id,
        a.approval->>'editingSnapshot'=content_editing_snapshot(d.id)
          and (a.approval->>'liveBuildId') is not distinct from d.live_build_id
          and (s.job_id is null or (p.status='PENDING' and s.delivered_at is null and s.attempts<5)) as can_resume
      from latest a join decks d on d.id=$1 and d.is_deleted=0 and d.slug<>$4
      left join publish_dispatch s on s.deck_id=d.id and s.action_id=$3 || a.action_id
      left join deck_publishes p on p.job_id=s.job_id
      """, [deckId, "console-import-v1:" + actorHash, ReviewedActionPrefix(actorHash), ContentRelease.DeckSlug]);
    if (rows.Count == 0) return res.Ok(new { batch = (object?)null });
    return res.Ok(new { batch = new { operationId = rows[0]["action_id"], jobId = rows[0]["job_id"], canResume = rows[0]["can_resume"] is true } });
  }

  private static async Task<APIGatewayProxyResponse> PublishReviewedBatch(
    NpgsqlConnection conn, long deckId, JsonElement body, AuthContext auth, Res res)
  {
    if (!CanPublishReviewedBatch(auth)) return res.Forbidden();
    if (!Guid.TryParseExact(ContentRelease.Required(body, "reviewedImportOperationId"), "D", out var operation))
      throw new ValidationError("Invalid reviewed import operation.", "reviewedImportOperationId");
    var actorHash = ContentRelease.Hash(auth.UserSub!);
    var result = await DbUtil.ExecuteScalarAsync(conn, null, """
      select coalesce(result->>'body',result->>'Body') from content_release_actions where deck_id=$1 and release_id=$2 and action_id=$3 and kind='cards/import'
      """, [deckId, "console-import-v1:" + actorHash, operation.ToString("D")]) as string;
    if (result is null) return res.BadRequest("REVIEWED_IMPORT_REQUIRED", "Import receipt is missing.");
    using var doc = JsonDocument.Parse(result);
    var data = doc.RootElement.GetProperty("data");
    if (!data.TryGetProperty("reviewedPublish", out var ready) || ready.ValueKind != JsonValueKind.Object)
      return res.BadRequest("REVIEWED_IMPORT_REQUIRED", "Import was not confirmed for publishing.");
    var baseline = new ReviewedBaseline(ready.GetProperty("editingSnapshot").GetString()!,
      ready.GetProperty("liveBuildId").GetString());
    var action = ReviewedActionPrefix(actorHash) + operation.ToString("D");
    var start = await StartPublishAsync(conn, deckId, auth.UserSub!, null, bindSnapshot: true, expectedSnapshot: null,
      allowResume: false, actionId: action, requestHash: ContentRelease.PayloadHash(body), actorSuperadmin: true,
      reviewedBatch: baseline);
    // A replay can find a committed job while another dispatcher still holds
    // its lease. Keep recovery available until delivery is actually confirmed.
    if (start.Outcome == Resumed && await DbUtil.ExecuteScalarAsync(conn, null, """
      select exists(select 1 from publish_dispatch s join deck_publishes p using(job_id)
        where s.job_id=$1 and p.status='PENDING' and s.delivered_at is null)
      """, [start.JobId]) is true)
      start = UnconfirmedPublish(start);
    return StartResponse(start, res);
  }
}
