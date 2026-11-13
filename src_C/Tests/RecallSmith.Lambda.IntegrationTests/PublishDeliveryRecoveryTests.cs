using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class PublishDeliveryRecoveryTests(PostgresFixture db)
{
  private async Task<long> Deck()
  {
    var id = Convert.ToInt64(await db.ScalarAsync("insert into decks(slug,title,author,deck_type) values($1,'delivery','tests',1) returning id", $"it-delivery-{Guid.NewGuid():N}"));
    await db.QueryAsync("insert into cards(deck_id,stable_uid,question,explanation,order_in_deck) values($1,$2,'question','answer',1)", id, $"it-{Guid.NewGuid():N}");
    return id;
  }

  private static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> Submit(long deckId, string actionId, string note = "original")
  {
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/authoring/publish",
      requestContext = new { http = new { method = "POST" }, authorizer = new { jwt = new { claims = new Dictionary<string, object> { ["sub"] = "delivery-owner", ["cognito:groups"] = new[] { "super_admin" } } } } },
      body = JsonSerializer.Serialize(new { deckId, actionId, note })
    }));
    return await Publish.HandleAuthoringPublish(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
  }

  private static string Job(Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body).RootElement.GetProperty("data").GetProperty("jobId").GetString()!;

  [Fact]
  public async Task Publish_CrashAfterCommit_HasDurableIntentAndSnapshot()
  {
    var deck = await Deck();
    Publish.TestEnqueueSeam = new("queue", "bucket", _ => throw new TimeoutException("accepted or crashed"));
    try
    {
      var response = await Submit(deck, "crash");
      Assert.Equal(503, response.StatusCode);
      var job = Job(response);
      var row = Assert.Single(await db.QueryAsync("select p.status,p.publish_editing_snapshot,s.job_id from deck_publishes p join publish_dispatch s using(job_id) where p.job_id=$1", job));
      Assert.Equal("PENDING", row["status"]);
      Assert.NotNull(row["publish_editing_snapshot"]);
    }
    finally { Publish.TestEnqueueSeam = null; }
  }

  private async Task<string> Queued(long deck, string action)
  {
    Publish.TestEnqueueSeam = new("queue","bucket",_=>Task.CompletedTask);
    try { var response=await Submit(deck,action); Assert.True(response.StatusCode==200,response.Body); return Job(response); }
    finally { Publish.TestEnqueueSeam=null; }
  }

  [Fact]
  public async Task DispatchInsertFailure_RollsBackJobAndIdentity()
  {
    var deck=await Deck();var action="atomic-"+Guid.NewGuid().ToString("N");
    var constraint="it_atomic_"+Guid.NewGuid().ToString("N");
    await db.QueryAsync($"alter table publish_dispatch add constraint {constraint} check(action_id<>'{action}')");
    Publish.TestEnqueueSeam=new("queue","bucket",_=>throw new Exception("must not send"));
    try
    {
      Assert.Equal(500,(await Submit(deck,action)).StatusCode);
      Assert.Equal(0L,await db.ScalarAsync("select count(*) from deck_publishes where deck_id=$1",deck));
      Assert.Equal(0L,await db.ScalarAsync("select count(*) from publish_dispatch where deck_id=$1",deck));
    }
    finally { Publish.TestEnqueueSeam=null;await db.QueryAsync($"alter table publish_dispatch drop constraint {constraint}"); }
  }

  [Fact]
  public async Task Action_ReplaysTerminalJob_AndRejectsDifferentPayload()
  {
    var deck=await Deck();var job=await Queued(deck,"replay");
    await db.QueryAsync("update deck_publishes set status='FAILED' where job_id=$1",job);
    await db.QueryAsync("update cards set question='later edit' where deck_id=$1",deck);
    var sends=0;Publish.TestEnqueueSeam=new("queue","bucket",_=>{sends++;return Task.CompletedTask;});
    try
    {
      var replay=await Submit(deck,"replay");Assert.Equal(200,replay.StatusCode);Assert.Equal(job,Job(replay));
      var conflict=await Submit(deck,"replay","different payload");Assert.Equal(409,conflict.StatusCode);Assert.Contains("IDEMPOTENCY_CONFLICT",conflict.Body);
      Assert.Equal(0,sends);
      Assert.Equal(1L,await db.ScalarAsync("select count(*) from deck_publishes where deck_id=$1",deck));
      Assert.Equal("FAILED",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
    }
    finally { Publish.TestEnqueueSeam=null; }
  }

  [Fact]
  public async Task TwoConnections_ClaimOneLease_NoTransactionDuringSend_OriginalMetadata()
  {
    var deck=await Deck();var job=await Queued(deck,"lease");
    await db.QueryAsync("update publish_dispatch set next_attempt_at=now()-interval '1 second' where job_id=$1",job);
    await using var first=await db.OpenAsync();await using var second=await db.OpenAsync();
    var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var sends=0;
    var attempt=PublishDelivery.Dispatch(first,job,async body=>{
      sends++;using var doc=JsonDocument.Parse(body);Assert.Equal("delivery-owner",doc.RootElement.GetProperty("adminSub").GetString());
      Assert.Equal("original",doc.RootElement.GetProperty("note").GetString());
      Assert.Equal("idle",await DbUtil.ExecuteScalarAsync(second,null,"select state from pg_stat_activity where pid=$1",[first.ProcessID]));
      entered.SetResult();await release.Task;
    });
    await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert.Null(await PublishDelivery.Dispatch(second,job,_=>throw new Exception("lease must suppress another scanner")));
    release.SetResult();Assert.True(await attempt);Assert.Equal(1,sends);
    Assert.Equal(2,await db.ScalarAsync("select attempts from publish_dispatch where job_id=$1",job));
  }

  [Theory]
  [InlineData("card")]
  [InlineData("settings")]
  public async Task LateEdit_RefusesFinalCommit_WhenAiIsOff(string edit)
  {
    var deck=await Deck();var job=await Queued(deck,"stale");var repo=new JobRepository();
    Assert.True(await repo.TryAcquireJobAsync(job));
    await db.QueryAsync(edit=="card"?"update cards set explanation='late edit' where deck_id=$1":"update decks set title='late settings' where id=$1",deck);
    var error=await Assert.ThrowsAsync<PostgresException>(()=>repo.CompleteJobAsync(job,1));Assert.Contains("PUBLISH_SNAPSHOT_STALE",error.MessageText);
    Assert.Equal("PROCESSING",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
    Assert.Null(await db.ScalarAsync("select live_build_id from decks where id=$1",deck));
    Assert.Equal(0L,await db.ScalarAsync("select count(*) from publish_manifest_delivery where job_id=$1",job));
  }

  [Fact]
  public async Task SuccessAndManifestIntent_AreAtomic()
  {
    var deck=await Deck();var job=await Queued(deck,"manifest-atomic");var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(job));
    var constraint="it_manifest_"+Guid.NewGuid().ToString("N");
    await db.QueryAsync($"alter table publish_manifest_delivery add constraint {constraint} check(job_id<>'{job}')");
    try
    {
      await Assert.ThrowsAsync<PostgresException>(()=>repo.CompleteJobAsync(job,1));
      Assert.Equal("PROCESSING",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
      Assert.Null(await db.ScalarAsync("select live_build_id from decks where id=$1",deck));
    }
    finally { await db.QueryAsync($"alter table publish_manifest_delivery drop constraint {constraint}"); }
    await repo.CompleteJobAsync(job,1);
    Assert.Equal("pending",await db.ScalarAsync("select state from publish_manifest_delivery where job_id=$1",job));
    await repo.FailJobAsync(job,"late worker error");Assert.Equal("SUCCESS",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
  }

  [Fact]
  public async Task ManifestFailure_PreservesSuccess_AndOldReplayBuildsCurrentPointerOnly()
  {
    var deck=await Deck();var old=await Queued(deck,"manifest-old");var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(old));await repo.CompleteJobAsync(old,1);
    await using var conn=await db.OpenAsync();
    Assert.True(await PublishDelivery.DeliverManifest(conn,old,()=>throw new IOException("S3 unavailable")));
    Assert.Equal("SUCCESS",await db.ScalarAsync("select status from deck_publishes where job_id=$1",old));
    Assert.Equal("pending",await db.ScalarAsync("select state from publish_manifest_delivery where job_id=$1",old));
    var current=await Queued(deck,"manifest-current");Assert.True(await repo.TryAcquireJobAsync(current));await repo.CompleteJobAsync(current,1);
    var build=(string)(await db.ScalarAsync("select build_id from deck_publishes where job_id=$1",current))!;
    await db.QueryAsync("update publish_manifest_delivery set next_attempt_at=now()-interval '1 second' where job_id=$1",old);
    Assert.True(await PublishDelivery.DeliverManifest(conn,old,async()=>{
      using var manifest=JsonDocument.Parse((await ManifestBuilder.BuildAsync(conn,"content",123)).Json);
      var slug=(string)(await db.ScalarAsync("select slug from decks where id=$1",deck))!;
      Assert.Equal(build,manifest.RootElement.GetProperty("decks").EnumerateArray().Single(d=>d.GetProperty("slug").GetString()==slug).GetProperty("buildId").GetString());
    }));
    Assert.False(await PublishDelivery.DeliverManifest(conn,old,()=>throw new Exception("delivered replay must not rebuild")));
    Assert.Equal(build,await db.ScalarAsync("select live_build_id from decks where id=$1",deck));
  }

  [Fact]
  public async Task Manifest_CrashedFinalLease_BecomesNeedsAttention_WithoutChangingSuccess()
  {
    var deck=await Deck();var job=await Queued(deck,"exhausted");var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(job));await repo.CompleteJobAsync(job,1);
    await db.QueryAsync("update publish_manifest_delivery set attempts=5,lease_until=now()-interval '1 second' where job_id=$1",job);
    await using var conn=await db.OpenAsync();
    Assert.False(await PublishDelivery.DeliverManifest(conn,job,()=>throw new Exception("must not send")));
    Assert.Equal("needs_attention",await db.ScalarAsync("select state from publish_manifest_delivery where job_id=$1",job));
    Assert.Equal("SUCCESS",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
  }

  [Theory]
  [InlineData("SUCCESS")]
  [InlineData("FAILED")]
  [InlineData("PROCESSING")]
  [InlineData("revoked-permission")]
  [InlineData("changed-snapshot")]
  public async Task Dispatch_SkipsTerminalOrUnauthorizedJobs(string reason)
  {
    var deck=await Deck();var job=await Queued(deck,"skip");
    await db.QueryAsync("update publish_dispatch set next_attempt_at=now()-interval '1 second' where job_id=$1",job);
    if(reason=="revoked-permission") await db.QueryAsync("update publish_dispatch set actor_superadmin=false where job_id=$1",job);
    else if(reason=="changed-snapshot") await db.QueryAsync("update cards set question='changed' where deck_id=$1",deck);
    else await db.QueryAsync("update deck_publishes set status=$2 where job_id=$1",job,reason);
    await using var conn=await db.OpenAsync();
    Assert.Null(await PublishDelivery.Dispatch(conn,job,_=>throw new Exception("ineligible job must not send")));
  }

  [Fact]
  public async Task Missing053_LegacyDispatchIsExplicitlyNotDurable()
  {
    var saved=Environment.GetEnvironmentVariable("PGDATABASE");
    var cs=await db.CreateScratchDatabaseAsync("it_delivery_old_"+Guid.NewGuid().ToString("N"));
    await using var conn=new NpgsqlConnection(cs);await conn.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(conn,52);
    Environment.SetEnvironmentVariable("PGDATABASE",new NpgsqlConnectionStringBuilder(cs).Database);Pg.Reset();
    Publish.TestEnqueueSeam=new("queue","bucket",_=>Task.CompletedTask);
    try
    {
      var deck=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn,null,"insert into decks(slug,title,author,deck_type) values('legacy','legacy','tests',1) returning id",[]));
      await DbUtil.ExecuteAsync(conn,null,"insert into cards(deck_id,stable_uid,question,order_in_deck) values($1,'legacy-uid','q',1)",[deck]);
      var response=await Submit(deck,"key");Assert.Equal(503,response.StatusCode);Assert.Contains("PUBLISH_RECOVERY_NOT_READY",response.Body);
      var start=await Publish.StartPublishAsync(conn,deck,"owner",null,false,null,true);Assert.Equal(Publish.Queued,start.Outcome);
      Assert.False(await PublishDelivery.Ready(conn));
    }
    finally { Publish.TestEnqueueSeam=null;Environment.SetEnvironmentVariable("PGDATABASE",saved);Pg.Reset(); }
  }

  [Fact]
  public async Task AiOff_ManualSuperAdminMaintenance_RespectsBudgetAndNeverRunsModels()
  {
    await using var scope=new A04Kit.Scope(RecallSmith.Lambda.Vpc.Automation.AutomationMode.Off);
    var saved=Environment.GetEnvironmentVariable("PGDATABASE");
    var cs=await db.CreateScratchDatabaseAsync("it_delivery_maint_"+Guid.NewGuid().ToString("N"));
    await using var conn=new NpgsqlConnection(cs);await conn.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(conn,int.MaxValue);
    Environment.SetEnvironmentVariable("PGDATABASE",new NpgsqlConnectionStringBuilder(cs).Database);Pg.Reset();
    try
    {
      await DbUtil.ExecuteAsync(conn,null,"insert into anon_funnel_events(event,cohort_day,event_day,platform,app_version,received_at) values('first_open',current_date,current_date,'ios','test',now()-interval '401 days')",[]);
      await DbUtil.ExecuteAsync(conn,null,"insert into revenuecat_deletions(sub,requested_at) values('maintenance-retained',now()-interval '31 days')",[]);
      var pending=Guid.NewGuid().ToString();
      var deck=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn,null,"insert into decks(slug,title,author,deck_type) values('manual-pending','pending','tests',1) returning id",[]));
      await DbUtil.ExecuteAsync(conn,null,"insert into deck_publishes(deck_id,deck_slug,job_id,build_id,s3_key,status,published_by_admin_sub,note) values($1,'manual-pending',$2,'manual-build','content/manual','PENDING','original-owner','original-note')",[deck,pending]);
      await using(var tx=await conn.BeginTransactionAsync()){await PublishDelivery.Stage(conn,tx,pending,true);await tx.CommitAsync();}
      var forged=A04Kit.SignedRequest(A04Kit.TickPath,new{v=1,tickId=Guid.NewGuid(),job="tick",manual=true});
      Assert.Equal("off",AutomationTestKit.Data(await RecallSmith.Lambda.Vpc.Automation.AutomationTick.HandleTick(forged,new Res("test"))).GetProperty("skipped").GetString());
      var off=AutomationTestKit.Data(await A04Kit.TickAsync());Assert.Equal("off",off.GetProperty("skipped").GetString());
      Assert.Equal(1L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from anon_funnel_events",[]));
      var stopped=await RecallSmith.Lambda.Vpc.Automation.BaselineMaintenance.Run(conn,TimeSpan.Zero,true);
      Assert.Contains("budget_exhausted",stopped.FailedSteps);Assert.Empty(stopped.Steps);
      var req=new LambdaRequest(JsonSerializer.SerializeToElement(new{rawPath="/api/v1/admin/maintenance/run",requestContext=new{http=new{method="POST"}}}));
      var admin=new AuthContext(new Dictionary<string,JsonElement>(),"owner","owner",["super_admin"],true,false,true);
      var editor=admin with {IsSuperAdmin=false};
      Assert.Equal(403,(await RecallSmith.Lambda.Vpc.Automation.BaselineMaintenance.Handle(req,new Res("test"),editor)).StatusCode);
      Assert.Equal(200,(await RecallSmith.Lambda.Vpc.Automation.BaselineMaintenance.Handle(req,new Res("test"),admin)).StatusCode);
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from anon_funnel_events",[]));
      Assert.Equal("needs_attention",await DbUtil.ExecuteScalarAsync(conn,null,"select state from revenuecat_deletions where sub='maintenance-retained'",[]));
      Assert.Empty(scope.QaSent);Assert.Single(scope.PublishSent);
      using(var message=JsonDocument.Parse(scope.PublishSent[0].MessageBody)) Assert.Equal(pending,message.RootElement.GetProperty("jobId").GetString());
      Assert.Equal("PENDING",await DbUtil.ExecuteScalarAsync(conn,null,"select status from deck_publishes where job_id=$1",[pending]));
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from ai_qa_runs",[]));
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from automation_publishes",[]));
      await DbUtil.ExecuteAsync(conn,null,"insert into revenuecat_deletions(sub,requested_at) select 'bounded-'||g,now()-interval '31 days' from generate_series(1,52) g",[]);
      Assert.Equal(50,await RecallSmith.Lambda.Vpc.Runtime.RevenueCatDeletions.DeleteExpiredAsync(conn));
      Assert.Equal(2L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from revenuecat_deletions where state='pending'",[]));
      Assert.Equal(2,await RecallSmith.Lambda.Vpc.Runtime.RevenueCatDeletions.DeleteExpiredAsync(conn));
      Assert.Equal(0,await RecallSmith.Lambda.Vpc.Runtime.RevenueCatDeletions.DeleteExpiredAsync(conn));
      Assert.Equal(53L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from revenuecat_deletions where state='needs_attention'",[]));
      Assert.False(RecallSmith.Lambda.Vpc.Automation.BaselineMaintenance.Enabled);
      Assert.False(RecallSmith.Lambda.Vpc.Automation.BaselineMaintenance.RecoveryEnabled);
    }
    finally {Environment.SetEnvironmentVariable("PGDATABASE",saved);Pg.Reset();}
  }

  [Fact]
  public async Task RecoveryScanner_IsBounded_AndTwoScannersDoNotMultiplySends()
  {
    var cs=await db.CreateScratchDatabaseAsync("it_delivery_scan_"+Guid.NewGuid().ToString("N"));
    await using var first=new NpgsqlConnection(cs);await first.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(first,int.MaxValue);
    var deck=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(first,null,"insert into decks(slug,title,author) values('scan','scan','tests') returning id",[]));
    // Multiple historical intents use distinct decks, preserving the production active-job unique constraint.
    for(var i=0;i<6;i++)
    {
      var did=i==0?deck:Convert.ToInt64(await DbUtil.ExecuteScalarAsync(first,null,"insert into decks(slug,title,author) values($1,'scan','tests') returning id",["scan-"+i]));
      var jid=Guid.NewGuid().ToString();
      await DbUtil.ExecuteAsync(first,null,"insert into deck_publishes(deck_id,deck_slug,job_id,build_id,s3_key,status,published_by_admin_sub) values($1,$2,$3,$3,$3,'PENDING','owner')",[did,"scan-"+i,jid]);
      await using var tx=await first.BeginTransactionAsync();await PublishDelivery.Stage(first,tx,jid,true);await tx.CommitAsync();
    }
    await using var second=new NpgsqlConnection(cs);await second.OpenAsync();
    var sent=new System.Collections.Concurrent.ConcurrentDictionary<string,int>();
    async Task Send(string body){var id=JsonDocument.Parse(body).RootElement.GetProperty("jobId").GetString()!;sent.AddOrUpdate(id,1,(_,n)=>n+1);await Task.Yield();}
    var counts=await Task.WhenAll(PublishDelivery.RecoverDispatch(first,Send,()=>false),PublishDelivery.RecoverDispatch(second,Send,()=>false));
    Assert.All(counts,n=>Assert.InRange(n,0,5));Assert.All(sent.Values,n=>Assert.Equal(1,n));
    Assert.InRange(sent.Count,5,6);
    var before=sent.Count;Assert.Equal(0,await PublishDelivery.RecoverDispatch(first,Send,()=>true));Assert.Equal(before,sent.Count);
  }

  [Fact]
  public async Task AiOff_RefusesMalformedTeachingBeforeCreatingJob()
  {
    var deck=await Deck();await db.QueryAsync("update cards set teaching='[]'::jsonb where deck_id=$1",deck);
    Publish.TestEnqueueSeam=new("queue","bucket",_=>throw new Exception("invalid content must not send"));
    try {Assert.Equal(400,(await Submit(deck,"invalid-shape")).StatusCode);Assert.Equal(0L,await db.ScalarAsync("select count(*) from deck_publishes where deck_id=$1",deck));}
    finally{Publish.TestEnqueueSeam=null;}
  }
}
