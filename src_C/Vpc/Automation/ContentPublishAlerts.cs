using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>Prepare an event's exact job for the existing notifier, independent of AI mode.</summary>
public static class ContentPublishAlerts
{
  public const string SinceEnv = ContentPublishFailureEvents.SinceEnv;
  public const string Subkind = ContentPublishFailureEvents.EventType;
  public static DateTimeOffset? Since => ContentPublishFailureEvents.Since;
  public static bool IsOperational(string kind, string? subkind) => kind == "exception" && subkind == Subkind;

  public static async Task<object> PrepareAsync(NpgsqlConnection conn, string jobId, string stage, CancellationToken ct = default)
  {
    if (Since is not { } since) return new { skip = true };
    // This is an event-scoped lookup, never a search for failed jobs.
    var rows = await DbUtil.QueryAsync(conn, null, """
      select p.job_id,p.deck_id,p.deck_slug,p.build_id,r.release_id,p.status,p.error_message,
        coalesce(s.attempts,0) as dispatch_attempts,s.delivered_at,
        s.lease_until > clock_timestamp() as dispatch_leased,
        coalesce(m.attempts,0) as manifest_attempts,m.state,
        m.lease_until > clock_timestamp() as manifest_leased,p.build_id=d.live_build_id as current_live
      from deck_publishes p join decks d on d.id=p.deck_id
      join content_review_receipts r on r.id=p.release_receipt_id and r.deck_id=p.deck_id
      left join publish_dispatch s using(job_id) left join publish_manifest_delivery m using(job_id)
      where p.job_id=$1 and p.created_at >= $2 and p.release_generation=d.release_generation and d.is_deleted=0
      """, [jobId, since.UtcDateTime], ct);
    if (rows.Count == 0) return new { skip = true };
    var row = rows[0];
    var dispatchAttempts = Convert.ToInt32(row["dispatch_attempts"]);
    var manifestAttempts = Convert.ToInt32(row["manifest_attempts"]);
    // A guard is queued before the last claim. A stalled producer may not have claimed it yet.
    if ((stage == "dispatch" && (string)row["status"]! == "PENDING" && dispatchAttempts == 4 && row["delivered_at"] is null) ||
        (stage == "manifest" && (string)row["status"]! == "SUCCESS" && row["current_live"] is true &&
          row["state"] as string == "pending" && manifestAttempts == 4))
      throw new InvalidOperationException("The guarded final attempt has not completed; retry this event.");
    var final = stage switch
    {
      "build" => (string)row["status"]! == "FAILED" && row["error_message"] as string is not ("RELEASE_SUPERSEDED" or "RELEASE_ROLLED_BACK"),
      "dispatch" => (string)row["status"]! == "PENDING" && dispatchAttempts >= 5 && row["delivered_at"] is null,
      "manifest" => (string)row["status"]! == "SUCCESS" && row["current_live"] is true &&
        (row["state"] as string == "needs_attention" || (row["state"] as string == "pending" && manifestAttempts >= 5)),
      _ => false
    };
    if (!final) return new { skip = true };
    if ((stage == "dispatch" && row["dispatch_leased"] is true) ||
        (stage == "manifest" && row["state"] as string != "needs_attention" && row["manifest_leased"] is true))
      throw new InvalidOperationException("The final delivery attempt is still leased; retry this event.");
    var mode = (await AutomationMode.EffectiveAsync(conn)).Effective;
    var url = Notifications.ConsoleBaseUrl().TrimEnd('/') + "/decks/cards?deckId=" + row["deck_id"];
    var attempts = stage == "build" ? "See job diagnostics" : (stage == "dispatch" ? dispatchAttempts : manifestAttempts).ToString();
    var email = EmailTemplates.ContentPublishFailure(mode, (string)row["deck_slug"]!, (string)row["release_id"]!,
      jobId, (string)row["build_id"]!, stage, attempts, url);
    var key = $"content-publish:{jobId}:{stage}";
    var notifications = await DbUtil.QueryAsync(conn, null, """
      insert into automation_notifications(notification_id,kind,subkind,dedupe_key,subject,body_text,mode,status)
      values($1,'exception',$2,$3,$4,$5,$6,'queued')
      on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key
      returning notification_id,status,subject,body_text,mode
      """, [Guid.NewGuid(), Subkind, key, email.Subject, email.BodyText, mode], ct);
    var n = notifications[0];
    if (n["status"] as string == "sent") return new { skip = true };
    if (n["status"] as string == "failed") return new { failed = true };
    var id = (Guid)n["notification_id"]!;
    Log.Event("info", new { tag = "content-publish-event", jobId, stage, notificationId = id, outcome = "prepared" });
    return new { notification = new { v = 1, notificationId = id, kind = "exception", subkind = Subkind,
      subject = (string)n["subject"]!, text = (string)n["body_text"]!, mode = (string)n["mode"]! } };
  }

  public static async Task<APIGatewayProxyResponse> HandlePrepare(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed();
    var auth = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.NotifierSecretEnv);
    if (!auth.Ok) return res.Forbidden("Internal authentication failed");
    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);
      if (!body.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt32(out var version) || version != 1)
        throw new ValidationError("v must be 1", "v");
      var job = AutomationBody.OptionalString(body, "jobId", 200);
      if (string.IsNullOrWhiteSpace(job)) throw new ValidationError("jobId is required", "jobId");
      var stage = AutomationBody.RequiredEnum(body, "stage", ["build", "dispatch", "manifest"]);
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing database configuration");
      return res.Ok(await PrepareAsync(conn, job, stage));
    }
    catch (Exception ex) { return RunnerRoutes.HandleError(ex, res); }
  }
}
