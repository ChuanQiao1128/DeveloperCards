using System.Diagnostics;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>Manual super-admin path is independent of AI; new scheduled work is opt-in after cost verification.</summary>
public sealed record MaintenanceResult(bool RecoveryDurable, int Dispatch, int Manifest, List<string> Steps, List<string> FailedSteps);

public static class BaselineMaintenance
{
  public static bool Enabled => Environment.GetEnvironmentVariable("BASELINE_MAINTENANCE_ENABLED") == "1";
  public static bool RecoveryEnabled => Environment.GetEnvironmentVariable("PUBLISH_RECOVERY_ENABLED") == "1";
  internal static Func<Task>? TestManifestRebuild;

  public static async Task<MaintenanceResult> Run(NpgsqlConnection conn, TimeSpan budget, bool recover)
  {
    var clock = Stopwatch.StartNew();
    using var deadline = new CancellationTokenSource(budget > TimeSpan.Zero ? budget : TimeSpan.Zero);
    var failed = new List<string>();
    var steps = new List<string>();
    bool Stop()
    {
      if (clock.Elapsed < budget) return false;
      if (!failed.Contains(AutomationTick.BudgetExhausted)) failed.Add(AutomationTick.BudgetExhausted);
      return true;
    }
    async Task Step(string name, Func<Task> body)
    {
      if (Stop()) return;
      try { await body(); steps.Add(name); }
      catch (Exception ex)
      {
        failed.Add(name);
        Log.Event("warn", new { tag="maintenance", step=name, error=ex.Message });
      }
    }
    var durable = !Stop() && await PublishDelivery.Ready(conn);
    var dispatch = 0; var manifest = 0;
    if (recover && durable)
    {
      await Step("publish_dispatch", async () => dispatch = await PublishDelivery.RecoverDispatch(conn, async body =>
      {
        var queue = Publish.TestEnqueueSeam?.QueueUrl ?? Publish.WarmupQueueUrl;
        if (string.IsNullOrEmpty(queue)) throw new InvalidOperationException("Missing PUBLISH_JOB_QUEUE_URL");
        var message = new SendMessageRequest { QueueUrl=queue, MessageBody=body };
        if (Publish.TestEnqueueSeam is not null) await Publish.TestEnqueueSeam.Send(message).WaitAsync(deadline.Token);
        else await Publish.SqsForWarmup().SendMessageAsync(message,deadline.Token);
      }, Stop));
      await Step("publish_manifest", async () => manifest = await PublishDelivery.RecoverManifest(conn, async () =>
      {
        if (TestManifestRebuild is not null) { await TestManifestRebuild(); return; }
        var bucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
        if (string.IsNullOrEmpty(bucket)) throw new InvalidOperationException("Missing CONTENT_BUCKET");
        await ManifestBuilder.RebuildAsync(conn, ManifestBuilder.S3(), bucket,
          ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"),"content"),
          ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"),"premium"),ct:deadline.Token);
      }, Stop, PublishDelivery.Batch-dispatch));
    }
    await Step("anon_funnel_retention", () => Analytics.AnonFunnel.DeleteExpiredAsync(conn));
    // N1 retains unfinished external deletion obligations as needs_attention.
    await Step("revenuecat_deletions_retention", () => Runtime.RevenueCatDeletions.DeleteExpiredAsync(conn));
    await Step("analytics_daily", () => Analytics.UsageAnalytics.RunIfDueAsync(conn, budget-clock.Elapsed, budget));
    return new MaintenanceResult(durable,dispatch,manifest,steps,failed);
  }

  public static async Task<APIGatewayProxyResponse> Handle(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth,res);
    if (deny is not null) return deny;
    if (auth.IsAgentClient) return res.Forbidden("Requires normal Console session");
    if (req.Method != "POST") return res.MethodNotAllowed();
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res,"Missing PG env vars");
    var locked = await DbUtil.ExecuteScalarAsync(conn,null,"select pg_try_advisory_lock($1)",[AutomationTick.LockKey]) is true;
    if (!locked) return res.Ok(new { skipped="locked" });
    try
    {
      var result=await Run(conn,AutomationTick.Budget,recover:true);
      Log.Event("info",new{tag="maintenance",operation="run",source="console",dispatch=result.Dispatch,manifest=result.Manifest,failedSteps=result.FailedSteps});
      return res.Ok(result);
    }
    finally { await DbUtil.ExecuteAsync(conn,null,"select pg_advisory_unlock($1)",[AutomationTick.LockKey]); }
  }
}
