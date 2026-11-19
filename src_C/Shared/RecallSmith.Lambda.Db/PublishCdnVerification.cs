using Npgsql;

namespace RecallSmith.Lambda.Db;

public static class PublishCdnVerification
{
  public const string EventType = "content_cdn_verification";

  public static async Task<bool> ReadyAsync(NpgsqlConnection conn, NpgsqlTransaction? tx = null) =>
    await DbUtil.ExecuteScalarAsync(conn, tx, "select to_regclass('public.publish_cdn_verification') is not null", []) is true;

  public static async Task StageAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string jobId, string sha256, int cardCount)
  {
    if (!await ReadyAsync(conn, tx)) return;
    var affected = await DbUtil.ExecuteAsync(conn, tx, """
      insert into publish_cdn_verification(job_id,sha256,card_count) values($1,$2,$3)
      on conflict(job_id) do update set sha256=excluded.sha256
      where publish_cdn_verification.sha256=excluded.sha256 and publish_cdn_verification.card_count=excluded.card_count
      """, [jobId, sha256, cardCount]);
    if (affected != 1) throw new InvalidOperationException("Reviewed artifact changed during a retry.");
  }

  // Queue the wake-up before the SUCCESS transaction commits. A send failure rolls back
  // that transition so the publish worker's existing SQS retry can repeat it safely.
  public static async Task WakeAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string jobId)
  {
    if (await ReadyAsync(conn, tx) &&
        await DbUtil.ExecuteScalarAsync(conn, tx, "select exists(select 1 from publish_cdn_verification where job_id=$1)", [jobId]) is true)
      await ContentPublishFailureEvents.EnqueueEventAsync(jobId, EventType, "verification", 75);
  }

  public static async Task AnnotateAsync(NpgsqlConnection conn, List<Dictionary<string, object?>> jobs)
  {
    if (jobs.Count == 0 || !await ReadyAsync(conn)) return;
    var rows = await DbUtil.QueryAsync(conn, null, """
      select job_id,sha256,card_count,verified_at,failure_code
      from publish_cdn_verification where job_id=any($1::varchar[])
      """, [jobs.Select(row => (string)(row.GetValueOrDefault("jobId") ?? row["job_id"])!).ToArray()]);
    var byId = rows.ToDictionary(row => (string)row["job_id"]!);
    foreach (var job in jobs)
    {
      if (!byId.TryGetValue((string)(job.GetValueOrDefault("jobId") ?? job["job_id"])!, out var evidence)) continue;
      job["cdnVerificationState"] = evidence["verified_at"] is not null ? "verified" :
        evidence["failure_code"] is not null ? "needs_attention" : "pending";
      job["cdnVerifiedAt"] = evidence["verified_at"];
      job["cdnVerifiedCards"] = evidence["card_count"];
      job["cdnVerifiedSha256"] = evidence["sha256"];
      job["cdnVerificationError"] = evidence["failure_code"];
    }
  }
}
