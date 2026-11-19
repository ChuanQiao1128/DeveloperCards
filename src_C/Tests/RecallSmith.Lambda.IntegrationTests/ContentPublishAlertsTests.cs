using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>Isolated PostgreSQL jobs and captured notify envelopes; no production job, model PASS or real email.</summary>
[Collection(PostgresCollection.Name)]
public class ContentPublishAlertsTests(PostgresFixture db) : IAsyncLifetime
{
  private readonly List<string> _jobs=[];
  private string? _savedSince, _savedMaintenance;
  public Task InitializeAsync()
  {
    _savedSince=Environment.GetEnvironmentVariable(ContentPublishAlerts.SinceEnv);
    _savedMaintenance=Environment.GetEnvironmentVariable("BASELINE_MAINTENANCE_ENABLED");
    return Task.CompletedTask;
  }
  public async Task DisposeAsync()
  {
    try {foreach(var job in _jobs) await db.QueryAsync("delete from automation_notifications where dedupe_key like 'content-publish:'||$1||':%'",job);}
    finally
    {
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
  private async Task<int> Sweep() { await using var conn = await db.OpenAsync(); return await ContentPublishAlerts.SweepAsync(conn, "off"); }

  [Theory]
  [InlineData("build")]
  [InlineData("dispatch")]
  [InlineData("manifest")]
  public async Task FinalProblem_OffMode_QueuesOneBoundAlertWithoutAIOrWebhook(string stage)
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Off); await Enable(scope);
    var (deck,job) = await Job(stage);
    Assert.Equal(1,await Sweep()); Assert.Equal(0,await Sweep());
    var message=JsonDocument.Parse(Assert.Single(scope.NotifySent).MessageBody).RootElement;
    Assert.Equal("exception",message.GetProperty("kind").GetString());
    Assert.Equal(ContentPublishAlerts.Subkind,message.GetProperty("subkind").GetString());
    Assert.Equal("off",message.GetProperty("mode").GetString());
    var body=message.GetProperty("text").GetString()!;
    Assert.Contains(job,body); Assert.Contains("Stage: "+stage,body); Assert.Contains("synthetic-release-",body);
    Assert.DoesNotContain("secret diagnostic",body); Assert.Empty(scope.WebhookSent); Assert.Empty(scope.QaSent); Assert.Empty(scope.PublishSent);
    Assert.Equal("off",Environment.GetEnvironmentVariable(AutomationMode.EnvName));
    Assert.Equal(1L,await db.ScalarAsync("select count(*) from automation_notifications where dedupe_key=$1",$"content-publish:{job}:{stage}"));
    Assert.Equal(0L,await db.ScalarAsync("select count(*) from cards where deck_id=$1",deck));
  }

