using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker.Services;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>Isolated PostgreSQL jobs and captured notify envelopes; no production job, model PASS or real email.</summary>
[Collection(PostgresCollection.Name)]
public class ContentPublishAlertsTests(PostgresFixture db) : IAsyncLifetime
{
  private readonly List<string> _jobs=[];
  private string? _savedSince, _savedMaintenance;
  private Func<SendMessageRequest,Task>? _savedEventSend;
  private readonly List<SendMessageRequest> _events=[];
  public Task InitializeAsync()
  {
    _savedEventSend=ContentPublishFailureEvents.TestSendSeam;
    ContentPublishFailureEvents.TestSendSeam=r=>{_events.Add(r);return Task.CompletedTask;};
    _savedSince=Environment.GetEnvironmentVariable(ContentPublishAlerts.SinceEnv);
    _savedMaintenance=Environment.GetEnvironmentVariable("BASELINE_MAINTENANCE_ENABLED");
    return Task.CompletedTask;
  }
  public async Task DisposeAsync()
  {
    try {foreach(var job in _jobs) await db.QueryAsync("delete from automation_notifications where dedupe_key like 'content-publish:'||$1||':%'",job);}
    finally
    {
      ContentPublishFailureEvents.TestSendSeam=_savedEventSend;
      Environment.SetEnvironmentVariable(ContentPublishAlerts.SinceEnv,_savedSince);
      Environment.SetEnvironmentVariable("BASELINE_MAINTENANCE_ENABLED",_savedMaintenance);
    }
  }
  private async Task Enable(A04Kit.Scope scope)
  {
    // The activation boundary and created_at must use the same database clock.
    var since=(DateTime)(await db.ScalarAsync("select clock_timestamp()"))!;
    scope.Set(ContentPublishAlerts.SinceEnv,since.ToString("O"));
  }
  private async Task<(long Deck, string Job)> Job(string stage, bool reviewed = true)
  {
    var id = Guid.NewGuid().ToString("N");
    var deck = Convert.ToInt64(await db.ScalarAsync("insert into decks(slug,title,author,deck_type) values($1,'alert fixture','synthetic',1) returning id", "it-alert-"+id));
    var receipt = "it-alert-receipt-"+id;
    if (reviewed) await db.QueryAsync("""
      insert into content_review_receipts(id,deck_id,release_id,action_id,payload_hash,editing_snapshot,publish_snapshot,policy,evidence,submitted_by,expires_at)
      values($1,$2,$3,'review','synthetic','synthetic','synthetic','aws-codex-bilingual-v1','{}','synthetic',now()+interval '1 hour')
      """, receipt, deck, "synthetic-release-"+id);
    var job = "it-alert-job-"+id;
    _jobs.Add(job);
    var state = stage == "build" ? "FAILED" : stage == "manifest" ? "SUCCESS" : "PENDING";
    await db.QueryAsync("""
      insert into deck_publishes(deck_id,deck_slug,build_id,s3_key,job_id,status,error_message,release_generation,release_receipt_id)
      values($1,$2,$3,'synthetic-key',$4,$5,'secret diagnostic must stay in the console',0,$6)
      """, deck, "it-alert-"+id, "synthetic-build-"+id, job, state, reviewed ? receipt : null);
    if (stage == "dispatch") await db.QueryAsync("insert into publish_dispatch(job_id,deck_id,attempts) values($1,$2,5)", job, deck);
    if (stage == "manifest")
    {
      await db.QueryAsync("update decks set live_build_id=$2 where id=$1", deck, "synthetic-build-"+id);
      await db.QueryAsync("insert into publish_manifest_delivery(job_id,state,attempts) values($1,'needs_attention',5)", job);
    }
    return (deck, job);
  }
  private async Task<JsonElement> Prepare(string job,string stage)
  {
    await using var conn=await db.OpenAsync();
    return JsonSerializer.SerializeToElement(await ContentPublishAlerts.PrepareAsync(conn,job,stage));
  }

