using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>Receipt reconciliation for normal Console imports; never returns a different actor's receipt.</summary>
public static class CardsImportReceipt
{
  public static async Task<APIGatewayProxyResponse> Handle(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (auth.IsAgentClient || string.IsNullOrWhiteSpace(auth.UserSub)) return res.Forbidden("Requires normal authenticated Console session");
    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");
    if ((req.RawBody?.Length ?? 0) > 1_000_000) return res.PayloadTooLarge();
    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null || !doc.RootElement.TryGetProperty("deckId", out var id)) return res.BadRequest("VALIDATION_ERROR", "deckId is required");
      var deckId = Helpers.RequireInteger(id, "deckId");
      var operationId = ContentRelease.Required(doc.RootElement, "operationId");
      if (!Guid.TryParse(operationId, out var operation) || operation == Guid.Empty) return res.BadRequest("VALIDATION_ERROR", "operationId must be a nonempty UUID");
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG configuration");
      deny = await Helpers.RequireDeckWrite(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (deny is not null) return deny;
      await using var tx = await conn.BeginTransactionAsync(RequestBudget.Token);
      // Identical to the import lock: absence can only be authoritative AFTER any
      // in-flight importer commits/rolls back. A read without this lock is unsafe.
      var deck = await DbUtil.QueryAsync(conn, tx, "select id from decks where id=$1 and is_deleted=0 for no key update", [deckId]);
      if (deck.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");
      if (!auth.IsSuperAdmin)
      {
        var permission = await DbUtil.QueryAsync(conn, tx,
          "select deck_id from admin_deck_permissions where admin_sub=$1 and deck_id=$2 and can_write=1 for share", [auth.UserSub, deckId]);
        if (permission.Count == 0) return res.Forbidden("No permission for this deck (write)");
      }
      if (await ContentRelease.Applies(conn, deckId, tx)) return res.BadRequest("RELEASE_POLICY_SCOPE", "Use the controlled release action lookup for this deck");
      if (await DbUtil.ExecuteScalarAsync(conn, tx, "select to_regclass('public.content_release_actions') is not null", []) is not true)
        return Helpers.ErrorEnvelope(res, 503, "MIGRATION_REQUIRED", "Run migration 050 first");
      var replay = await ContentRelease.Replay(conn, tx, deckId, "console-import-v1:" + ContentRelease.Hash(auth.UserSub), operation.ToString("D"), ContentRelease.PayloadHash(doc.RootElement));
      if (replay is null) return res.Ok(new { found = false });
      using var result = JsonDocument.Parse(replay.Body);
      return res.Ok(new { found = true, result = result.RootElement.GetProperty("data").Clone() });
    }
    catch (ValidationError ex)
    {
      return Helpers.ErrorEnvelope(res, ex.Message.StartsWith("IDEMPOTENCY_CONFLICT") ? 409 : 400,
        ex.Message.StartsWith("IDEMPOTENCY_CONFLICT") ? "IDEMPOTENCY_CONFLICT" : "VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex) { return Helpers.HandlePgError(ex, res) ?? res.Error500(ex); }
  }
}