  [Fact]
  public async Task Tick_OffWithoutMaintenance_StillNotifiesOnlyControlledReleaseFailures()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);scope.Set("BASELINE_MAINTENANCE_ENABLED","0");
    var (_,job)=await Job("build");
    var request=A04Kit.SignedRequest(A04Kit.TickPath,new {v=1,tickId=Guid.NewGuid(),job="tick"});
    var response=await AutomationTick.HandleTick(request,new Res(request.TraceId));
    Assert.Equal(200,response.StatusCode);Assert.Contains(job,Assert.Single(scope.NotifySent).MessageBody);
    Assert.Empty(scope.PublishSent);Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task ConcurrentSweeps_UseOneDurableNotification()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var (_,job)=await Job("build");
    await Task.WhenAll(Sweep(),Sweep());
    Assert.Single(scope.NotifySent);
    Assert.Equal(1L,await db.ScalarAsync("select count(*) from automation_notifications where dedupe_key=$1",$"content-publish:{job}:build"));
  }

  [Fact]
  public async Task EnqueueFailure_RetriesExistingNotification_WithoutResendingAcknowledgedQueueMessage()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var (_,job)=await Job("manifest");scope.FailNotify=true;Assert.Equal(0,await Sweep());
    var key=$"content-publish:{job}:manifest";
    Assert.Equal("enqueue_failed",await db.ScalarAsync("select status from automation_notifications where dedupe_key=$1",key));
    scope.FailNotify=false;Assert.Equal(1,await Sweep());Assert.Equal(0,await Sweep());Assert.Single(scope.NotifySent);
    Assert.Equal(2,await db.ScalarAsync("select attempts from automation_notifications where dedupe_key=$1",key));
  }

  [Fact]
  public async Task NeverSentRow_IsRecovered_WhileOrdinaryAutomationRemainsOff()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var (_,job)=await Job("build");await Sweep();scope.NotifySent.Clear();
    await db.QueryAsync("update automation_notifications set attempts=0,status='queued',created_at=now()-interval '11 minutes' where dedupe_key=$1",$"content-publish:{job}:build");
    Assert.Equal(1,await Sweep());Assert.Single(scope.NotifySent);
  }

  [Fact]
  public async Task OrdinaryOldSupersededAndStillRetryingJobs_DoNotAlert()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    await Job("build",reviewed:false);
    var old=await Job("build");await db.QueryAsync("update deck_publishes set created_at=now()-interval '1 day' where job_id=$1",old.Job);
    var superseded=await Job("build");await db.QueryAsync("update decks set release_generation=1 where id=$1",superseded.Deck);
    var cancelled=await Job("build");await db.QueryAsync("update deck_publishes set error_message='RELEASE_SUPERSEDED' where job_id=$1",cancelled.Job);
    var retrying=await Job("dispatch");await db.QueryAsync("update publish_dispatch set attempts=4 where job_id=$1",retrying.Job);
    var accepted=await Job("dispatch");await db.QueryAsync("update publish_dispatch set delivered_at=now() where job_id=$1",accepted.Job);
    var leased=await Job("dispatch");await db.QueryAsync("update publish_dispatch set lease_until=now()+interval '1 minute' where job_id=$1",leased.Job);
    var delivered=await Job("manifest");await db.QueryAsync("update publish_manifest_delivery set state='delivered' where job_id=$1",delivered.Job);
    Assert.Equal(0,await Sweep());Assert.Empty(scope.NotifySent);
  }

  [Fact]
  public async Task ConcurrentResends_ClaimOneOperationalSweep()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    await Job("build");scope.FailNotify=true;await Sweep();scope.FailNotify=false;
    var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var sends=0;
    Notifications.TestSendSeam=async _=>{Interlocked.Increment(ref sends);entered.TrySetResult();await release.Task;};
    var first=Sweep();
    try {await entered.Task.WaitAsync(TimeSpan.FromSeconds(2));Assert.Equal(0,await Sweep().WaitAsync(TimeSpan.FromSeconds(2)));}
    finally {release.TrySetResult();await first;}
    Assert.Equal(1,sends);
  }

  [Fact]
  public async Task SlowDatabaseQuery_IsCancelled_AndReleasesSweepLock()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);await Job("build");
    await using var blocker=await db.OpenAsync();await using var tx=await blocker.BeginTransactionAsync();
    await new Npgsql.NpgsqlCommand("lock table deck_publishes in access exclusive mode",blocker,tx).ExecuteNonQueryAsync();
    await using var conn=await db.OpenAsync();using var cancel=new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
    var watch=System.Diagnostics.Stopwatch.StartNew();
    try {Assert.Equal(0,await ContentPublishAlerts.SweepAsync(conn,"off",cancel.Token));Assert.True(watch.Elapsed<TimeSpan.FromSeconds(3));}
    finally {await tx.RollbackAsync();}
    Assert.Empty(scope.NotifySent);Assert.Equal(1,await Sweep());
  }

  [Fact]
  public async Task OrdinaryResender_LeavesOperationalRowsToTheirLockedSweep()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);await Job("build");scope.FailNotify=true;await Sweep();scope.FailNotify=false;
    await using var conn=await db.OpenAsync();await Notifications.ResendAsync(conn,5);
    Assert.DoesNotContain(scope.NotifySent,m=>m.MessageBody.Contains(ContentPublishAlerts.Subkind));scope.NotifySent.Clear();
    Assert.Equal(1,await Sweep());
  }

  [Fact]
  public async Task ManifestWithLiveLeaseOrAnotherLiveBuild_IsNotFinal()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);
    var leased=await Job("manifest");await db.QueryAsync("update publish_manifest_delivery set state='pending',lease_until=now()+interval '1 minute' where job_id=$1",leased.Job);
    var old=await Job("manifest");await db.QueryAsync("update decks set live_build_id='another-live-build' where id=$1",old.Deck);
    Assert.Equal(0,await Sweep());Assert.Empty(scope.NotifySent);
  }

  [Fact]
  public async Task SendCancelledAtDeadline_PersistsUnconfirmedStateForSameIdentityRetry()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("build");
    var original=Notifications.TestSendSeam;using var cancel=new CancellationTokenSource();
    Notifications.TestSendSeam=_=>{cancel.Cancel();return Task.FromException(new OperationCanceledException(cancel.Token));};
    await using(var conn=await db.OpenAsync()) await ContentPublishAlerts.SweepAsync(conn,"off",cancel.Token);
    var key=$"content-publish:{job}:build";
    var row=Assert.Single(await db.QueryAsync("select notification_id,status,error_code from automation_notifications where dedupe_key=$1",key));
    Assert.Equal("enqueue_failed",row["status"]);Assert.Equal("ENQUEUE_UNCONFIRMED",row["error_code"]);
    Notifications.TestSendSeam=original;Assert.Equal(1,await Sweep());
    Assert.Contains(row["notification_id"]!.ToString()!,Assert.Single(scope.NotifySent).MessageBody);
  }

  [Fact]
  public async Task SuccessfulResendAtDeadline_IsAcknowledgedAndNotSentAgain()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Enable(scope);var (_,job)=await Job("build");
    scope.FailNotify=true;await Sweep();scope.FailNotify=false;using var cancel=new CancellationTokenSource();var sends=0;
    Notifications.TestSendSeam=_=>{Interlocked.Increment(ref sends);cancel.Cancel();return Task.CompletedTask;};
    await using(var conn=await db.OpenAsync()) await ContentPublishAlerts.SweepAsync(conn,"off",cancel.Token);
    Assert.Equal("queued",await db.ScalarAsync("select status from automation_notifications where dedupe_key=$1",$"content-publish:{job}:build"));
    Assert.Equal(0,await Sweep());Assert.Equal(1,sends);
  }

  [Fact]
  public async Task MissingOrInvalidActivation_DoesNotSendHistoricalProblems()
  {
    await using var scope=new A04Kit.Scope(AutomationMode.Off);await Job("build");
    foreach(var value in new string?[]{null,"invalid"}) {scope.Set(ContentPublishAlerts.SinceEnv,value);Assert.Equal(0,await Sweep());}
    Assert.Empty(scope.NotifySent);
  }
}