  [Theory]
  [InlineData("build")]
  [InlineData("dispatch")]
  [InlineData("manifest")]
  public async Task Event_PreparesOnlyItsExactJob_OffModeWithOneLogicalIdentity(string stage)
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var (_,job)=await Job(stage);await Job(stage);
    var prepared=await Prepare(job,stage);var mail=prepared.GetProperty("notification");
    Assert.Equal(ContentPublishAlerts.Subkind,mail.GetProperty("subkind").GetString());
    Assert.Equal("off",mail.GetProperty("mode").GetString());
    var text=mail.GetProperty("text").GetString()!;
    Assert.Contains(job,text);Assert.Contains("Stage: "+stage,text);Assert.DoesNotContain("secret diagnostic",text);
    var repeated=await Prepare(job,stage);
    Assert.Equal(mail.GetProperty("notificationId").GetString(),repeated.GetProperty("notification").GetProperty("notificationId").GetString());
    Assert.Equal(1L,await db.ScalarAsync("select count(*) from automation_notifications where dedupe_key like 'content-publish:%' and dedupe_key=$1",$"content-publish:{job}:{stage}"));
    Assert.Empty(scope.NotifySent);Assert.Empty(scope.QaSent);Assert.Empty(scope.PublishSent);Assert.Empty(scope.WebhookSent);
  }

  [Fact]
  public async Task Tick_DoesNotSearchForOrSendPublicationAlerts()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);scope.Set("BASELINE_MAINTENANCE_ENABLED","0");
    var (_,job)=await Job("build");
    var req=A04Kit.SignedRequest(A04Kit.TickPath,new {v=1,tickId=Guid.NewGuid(),job="tick"});
    Assert.Equal(200,(await AutomationTick.HandleTick(req,new Res(req.TraceId))).StatusCode);
    Assert.Empty(_events);Assert.Empty(scope.NotifySent);
    Assert.Equal(0L,await db.ScalarAsync("select count(*) from automation_notifications where dedupe_key=$1",$"content-publish:{job}:build"));
  }

  [Fact]
  public async Task BuildFailure_AndFailedReplay_EmitImmediatelyWithoutRebuilding()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var (_,job)=await Job("build");
    var processor=new PublishJobProcessor(new JobRepository(),new S3DeckUploader());
    await processor.FailAsync(job,"synthetic error");await processor.ProcessAsync(job);
    Assert.Equal(2,_events.Count);
    Assert.All(_events,e=>{Assert.Equal(0,e.DelaySeconds);Assert.Contains(job,e.MessageBody);Assert.Contains("build",e.MessageBody);});
    Assert.Equal("FAILED",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
  }

  [Fact]
  public async Task FailedReplay_DoesNotAcknowledgeLostEvent()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("build");
    ContentPublishFailureEvents.TestSendSeam=_=>throw new TimeoutException("synthetic outage");
    var processor=new PublishJobProcessor(new JobRepository(),new S3DeckUploader());
    await Assert.ThrowsAsync<TimeoutException>(()=>processor.ProcessAsync(job));
  }

  [Theory]
  [InlineData("dispatch")]
  [InlineData("manifest")]
  public async Task FinalLease_RequestsQueueRetryInsteadOfDroppingEvent(string stage)
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job(stage);
    var table=stage=="dispatch"?"publish_dispatch":"publish_manifest_delivery";
    await db.QueryAsync($"update {table} set lease_until=now()+interval '1 minute' where job_id=$1",job);
    if(stage=="manifest")await db.QueryAsync("update publish_manifest_delivery set state='pending' where job_id=$1",job);
    await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(job,stage));
    await db.QueryAsync($"update {table} set lease_until=null where job_id=$1",job);
    Assert.True((await Prepare(job,stage)).TryGetProperty("notification",out _));
  }

  [Fact]
  public async Task FinalDispatch_IsArmedBeforeClaim_AndStillChecksAfterUncertainSend()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("dispatch");
    await db.QueryAsync("update publish_dispatch set attempts=4,actor_superadmin=true where job_id=$1",job);
    await using var conn=await db.OpenAsync();
    Assert.False(await PublishDelivery.Dispatch(conn,job,_=>{
      Assert.Equal(60,Assert.Single(_events).DelaySeconds);throw new TimeoutException("uncertain publish enqueue");
    }));
    Assert.Equal(5,await db.ScalarAsync("select attempts from publish_dispatch where job_id=$1",job));
    await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(job,"dispatch"));
    await db.QueryAsync("update publish_dispatch set lease_until=null where job_id=$1",job);
    Assert.True((await Prepare(job,"dispatch")).TryGetProperty("notification",out _));
  }

  [Theory]
  [InlineData("dispatch")]
  [InlineData("manifest")]
  public async Task CannotClaimFinalAttemptUntilWakeupIsDurable(string stage)
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job(stage);
    var table=stage=="dispatch"?"publish_dispatch":"publish_manifest_delivery";
    await db.QueryAsync($"update {table} set attempts=4 where job_id=$1",job);
    if(stage=="dispatch")await db.QueryAsync("update publish_dispatch set actor_superadmin=true where job_id=$1",job);
    else await db.QueryAsync("update publish_manifest_delivery set state='pending' where job_id=$1",job);
    ContentPublishFailureEvents.TestSendSeam=_=>throw new TimeoutException("queue down");
    await using var conn=await db.OpenAsync();var executed=false;
    await Assert.ThrowsAsync<TimeoutException>(async()=>{
      if(stage=="dispatch")await PublishDelivery.Dispatch(conn,job,_=>{executed=true;return Task.CompletedTask;});
      else await PublishDelivery.DeliverManifest(conn,job,()=>{executed=true;return Task.CompletedTask;});
    });
    Assert.False(executed);Assert.Equal(4,await db.ScalarAsync($"select attempts from {table} where job_id=$1",job));
  }

  [Fact]
  public async Task FinalManifest_PreArmsCrashGuard_AndEmitsImmediateKnownFailure()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("manifest");
    await db.QueryAsync("update publish_manifest_delivery set attempts=4,state='pending' where job_id=$1",job);
    await using var conn=await db.OpenAsync();
    await PublishDelivery.DeliverManifest(conn,job,()=>{
      Assert.Equal(90,Assert.Single(_events).DelaySeconds);throw new InvalidOperationException("synthetic index failure");
    });
    Assert.Equal(2,_events.Count);Assert.Equal(0,_events[1].DelaySeconds);
    Assert.True((await Prepare(job,"manifest")).TryGetProperty("notification",out _));
  }

  [Fact]
  public async Task DeliveredOldSupersededAndUnreviewedEventsAreIgnored()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var ordinary=await Job("build",false);Assert.True((await Prepare(ordinary.Job,"build")).GetProperty("skip").GetBoolean());
    var old=await Job("build");await db.QueryAsync("update deck_publishes set created_at=now()-interval '1 day' where job_id=$1",old.Job);
    Assert.True((await Prepare(old.Job,"build")).GetProperty("skip").GetBoolean());
    var superseded=await Job("build");await db.QueryAsync("update decks set release_generation=1 where id=$1",superseded.Deck);
    Assert.True((await Prepare(superseded.Job,"build")).GetProperty("skip").GetBoolean());
    var delivered=await Job("dispatch");await db.QueryAsync("update publish_dispatch set delivered_at=now() where job_id=$1",delivered.Job);
    Assert.True((await Prepare(delivered.Job,"dispatch")).GetProperty("skip").GetBoolean());
    var retrying=await Job("dispatch");await db.QueryAsync("update publish_dispatch set attempts=4 where job_id=$1",retrying.Job);
    await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(retrying.Job,"dispatch"));
  }

  [Fact]
  public async Task SentEventSkipsAndFailedEventGoesToNotifyDlq()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("build");await Prepare(job,"build");
    var key=$"content-publish:{job}:build";
    await db.QueryAsync("update automation_notifications set status='sent' where dedupe_key=$1",key);
    Assert.True((await Prepare(job,"build")).GetProperty("skip").GetBoolean());
    await db.QueryAsync("update automation_notifications set status='failed' where dedupe_key=$1",key);
    Assert.True((await Prepare(job,"build")).GetProperty("failed").GetBoolean());
  }
  [Fact]
  public async Task EarlyGuardEventIsRetriedBeforeFinalClaim()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("dispatch");
    await db.QueryAsync("update publish_dispatch set attempts=4,actor_superadmin=true where job_id=$1",job);
    ContentPublishFailureEvents.TestSendSeam=async _=>await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(job,"dispatch"));
    await using var conn=await db.OpenAsync();
    Assert.False(await PublishDelivery.Dispatch(conn,job,_=>throw new TimeoutException("synthetic uncertainty")));
    await db.QueryAsync("update publish_dispatch set lease_until=null where job_id=$1",job);
    Assert.True((await Prepare(job,"dispatch")).TryGetProperty("notification",out _));
  }

  [Fact]
  public async Task OrphanReapCannotCommitFailureWhenWakeupCannotBeQueued()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("dispatch");
    await db.QueryAsync("update deck_publishes set created_at=now()-interval '11 minutes' where job_id=$1",job);
    ContentPublishFailureEvents.TestSendSeam=_=>throw new TimeoutException("queue unavailable");
    await using var conn=await db.OpenAsync();
    await Assert.ThrowsAsync<TimeoutException>(()=>RecallSmith.Lambda.Vpc.Authoring.PublishReaper.ReapOrphansAsync(conn));
    Assert.Equal("PENDING",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
  }

  [Fact]
  public async Task PreparationRouteRequiresSignatureAndUsesExistingCallback()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("build");
    const string path="/api/internal/automation/notifications/report";
    var request=A04Kit.SignedRequest(path,new {v=1,operation="prepare-content-publish",jobId=job,stage="build"});
    var result=await Notifications.HandleReport(request,new Res(request.TraceId));
    Assert.Equal(200,result.StatusCode);Assert.Contains("notificationId",result.Body);
    var unsigned=new LambdaRequest(JsonSerializer.SerializeToElement(new {rawPath=path,requestContext=new {http=new {method="POST"}},body=JsonSerializer.Serialize(new {v=1,operation="prepare-content-publish",jobId=job,stage="build"})}));
    Assert.Equal(403,(await Notifications.HandleReport(unsigned,new Res(unsigned.TraceId))).StatusCode);
  }

}
