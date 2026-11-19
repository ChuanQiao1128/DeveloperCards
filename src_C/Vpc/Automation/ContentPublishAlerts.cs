using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>Operational mail for explicitly reviewed content releases, independent of AI authoring mode.</summary>
public static class ContentPublishAlerts
{
  public const string SinceEnv = "CONTENT_PUBLISH_ALERTS_SINCE";
  public const string Subkind = "content_publish_failure";
  public const int Batch = 5;
  public const long LockKey = 0x434F4E54414C5254; // CONTALRT: covers insertion and retry of existing notifications.

  public static DateTimeOffset? Since => DateTimeOffset.TryParse(
    Environment.GetEnvironmentVariable(SinceEnv), CultureInfo.InvariantCulture,
    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var since) ? since : null;
  public static bool IsOperational(string kind, string? subkind) => kind == "exception" && subkind == Subkind;

  /// <summary>Bounded scan of new, current-generation failures. No job, card, review or automation state is changed.</summary>
  public static async Task<int> SweepAsync(NpgsqlConnection conn, string mode, CancellationToken ct = default)
  {
    if (Since is not { } since) return 0; // Missing/invalid activation time is disabled; never mail historical failures.
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct, RequestBudget.Token);
    deadline.CancelAfter(TimeSpan.FromSeconds(5));
    ct = deadline.Token;
    var locked = false;
    try
    {
      locked = await DbUtil.ExecuteScalarAsync(conn, null, "select pg_try_advisory_lock($1)", [LockKey], ct) is true;
      if (!locked) return 0;
      if (await DbUtil.ExecuteScalarAsync(conn, null,
          "select to_regclass('public.publish_dispatch') is not null and to_regclass('public.publish_manifest_delivery') is not null", [], ct) is not true) return 0;
      var resent = await Notifications.ResendAsync(conn, Batch, ct, Subkind);
      var rows = await DbUtil.QueryAsync(conn, null, """
        with problems as (
          select p.job_id,p.deck_id,p.deck_slug,p.build_id,r.release_id,
            case
              when p.status='FAILED' and coalesce(p.error_message,'') not in ('RELEASE_SUPERSEDED','RELEASE_ROLLED_BACK') then 'build'
              when p.status='PENDING' and s.attempts>=5 and s.delivered_at is null
                and (s.lease_until is null or s.lease_until<clock_timestamp()) then 'dispatch'
              when p.status='SUCCESS' and p.build_id=d.live_build_id
                and (m.state='needs_attention' or (m.state='pending' and m.attempts>=5
                  and (m.lease_until is null or m.lease_until<clock_timestamp()))) then 'manifest'
            end as stage,
            coalesce(s.attempts,0) as dispatch_attempts,coalesce(m.attempts,0) as manifest_attempts,p.created_at
          from deck_publishes p join decks d on d.id=p.deck_id
          join content_review_receipts r on r.id=p.release_receipt_id and r.deck_id=p.deck_id
          left join publish_dispatch s using(job_id) left join publish_manifest_delivery m using(job_id)
          where p.created_at >= $1 and p.release_generation=d.release_generation and d.is_deleted=0
        )
        select * from problems p where p.stage is not null and not exists (
          select 1 from automation_notifications n where n.dedupe_key='content-publish:'||p.job_id||':'||p.stage)
        order by p.created_at,p.job_id limit $2
        """, [since.UtcDateTime, Batch], ct);
      var queued = 0;
      foreach (var row in rows)
      {
        ct.ThrowIfCancellationRequested();
        var job = (string)row["job_id"]!;
        var stage = (string)row["stage"]!;
        var deck = Convert.ToInt64(row["deck_id"]);
        var url = Notifications.ConsoleBaseUrl().TrimEnd('/') + "/decks/cards?deckId=" + deck.ToString(CultureInfo.InvariantCulture);
        var attempts = stage == "build" ? "See job diagnostics" :
          Convert.ToString(row[stage == "dispatch" ? "dispatch_attempts" : "manifest_attempts"], CultureInfo.InvariantCulture)!;
        var email = EmailTemplates.ContentPublishFailure(mode, (string)row["deck_slug"]!, (string)row["release_id"]!,
          job, (string)row["build_id"]!, stage, attempts, url);
        var result = await Notifications.EnqueueAsync(conn,
          new NotificationRequest("exception", Subkind, $"content-publish:{job}:{stage}", mode, email,
            Refs: new Dictionary<string, object?> { ["jobId"] = job, ["deckId"] = deck }, ConsoleUrl: url), ct);
        if (result is null) throw new InvalidOperationException("Content publish alert could not be durably recorded.");
        if (result.Created && result.Status == "queued") queued++;
      }
      Log.Event("info", new { tag="content-publish-alerts", since=since.ToString("O"), scanned=rows.Count, queued, resent, mode });
      return queued + resent;
    }
    catch (Exception ex)
    {
      // Notification failure must not change the release; the next scheduled tick retries unsent records.
      Log.Event("warn", new { tag="content-publish-alerts", reason="scan_failed", errorType=ex.GetType().Name });
      AutomationFailures.Record();
      return 0;
    }
    finally
    {
      if (locked)
      {
        // Release the session lock even after the scan/request deadline was cancelled.
        try
        {
          await using var unlock = new NpgsqlCommand("select pg_advisory_unlock(@key)", conn) { CommandTimeout = 1 };
          unlock.Parameters.AddWithValue("key", LockKey);
          await unlock.ExecuteScalarAsync(CancellationToken.None);
        }
        catch
        {
          await conn.CloseAsync();
          Log.Event("warn", new { tag="content-publish-alerts", reason="lock_release_connection_closed" });
        }
      }
    }
  }
}
