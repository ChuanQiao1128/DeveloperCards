using System.Text.Json;
using Npgsql;

namespace RecallSmith.Lambda.Db;

/// <summary>Durable wake-ups, never deck payloads. Network calls run only after short claims commit.</summary>
public static class PublishDelivery
{
  public const int Batch = 5;
  public const int MaxAttempts = 5;
  public static async Task<bool> Ready(NpgsqlConnection conn) =>
    await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.publish_dispatch') is not null and to_regclass('public.publish_manifest_delivery') is not null", []) is true;

  public static async Task Annotate(NpgsqlConnection conn, List<Dictionary<string, object?>> rows)
  {
    var ready=await Ready(conn);
    var stages=ready && rows.Count>0 ? await DbUtil.QueryAsync(conn,null,"""
      select p.job_id,s.job_id is not null as durable,m.state,
        case when p.status<>'PENDING' then 'closed' when s.attempts>=5 then 'needs_attention'
          when s.delivered_at is not null then 'delivered' else 'pending' end as dispatch_state
      from deck_publishes p left join publish_dispatch s using(job_id) left join publish_manifest_delivery m using(job_id)
      where p.job_id=any($1::varchar[])
      """,[rows.Select(r=>(string)r["jobId"]!).ToArray()]) : [];
    var byId=stages.ToDictionary(r=>(string)r["job_id"]!);
    foreach(var row in rows)
    {
      byId.TryGetValue((string)row["jobId"]!,out var stage);
      row["recoveryDurable"]=stage?["durable"] is true;
      row["manifestState"]=stage?["state"];
      row["dispatchState"]=stage?["dispatch_state"];
    }
  }

  public static Task Stage(NpgsqlConnection conn, NpgsqlTransaction tx, string jobId, bool superadmin,
    string? actionId = null, string? requestHash = null) => DbUtil.ExecuteAsync(conn, tx, """
      insert into publish_dispatch(job_id,deck_id,actor_superadmin,action_id,request_hash)
      select job_id,deck_id,$2,$3,$4 from deck_publishes where job_id=$1
      """, [jobId, superadmin, actionId, requestHash]);

  public static Task<List<Dictionary<string, object?>>> Replay(NpgsqlConnection conn, NpgsqlTransaction? tx,
    long deckId, string actionId) => DbUtil.QueryAsync(conn, tx, """
      select s.request_hash,p.job_id,p.build_id,p.qa_snapshot_sha256,p.status
      from publish_dispatch s join deck_publishes p using(job_id) where s.deck_id=$1 and s.action_id=$2
      """, [deckId, actionId]);

  // Protected jobs must retain generation, receipt, editing snapshot and expected live pointer.
  private const string Authorized = """
    d.is_deleted=0 and (s.actor_superadmin or exists(select 1 from admin_deck_permissions a
      where a.deck_id=p.deck_id and a.admin_sub=p.published_by_admin_sub and a.can_write=1))
    and (p.publish_editing_snapshot is null or p.publish_editing_snapshot=content_editing_snapshot(d.id))
    and (d.slug<>'aws-saa-fundamentals' or exists(select 1 from content_review_receipts r
      where r.id=p.release_receipt_id and r.deck_id=d.id and p.release_generation=d.release_generation
      and r.expires_at>clock_timestamp() and not exists(select 1 from content_review_revocations x where x.receipt_id=r.id)
      and r.editing_snapshot=content_editing_snapshot(d.id) and p.release_editing_snapshot=r.editing_snapshot
      and p.qa_snapshot_sha256=r.publish_snapshot and p.release_expected_live is not distinct from d.live_build_id))
    """;

  /// <returns>null when no claim, true on confirmed send, false on uncertain response.</returns>
  public static async Task<bool?> Dispatch(NpgsqlConnection conn, string jobId, Func<string, Task> send)
  {
    var token = Guid.NewGuid().ToString();
    var rows = await DbUtil.QueryAsync(conn, null, $"""
      update publish_dispatch s set lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds',attempts=s.attempts+1
      from deck_publishes p join decks d on d.id=p.deck_id
      where s.job_id=$1 and p.job_id=s.job_id and p.status='PENDING' and s.attempts<5
        and s.next_attempt_at<=clock_timestamp() and (s.lease_until is null or s.lease_until<clock_timestamp())
        and {Authorized}
      returning p.job_id,p.deck_id,p.published_by_admin_sub,p.note
      """, [jobId, token]);
    if (rows.Count == 0) return null;
    var row = rows[0];
    try
    {
      await send(JsonSerializer.Serialize(new { jobId, deckId = Convert.ToInt64(row["deck_id"]), adminSub = row["published_by_admin_sub"], note = row["note"] }));
      await DbUtil.ExecuteAsync(conn, null, """
        update publish_dispatch set delivered_at=clock_timestamp(),last_error=null,lease_token=null,lease_until=null,
          next_attempt_at=clock_timestamp()+interval '5 minutes' where job_id=$1 and lease_token=$2
        """, [jobId, token]);
      return true;
    }
    catch (Exception ex)
    {
      // Keep the short lease after an uncertain response, including failure to record the ack.
      await DbUtil.ExecuteAsync(conn, null, "update publish_dispatch set last_error=$3 where job_id=$1 and lease_token=$2",
        [jobId, token, ex.Message[..Math.Min(ex.Message.Length, 400)]]);
      return false;
    }
  }

