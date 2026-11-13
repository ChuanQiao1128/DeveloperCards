using System.Text.Json;
using Amazon.Lambda.SQSEvents;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class LegacyManifestUpgradeTests(PostgresFixture db)
{
  private sealed class NoUpload : IS3DeckUploader
  {
    public int Calls;
    public Task<S3UploadResult> UploadAsync(string key,DeckExportData data){Calls++;throw new Exception("Legacy replay must not upload a deck");}
    public Task<S3UploadResult> UploadJsonAsync(string key,string json,string cache){Calls++;throw new Exception("Legacy replay must not upload artifacts");}
    public Task<string> DownloadJsonAsync(string key){Calls++;throw new Exception("Legacy replay must not download a deck");}
  }

  private sealed class NoArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job,DeckExportData data,S3UploadResult upload)=>throw new Exception("No legacy artifact generation");
  }

  private async Task On052(Func<NpgsqlConnection,Task> test)
  {
    var saved=Environment.GetEnvironmentVariable("PGDATABASE");
    var cs=await db.CreateScratchDatabaseAsync("it_manifest_upgrade_"+Guid.NewGuid().ToString("N"));
    await using var conn=new NpgsqlConnection(cs);await conn.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(conn,52);
    Environment.SetEnvironmentVariable("PGDATABASE",new NpgsqlConnectionStringBuilder(cs).Database);Pg.Reset();
    try {await test(conn);}
    finally {Environment.SetEnvironmentVariable("PGDATABASE",saved);Pg.Reset();}
  }

  private static async Task Apply053(NpgsqlConnection conn)
  {
    var sql=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Db","Migrations","053_publish_delivery_recovery.sql"));
    await DbUtil.ExecuteAsync(conn,null,sql,[]);
  }

  private static async Task<(long Id,string Slug)> Deck(NpgsqlConnection conn)
  {
    var slug="legacy-upgrade-"+Guid.NewGuid().ToString("N");
    var id=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn,null,
      "insert into decks(slug,title,author,deck_type,tier,availability) values($1,'legacy','tests',1,'free','live') returning id",[slug]));
    return(id,slug);
  }

  private static async Task<(string Job,string Build)> CommitOn052(NpgsqlConnection conn,long deck,string slug)
  {
    var job=Guid.NewGuid().ToString();var build="b-"+job;
    await DbUtil.ExecuteAsync(conn,null,"insert into deck_publishes(job_id,deck_id,deck_slug,build_id,s3_key,status) values($1,$2,$3,$4,$5,'PROCESSING')",
      [job,deck,slug,build,$"content/decks/{slug}/builds/{build}/deck.json"]);
    await new JobRepository().CompleteJobAsync(job,1);
    Assert.Equal("SUCCESS",await DbUtil.ExecuteScalarAsync(conn,null,"select status from deck_publishes where job_id=$1",[job]));
    Assert.Equal(build,await DbUtil.ExecuteScalarAsync(conn,null,"select live_build_id from decks where id=$1",[deck]));
    return(job,build);
  }

  private static Task<SQSBatchResponse> Replay(WorkerFunction worker,string job)=>worker.FunctionHandler(new SQSEvent
  {
    Records=[new SQSEvent.SQSMessage{MessageId="legacy-replay",Body=JsonSerializer.Serialize(new{jobId=job}),Attributes=new(){["ApproximateReceiveCount"]="2"}}]
  },null!);

  private static async Task AssertCurrentManifest(NpgsqlConnection conn,string slug,string expected)
  {
    using var doc=JsonDocument.Parse((await ManifestBuilder.BuildAsync(conn,"content",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())).Json);
    Assert.Equal(expected,doc.RootElement.GetProperty("decks").EnumerateArray().Single(d=>d.GetProperty("slug").GetString()==slug).GetProperty("buildId").GetString());
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task SuccessBefore053_FailedManifest_ReplayAdoptsIntent_AndRecoveryUsesCurrentPointer(bool pointerChanged)
  {
    await On052(async conn=>
    {
      var deck=await Deck(conn);var old=await CommitOn052(conn,deck.Id,deck.Slug);var expected=old.Build;
      var uploader=new NoUpload();var processor=new PublishJobProcessor(new JobRepository(),uploader,new NoArtifacts());
      await Assert.ThrowsAsync<IOException>(()=>processor.DeliverManifestAsync(old.Job,()=>throw new IOException("manifest failed before upgrade")));
      if(pointerChanged) expected=(await CommitOn052(conn,deck.Id,deck.Slug)).Build;
      await Apply053(conn);
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_manifest_delivery",[]));
      var attempts=0;
      var worker=new WorkerFunction(processor,async _=>
      {
        attempts++;await AssertCurrentManifest(conn,deck.Slug,expected);throw new IOException("manifest still unavailable after upgrade");
      });
      Assert.Empty((await Replay(worker,old.Job)).BatchItemFailures);
      Assert.Equal(1,attempts);
      Assert.Equal("pending",await DbUtil.ExecuteScalarAsync(conn,null,"select state from publish_manifest_delivery where job_id=$1",[old.Job]));
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_dispatch",[]));
      await DbUtil.ExecuteAsync(conn,null,"update publish_manifest_delivery set next_attempt_at=now()-interval '1 second' where job_id=$1",[old.Job]);
      var recovered=await PublishDelivery.RecoverManifest(conn,async()=>{attempts++;await AssertCurrentManifest(conn,deck.Slug,expected);},()=>false,max:1);
      Assert.Equal(1,recovered);Assert.Equal(2,attempts);
      Assert.Equal("delivered",await DbUtil.ExecuteScalarAsync(conn,null,"select state from publish_manifest_delivery where job_id=$1",[old.Job]));
      Assert.Empty((await Replay(worker,old.Job)).BatchItemFailures);Assert.Equal(2,attempts);
      Assert.Equal(0,uploader.Calls);
      Assert.Equal("SUCCESS",await DbUtil.ExecuteScalarAsync(conn,null,"select status from deck_publishes where job_id=$1",[old.Job]));
      Assert.Equal(expected,await DbUtil.ExecuteScalarAsync(conn,null,"select live_build_id from decks where id=$1",[deck.Id]));
    });
  }

  [Fact]
  public async Task ScannerAdoptsOnlyCurrentLegacySuccess_AndNeverWalksHistoricalBuilds()
  {
    await On052(async conn=>
    {
      var deck=await Deck(conn);(string Job,string Build) current=(string.Empty,string.Empty);
      for(var i=0;i<12;i++) current=await CommitOn052(conn,deck.Id,deck.Slug);
      await Apply053(conn);var rebuilds=0;
      Assert.Equal(1,await PublishDelivery.RecoverManifest(conn,async()=>{rebuilds++;await AssertCurrentManifest(conn,deck.Slug,current.Build);},()=>false));
      Assert.Equal(1,rebuilds);
      Assert.Equal(1L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_manifest_delivery",[]));
      Assert.Equal(current.Job,await DbUtil.ExecuteScalarAsync(conn,null,"select job_id from publish_manifest_delivery",[]));
      Assert.Equal(0,await PublishDelivery.RecoverManifest(conn,()=>{rebuilds++;return Task.CompletedTask;},()=>false));
      Assert.Equal(1,rebuilds);
      Assert.Equal(12L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from deck_publishes where status='SUCCESS'",[]));
    });
  }

  [Fact]
  public async Task ScannerAdoption_IsBounded_AndOneCurrentManifestWriteCoversTheBatch()
  {
    await On052(async conn=>
    {
      for(var i=0;i<6;i++){var deck=await Deck(conn);await CommitOn052(conn,deck.Id,deck.Slug);}
      await Apply053(conn);var rebuilds=0;
      Task Rebuild(){rebuilds++;return Task.CompletedTask;}
      Assert.Equal(0,await PublishDelivery.RecoverManifest(conn,Rebuild,()=>true));
      Assert.Equal(0L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_manifest_delivery",[]));
      Assert.Equal(5,await PublishDelivery.RecoverManifest(conn,Rebuild,()=>false));
      Assert.Equal(1,rebuilds);
      Assert.Equal(5L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_manifest_delivery where state='delivered'",[]));
      Assert.Equal(1,await PublishDelivery.RecoverManifest(conn,Rebuild,()=>false));Assert.Equal(2,rebuilds);
      Assert.Equal(0,await PublishDelivery.RecoverManifest(conn,Rebuild,()=>false));Assert.Equal(2,rebuilds);
    });
  }

  [Fact]
  public async Task FailedLegacyBatch_RemainsPending_AndARepeatedScanCompletesItWithoutExtraWrites()
  {
    await On052(async conn=>
    {
      for(var i=0;i<5;i++){var deck=await Deck(conn);await CommitOn052(conn,deck.Id,deck.Slug);}
      await Apply053(conn);var writes=0;
      Assert.Equal(5,await PublishDelivery.RecoverManifest(conn,()=>{writes++;throw new IOException("conditional S3 write unavailable");},()=>false));
      Assert.Equal(1,writes);
      Assert.Equal(5L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_manifest_delivery where state='pending' and attempts=1",[]));
      Assert.Equal(5L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from deck_publishes where status='SUCCESS'",[]));
      await DbUtil.ExecuteAsync(conn,null,"update publish_manifest_delivery set next_attempt_at=now()-interval '1 second'",[]);
      Assert.Equal(5,await PublishDelivery.RecoverManifest(conn,()=>{writes++;return Task.CompletedTask;},()=>false));
      Assert.Equal(2,writes);
      Assert.Equal(5L,await DbUtil.ExecuteScalarAsync(conn,null,"select count(*) from publish_manifest_delivery where state='delivered' and attempts=2",[]));
      Assert.Equal(0,await PublishDelivery.RecoverManifest(conn,()=>{writes++;return Task.CompletedTask;},()=>false));
      Assert.Equal(2,writes);
    });
  }
}
