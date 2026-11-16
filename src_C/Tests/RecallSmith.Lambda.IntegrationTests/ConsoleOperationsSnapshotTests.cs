using System.Net;
using System.Text;
using System.Text.Json;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Operations;
using static RecallSmith.Lambda.IntegrationTests.ConsoleOperationsCanaryTests;
namespace RecallSmith.Lambda.IntegrationTests;
[Collection(PostgresCollection.Name)]
public class ConsoleOperationsSnapshotTests(PostgresFixture db)
{
  private static readonly DateTimeOffset Now=new(2026,11,16,0,0,0,TimeSpan.Zero);
  private static readonly string[] Names=["api-health","cdn-manifest","cdn-deck","console-index","api-auth-guard","api-sync-guard","remote-config","cognito-console","cognito-mobile"];
  private static byte[] Snapshot(DateTimeOffset observed,string? failed=null,string? unknown=null,string alarm="OK",bool advisory=false) => JsonSerializer.SerializeToUtf8Bytes(new{schemaVersion=1,runId="run-1",observedAt=observed,completedAt=observed.AddSeconds(1),expiresAt=observed.AddMinutes(30),checks=Names.Select(name=>new{name,status=name==failed?"failed":name==unknown?"unknown":"healthy",advisory=name=="remote-config",httpStatus=(int?)200,latencyMs=(int?)20,code=(string?)null}),alarms=new{state="known",observedAt=observed,items=new[]{new{name="DeveloperCards-test-alarm",state=alarm,stateUpdatedAt=(DateTimeOffset?)observed}},reason=(string?)null}});
  [Fact] public void Fresh_failure_advisory_unknown_stale_future_and_alarm_OK_semantics()
  {
    var healthy=ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1)),Now);Assert.Equal("healthy",healthy.Synthetic["status"]);Assert.Equal("unknown",healthy.Alarms["status"]);
    Assert.Equal("failed",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1),failed:"api-health",unknown:"cdn-deck"),Now).Synthetic["status"]);
    Assert.Equal("degraded",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1),failed:"remote-config"),Now).Synthetic["status"]);
    Assert.Equal("degraded",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1),unknown:"remote-config"),Now).Synthetic["status"]);
    Assert.Equal("unknown",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1),unknown:"api-health"),Now).Synthetic["status"]);
    Assert.Equal("failed",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1),alarm:"ALARM"),Now).Alarms["status"]);
    Assert.Equal("unknown",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-1),alarm:"INSUFFICIENT_DATA"),Now).Alarms["status"]);
    var stale=ConsoleOperations.ParseSnapshot(Snapshot(Now.AddMinutes(-31),failed:"api-health",alarm:"ALARM"),Now);Assert.Equal("stale",stale.Synthetic["state"]);Assert.Equal("unknown",stale.Synthetic["status"]);Assert.Equal("unknown",stale.Alarms["status"]);Assert.NotEmpty((IEnumerable<object>)stale.Synthetic["checks"]!);
    Assert.Equal("unknown",ConsoleOperations.ParseSnapshot(Snapshot(Now.AddSeconds(61)),Now).Synthetic["state"]);
    foreach(var bytes in new[]{Encoding.UTF8.GetBytes("{}"),new byte[65537],Encoding.UTF8.GetBytes("not json"),Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Snapshot(Now)).Replace("\"schemaVersion\":1","\"schemaVersion\":2")),Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Snapshot(Now)).Replace("\"latencyMs\":20","\"latencyMs\":-1"))})Assert.Equal("invalid_snapshot",ConsoleOperations.ParseSnapshot(bytes,Now).Synthetic["reason"]);
  }
  private sealed class FakeS3(Func<CancellationToken,Task<GetObjectResponse>> respond) : AmazonS3Client(new Amazon.Runtime.AnonymousAWSCredentials(),new AmazonS3Config{RegionEndpoint=Amazon.RegionEndpoint.APSoutheast2})
  {
    public int Calls; public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest request,CancellationToken token=default)
    {Calls++;Assert.Equal(ConsoleOperations.SnapshotKey,request.Key);Assert.Equal("private-ops-test",request.BucketName);return respond(token);}
  }
  [Theory][InlineData("missing","snapshot_missing")][InlineData("denied","snapshot_denied")][InlineData("oversize","invalid_snapshot")][InlineData("oversize-stream","invalid_snapshot")][InlineData("timeout","source_timeout")][InlineData("malformed","invalid_snapshot")][InlineData("healthy",null)]
  public async Task Bounded_S3_optional_errors_remain_200_and_audited(string mode,string? reason)
  {
    _=db;
    var envs=new[]{"OPS_SNAPSHOT_BUCKET","OPS_SNAPSHOT_KEY","PREMIUM_BUCKET"};var previous=envs.ToDictionary(e=>e,Environment.GetEnvironmentVariable);
    Environment.SetEnvironmentVariable("OPS_SNAPSHOT_BUCKET","private-ops-test");Environment.SetEnvironmentVariable("PREMIUM_BUCKET","private-ops-test");Environment.SetEnvironmentVariable("OPS_SNAPSHOT_KEY",ConsoleOperations.SnapshotKey);
    using var fake=new FakeS3(async token=>
    {
      if(mode=="missing")throw new AmazonS3Exception("private error must not escape"){StatusCode=HttpStatusCode.NotFound};
      if(mode=="denied")throw new AmazonS3Exception("private error must not escape"){StatusCode=HttpStatusCode.Forbidden};
      if(mode=="timeout")await Task.Delay(Timeout.Infinite,token);
      var bytes=mode.StartsWith("oversize")?new byte[65537]:mode=="malformed"?Encoding.UTF8.GetBytes("{bad"):Snapshot(Now.AddMinutes(-1));
      return new GetObjectResponse{ContentLength=mode=="oversize-stream"?0:bytes.Length,ResponseStream=new MemoryStream(bytes)};
    });
    try
    {
      var r=await ConsoleOperations.HandleOverview(Request(ConsoleOperations.OverviewPath),new Res("snapshot"),Admin,fake,Now);Assert.Equal(200,r.StatusCode);var view=Data(r).GetProperty("synthetic");Assert.Equal(reason,view.GetProperty("reason").GetString());Assert.Equal(mode=="healthy"?"healthy":"unknown",view.GetProperty("status").GetString());Assert.Equal(1,fake.Calls);Assert.DoesNotContain("private error",r.Body);
      var audit=await db.QueryAsync("select target,actor_username,before_state,after_state from admin_audit where trace_id='snapshot' order by id desc limit 1");Assert.Equal("operations",audit[0]["target"]);Assert.Null(audit[0]["actor_username"]);
    }
    finally{foreach(var pair in previous)Environment.SetEnvironmentVariable(pair.Key,pair.Value);}
  }
  [Fact] public async Task Missing_configuration_is_unknown_without_S3_and_safe_links_are_https_only()
  {
    var vars=new[]{"OPS_SNAPSHOT_BUCKET","OPS_CLOUDWATCH_URL","OPS_SENTRY_URL"};var old=vars.ToDictionary(v=>v,Environment.GetEnvironmentVariable);
    using var fake=new FakeS3(_=>throw new Exception("must not read"));
    try
    {
      Environment.SetEnvironmentVariable("OPS_SNAPSHOT_BUCKET",null);Environment.SetEnvironmentVariable("OPS_CLOUDWATCH_URL","https://user:secret@example.test/path");Environment.SetEnvironmentVariable("OPS_SENTRY_URL","https://example.test/path?secret=private");
      var r=await ConsoleOperations.HandleOverview(Request(ConsoleOperations.OverviewPath),new Res("no-config"),Admin,fake,Now);Assert.Equal(200,r.StatusCode);var d=Data(r);Assert.Equal("not_configured",d.GetProperty("synthetic").GetProperty("reason").GetString());Assert.Equal(0,fake.Calls);Assert.Equal(JsonValueKind.Null,d.GetProperty("links").GetProperty("cloudWatch").ValueKind);Assert.Equal(JsonValueKind.Null,d.GetProperty("links").GetProperty("sentry").ValueKind);
    }
    finally{foreach(var pair in old)Environment.SetEnvironmentVariable(pair.Key,pair.Value);}
  }
}