  public static async Task<int> RecoverDispatch(NpgsqlConnection conn, Func<string, Task> send, Func<bool> stop, int max = Batch)
  {
    if (stop()) return 0;
    var rows = await DbUtil.QueryAsync(conn, null, $"""
      select s.job_id from publish_dispatch s join deck_publishes p using(job_id) join decks d on d.id=p.deck_id
      where p.status='PENDING' and s.attempts<5 and s.next_attempt_at<=clock_timestamp()
        and (s.lease_until is null or s.lease_until<clock_timestamp()) and {Authorized}
      order by s.next_attempt_at,s.job_id limit $1
      """, [Math.Clamp(max, 0, Batch)]);
    var count = 0;
    foreach (var row in rows)
    {
      if (stop()) break;
      if (await Dispatch(conn, (string)row["job_id"]!, send) is not null) count++;
    }
    return count;
  }

  public static async Task StageManifest(NpgsqlConnection conn, NpgsqlTransaction tx, string jobId)
  {
    await DbUtil.ExecuteAsync(conn, tx, """
      insert into publish_manifest_delivery(job_id) select job_id from deck_publishes where job_id=$1 and status='SUCCESS'
      on conflict do nothing
      """, [jobId]);
  }

  public static async Task<bool> DeliverManifest(NpgsqlConnection conn, string jobId, Func<Task> rebuild)
  {
    var token = Guid.NewGuid().ToString();
    var rows = await DbUtil.QueryAsync(conn, null, """
      update publish_manifest_delivery m set lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds',attempts=m.attempts+1
      from deck_publishes p where p.job_id=m.job_id and m.job_id=$1 and p.status='SUCCESS' and m.state='pending'
        and m.attempts<5 and m.next_attempt_at<=clock_timestamp() and (m.lease_until is null or m.lease_until<clock_timestamp())
      returning m.job_id
      """, [jobId, token]);
    if (rows.Count == 0)
    {
      await DbUtil.ExecuteAsync(conn,null,"update publish_manifest_delivery set state='needs_attention' where job_id=$1 and state='pending' and attempts>=5 and (lease_until is null or lease_until<clock_timestamp())",[jobId]);
      return false;
    }
    try
    {
      // Rebuild reads current DB pointers; a replay never supplies its old build to the builder.
      await rebuild();
      await DbUtil.ExecuteAsync(conn, null, """
        update publish_manifest_delivery set state='delivered',delivered_at=clock_timestamp(),last_error=null,lease_token=null,lease_until=null
        where job_id=$1 and lease_token=$2
        """, [jobId, token]);
    }
    catch (Exception ex)
    {
      await DbUtil.ExecuteAsync(conn, null, """
        update publish_manifest_delivery set state=case when attempts>=5 then 'needs_attention' else 'pending' end,
          next_attempt_at=clock_timestamp()+interval '1 minute',lease_token=null,lease_until=null,last_error=$3
        where job_id=$1 and lease_token=$2
        """, [jobId, token, ex.Message[..Math.Min(ex.Message.Length, 400)]]);
    }
    return true;
  }

  public static async Task<int> RecoverManifest(NpgsqlConnection conn, Func<Task> rebuild, Func<bool> stop, int max = Batch)
  {
    if (stop()) return 0;
    await DbUtil.ExecuteAsync(conn,null,"""
      update publish_manifest_delivery set state='needs_attention' where job_id in(
        select job_id from publish_manifest_delivery where state='pending' and attempts>=5
        and (lease_until is null or lease_until<clock_timestamp()) limit $1)
      """,[Math.Clamp(max,0,Batch)]);
    var rows = await DbUtil.QueryAsync(conn, null, """
      select m.job_id from publish_manifest_delivery m join deck_publishes p using(job_id)
      where p.status='SUCCESS' and m.state='pending' and m.attempts<5 and m.next_attempt_at<=clock_timestamp()
        and (m.lease_until is null or m.lease_until<clock_timestamp()) order by m.next_attempt_at,m.job_id limit $1
      """, [Math.Clamp(max, 0, Batch)]);
    var count = 0;
    foreach (var row in rows)
    {
      if (stop()) break;
      if (await DeliverManifest(conn, (string)row["job_id"]!, rebuild)) count++;
    }
    return count;
  }
}
