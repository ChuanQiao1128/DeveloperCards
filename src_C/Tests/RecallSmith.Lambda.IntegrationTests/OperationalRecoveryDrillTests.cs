using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Runtime;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.Services;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

// Exactly two isolated drills. Production handlers/SQL run; AWS transports and JWT verification do not.
[Collection(PostgresCollection.Name)]
public sealed class OperationalRecoveryDrillTests(PostgresFixture db)
{
  private static LambdaRequest Request(string path, object body) => new(JsonSerializer.SerializeToElement(new {
    rawPath=path, requestContext=new {http=new {method="POST"}}, body=JsonSerializer.Serialize(body)
  }));
  private static AuthContext Auth(string user) => new(new Dictionary<string,JsonElement>(),user,user,["super_admin"],true,false,true);
  private static JsonElement Data(APIGatewayProxyResponse r) => JsonDocument.Parse(r.Body).RootElement.GetProperty("data").Clone();

  [Fact(Timeout=60000)]
  public async Task SyncFailure_LocalNotification_RetryAndReplayRestoreOneProgress()
  {
    using var drill=new Drill("sync");
    var user="it-drill-"+Guid.NewGuid().ToString("N");
    var uid="drill-"+Guid.NewGuid().ToString("N");
    var eventId=Guid.NewGuid().ToString();
    var time=DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeMilliseconds();
    var body=new {events=new[]{new {eventId,deckSlug="drill",stableUid=uid,rating=3,eventTimeMs=time,nextReviewAtMs=time+86400000,
      schedulerVersion="drill-v1",progressAfter=new {stage=2,lapses=1}}}};
    var constraint="drill_"+Guid.NewGuid().ToString("N");
    await db.QueryAsync($"alter table user_progress_events add constraint {constraint} check(stable_uid<>'{uid}')");
    APIGatewayProxyResponse failed;
    try
    {
      drill.Call();failed=await ProgressEvents.HandleProgressEvents(Request("/api/progress/events",body),new Res("local-drill"),Auth(user));
      Assert.Equal(500,failed.StatusCode);
      Assert.Equal(0L,await db.ScalarAsync("select count(*) from user_progress_events where user_sub=$1",user));
      await drill.Notify("ALARM",new {status=failed.StatusCode,code="INJECTED_DATABASE_REJECTION",pending=1,serviceFailure=true});
    }
    finally {await db.QueryAsync($"alter table user_progress_events drop constraint {constraint}");}
    drill.Call();var retry=await ProgressEvents.HandleProgressEvents(Request("/api/progress/events",body),new Res("local-drill"),Auth(user));
    Assert.Equal(200,retry.StatusCode);Assert.Equal(1,Data(retry).GetProperty("acceptedCount").GetInt32());
    drill.Call();var replay=await ProgressEvents.HandleProgressEvents(Request("/api/progress/events",body),new Res("local-drill"),Auth(user));
    Assert.Equal(200,replay.StatusCode);Assert.Equal(0,Data(replay).GetProperty("acceptedCount").GetInt32());
    Assert.Equal(eventId,Data(replay).GetProperty("duplicateEventIds")[0].GetString());
    var row=Assert.Single(await db.QueryAsync("select review_count,last_rating,srs_stage,last_scheduler_version,last_review_event_id::text as winner,scheduler_state::text as scheduler_state from user_progress where user_sub=$1",user));
    Assert.Equal(1,row["review_count"]);Assert.Equal(3,row["last_rating"]);Assert.Equal(2,Convert.ToInt32(row["srs_stage"]));
    Assert.Equal("drill-v1",row["last_scheduler_version"]);Assert.Equal(eventId,row["winner"]);
    Assert.Equal(1L,await db.ScalarAsync("select count(*) from user_progress_events where user_sub=$1",user));
    await drill.Notify("OK",new {pending=0,accepted=1,duplicates=1,reviewCount=row["review_count"]});
    drill.Save(new {restoredPath="ProgressEvents.HandleProgressEvents -> PostgreSQL user_progress/events",finalData=row,eventRows=1,
      offlinePendingIsServiceFailure=false,externalProviders="UNKNOWN",nativeQueue="UNKNOWN"});
  }

