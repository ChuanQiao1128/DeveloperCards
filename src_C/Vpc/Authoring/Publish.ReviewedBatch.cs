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

  private static async Task<APIGatewayProxyResponse> PublishReviewedBatch(
    NpgsqlConnection conn, long deckId, JsonElement body, AuthContext auth, Res res)
  {
    if (!CanPublishReviewedBatch(auth)) return res.Forbidden();
    if (!Guid.TryParseExact(ContentRelease.Required(body, "reviewedImportOperationId"), "D", out var operation))
      throw new ValidationError("Invalid reviewed import operation.", "reviewedImportOperationId");
    var actorHash = ContentRelease.Hash(auth.UserSub!);
    var result = await DbUtil.ExecuteScalarAsync(conn, null, """
      select result from content_release_actions where deck_id=$1 and release_id=$2 and action_id=$3 and kind='cards/import'
      """, [deckId, "console-import-v1:" + actorHash, operation.ToString("D")]) as string;
    if (result is null) return res.BadRequest("REVIEWED_IMPORT_REQUIRED", "Import receipt is missing.");
    var receipt = JsonSerializer.Deserialize<APIGatewayProxyResponse>(result)!;
    using var doc = JsonDocument.Parse(receipt.Body);
    var data = doc.RootElement.GetProperty("data");
    if (!data.TryGetProperty("reviewedPublish", out var ready) || ready.ValueKind != JsonValueKind.Object)
      return res.BadRequest("REVIEWED_IMPORT_REQUIRED", "Import was not confirmed for publishing.");
    var baseline = new ReviewedBaseline(ready.GetProperty("editingSnapshot").GetString()!,
      ready.GetProperty("liveBuildId").GetString());
    var action = PublishCdnVerification.ReviewedBatchActionPrefix + actorHash[..24] + ":" + operation.ToString("D");
    var start = await StartPublishAsync(conn, deckId, auth.UserSub!, null, bindSnapshot: true, expectedSnapshot: null,
      allowResume: false, actionId: action, requestHash: ContentRelease.PayloadHash(body), actorSuperadmin: true,
      reviewedBatch: baseline);
    return StartResponse(start, res);
  }
}