  [Fact(Timeout=60000)]
  public async Task PublishStall_LocalNotification_ResumeProcessorManifestAndDownloadedHash()
  {
    using var drill=new Drill("publish");
    var slug="it-drill-"+Guid.NewGuid().ToString("N");
    var deck=Convert.ToInt64(await db.ScalarAsync("insert into decks(slug,title,author,deck_type) values($1,'drill','synthetic',1) returning id",slug));
    await db.QueryAsync("insert into cards(deck_id,stable_uid,question,explanation,order_in_deck) values($1,'drill-card','local question','local answer',1)",deck);
    Publish.TestEnqueueSeam=new("local-queue","local-bucket",_=>throw new TimeoutException("injected local queue outage"));
    APIGatewayProxyResponse failed;
    try
    {
      drill.Call();failed=await Publish.HandleAuthoringPublish(Request("/api/v1/authoring/publish",new {deckId=deck,actionId="drill-action"}),new Res("local-drill"),Auth("local-drill-owner"));
    }
    finally {Publish.TestEnqueueSeam=null;}
    Assert.Equal(503,failed.StatusCode);var job=Data(failed).GetProperty("jobId").GetString()!;
    Assert.Equal("PENDING",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
    await drill.Notify("ALARM",new {status=failed.StatusCode,jobId=job,code="LOCAL_DISPATCH_STALLED"});
    await db.QueryAsync("update publish_dispatch set next_attempt_at=now()-interval '1 second',lease_until=now()-interval '1 second' where job_id=$1",job);
    await using var conn=await db.OpenAsync();
    string? dispatched=null;
    Assert.True(await PublishDelivery.Dispatch(conn,job,body=>{dispatched=body;return Task.CompletedTask;}));
    Assert.Equal(job,JsonDocument.Parse(dispatched!).RootElement.GetProperty("jobId").GetString());
    using var store=new LocalS3();
    var field=typeof(S3DeckUploader).GetField("_s3",BindingFlags.Static|BindingFlags.NonPublic)!;
    var bucket=Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    var premium=Environment.GetEnvironmentVariable("PREMIUM_BUCKET");
    Environment.SetEnvironmentVariable("CONTENT_BUCKET","local-bucket");
    Environment.SetEnvironmentVariable("PREMIUM_BUCKET","local-bucket");
    var previous=field.GetValue(null);
    field.SetValue(null,store);
    try
    {
      var processor=new PublishJobProcessor(new JobRepository(),new S3DeckUploader());
      drill.Call();await processor.ProcessAsync(job).WaitAsync(TimeSpan.FromSeconds(30));
      Assert.Equal("SUCCESS",await db.ScalarAsync("select status from deck_publishes where job_id=$1",job));
      Assert.False(await processor.DeliverManifestAsync(job,()=>throw new IOException("injected local manifest outage")));
      Assert.Equal("pending",await db.ScalarAsync("select state from publish_manifest_delivery where job_id=$1",job));
      await db.QueryAsync("update publish_manifest_delivery set next_attempt_at=now()-interval '1 second' where job_id=$1",job);
      Assert.True(await processor.DeliverManifestAsync(job,()=>ManifestBuilder.RebuildAsync(conn,store,"local-bucket","content","premium")));
      using var manifest=JsonDocument.Parse(Encoding.UTF8.GetString(store.Objects["content/manifest.json"]));
      var entry=manifest.RootElement.GetProperty("decks").EnumerateArray().Single(d=>d.GetProperty("slug").GetString()==slug);
      var build=(string)(await db.ScalarAsync("select live_build_id from decks where id=$1",deck))!;
      Assert.Equal(build,entry.GetProperty("buildId").GetString());
      var path="content/"+entry.GetProperty("path").GetString();
      using var download=await store.GetObjectAsync(new GetObjectRequest{BucketName="local-bucket",Key=path});
      var hash=Convert.ToHexString(await SHA256.HashDataAsync(download.ResponseStream)).ToLowerInvariant();
      Assert.Equal(hash,entry.GetProperty("sha256").GetString());
      using var exported=JsonDocument.Parse(store.Objects[path]);
      Assert.Equal(build,exported.RootElement.GetProperty("version").GetString());
      Assert.Single(exported.RootElement.GetProperty("cards").EnumerateArray());
      Assert.Equal("delivered",await db.ScalarAsync("select state from publish_manifest_delivery where job_id=$1",job));
      await drill.Notify("OK",new {jobId=job,status="SUCCESS",manifestDelivery="delivered",build,sha256=hash});
      drill.Save(new {restoredPath="Publish -> publish_dispatch -> PublishDelivery.Dispatch -> PublishJobProcessor -> ManifestBuilder",jobId=job,
        finalData=new {status="SUCCESS",manifestDelivery="delivered",build,path,sha256=hash,downloadBytes=store.Objects[path].Length},
        conditionalWrites=store.ConditionalWrites,externalProviders="UNKNOWN",transport="stateful local S3 fixture; no AWS requests"});
    }
    finally {field.SetValue(null,previous);Environment.SetEnvironmentVariable("CONTENT_BUCKET",bucket);Environment.SetEnvironmentVariable("PREMIUM_BUCKET",premium);}
  }

  // Intercepts every SDK operation the real uploader/manifest builder uses; no network client fallback.
  private sealed class LocalS3():AmazonS3Client(new AnonymousAWSCredentials(),new AmazonS3Config{ServiceURL="http://127.0.0.1:1",ForcePathStyle=true,AuthenticationRegion="ap-southeast-2",MaxErrorRetry=0,Timeout=TimeSpan.FromSeconds(2)})
  {
    public readonly Dictionary<string,byte[]> Objects=new();
    private readonly Dictionary<string,string> etags=new();
    public int ConditionalWrites;
    public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest req,CancellationToken ct=default)
    {
      // Uploader caches its bucket statically; prior tests may have initialized another synthetic name.
      Assert.True(req.IfNoneMatch=="*" || req.IfMatch is not null,"Every drill object write must be conditional");
      ConditionalWrites++;
      if((req.IfNoneMatch=="*" && Objects.ContainsKey(req.Key)) || (req.IfMatch is not null && etags.GetValueOrDefault(req.Key)!=req.IfMatch))
        throw new AmazonS3Exception("conditional conflict"){StatusCode=HttpStatusCode.PreconditionFailed};
      byte[] bytes;
      if(req.FilePath is not null)bytes=await File.ReadAllBytesAsync(req.FilePath,ct);
      else if(req.ContentBody is not null)bytes=Encoding.UTF8.GetBytes(req.ContentBody);
      else {using var output=new MemoryStream();await req.InputStream.CopyToAsync(output,ct);bytes=output.ToArray();}
      Assert.True(bytes.Length<=65536,"Synthetic fixture payload exceeds drill bound");
      Objects[req.Key]=bytes;etags[req.Key]='"'+Guid.NewGuid().ToString("N")+'"';
      return new PutObjectResponse{ETag=etags[req.Key]};
    }
    public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest req,CancellationToken ct=default)
    {
      var bytes=Objects[req.Key];return Task.FromResult(new GetObjectResponse{ContentLength=bytes.Length,ResponseStream=new MemoryStream(bytes)});
    }
    public override Task<GetObjectMetadataResponse> GetObjectMetadataAsync(GetObjectMetadataRequest req,CancellationToken ct=default)
    {
      if(!Objects.ContainsKey(req.Key))throw new AmazonS3Exception("missing"){StatusCode=HttpStatusCode.NotFound};
      return Task.FromResult(new GetObjectMetadataResponse{ETag=etags[req.Key],LastModified=DateTime.UtcNow});
    }
  }

  private sealed class Drill:IDisposable
  {
    private readonly string name;
    private readonly Stopwatch elapsed=Stopwatch.StartNew();
    private readonly HttpListener listener=new();
    private readonly HttpClient client=new(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(5)};
    private readonly Uri endpoint;
    private readonly List<JsonElement> receipts=new();
    private int calls;
    public Drill(string name)
    {
      this.name=name;
      using var port=new TcpListener(IPAddress.Loopback,0);port.Start();var number=((IPEndPoint)port.LocalEndpoint).Port;port.Stop();
      endpoint=new Uri($"http://127.0.0.1:{number}/notify/");
      Assert.True(IPAddress.TryParse(endpoint.Host,out var ip) && IPAddress.IsLoopback(ip));
      listener.Prefixes.Add(endpoint.AbsoluteUri);listener.Start();
    }
    public void Call(){Assert.True(++calls<=15);Assert.True(elapsed.Elapsed<TimeSpan.FromSeconds(60));}
    public async Task Notify(string state,object context)
    {
      Assert.True(receipts.Count<2);Assert.Equal(receipts.Count==0?"ALARM":"OK",state);
      var receive=listener.GetContextAsync().WaitAsync(TimeSpan.FromSeconds(5));
      var payload=JsonSerializer.Serialize(new {drill=name,state,context,scope="loopback-only"});
      using var content=new StringContent(payload,Encoding.UTF8,"application/json");
      var send=client.PostAsync(endpoint,content);
      var request=await receive;
      Assert.True(IPAddress.IsLoopback(request.Request.RemoteEndPoint!.Address));
      Assert.InRange(request.Request.ContentLength64,1,4096);
      using var body=new MemoryStream();await request.Request.InputStream.CopyToAsync(body);
      Assert.True(body.Length<=4096);
      receipts.Add(JsonDocument.Parse(body.ToArray()).RootElement.Clone());
      request.Response.StatusCode=204;request.Response.Close();
      using var response=await send;Assert.Equal(HttpStatusCode.NoContent,response.StatusCode);
    }
    public void Save(object result)
    {
      Assert.Equal(2,receipts.Count);Assert.True(elapsed.Elapsed<TimeSpan.FromSeconds(60));
      var json=JsonSerializer.Serialize(new {schema=1,drill=name,elapsedMs=elapsed.ElapsedMilliseconds,handlerInvocations=calls,
        businessHttpRequests=0,notificationReceipts=receipts,budget=new {drills=2,totalHandlerInvocations=30,notifications=4,phaseSeconds=60,eventBytes=65536},result});
      Assert.True(Encoding.UTF8.GetByteCount(json)<=32768);
      var directory=Environment.GetEnvironmentVariable("P5_DRILL_EVIDENCE_DIR");
      if(directory is not null){Directory.CreateDirectory(directory);File.WriteAllText(Path.Combine(directory,$"P5-{name}-drill.json"),json);}
    }
    public void Dispose(){listener.Close();client.Dispose();}
  }
}
