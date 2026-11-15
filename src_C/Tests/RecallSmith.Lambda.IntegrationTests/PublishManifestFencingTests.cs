using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class PublishManifestFencingTests(PostgresFixture db)
{
  // Stateful object store: HEAD snapshots ETag; PUT atomically enforces the observed version.
  public sealed class ConditionalS3() : AmazonS3Client(new AnonymousAWSCredentials(),
    new AmazonS3Config { RegionEndpoint = RegionEndpoint.APSoutheast2 })
  {
    private readonly object gate = new();
    public string? Body { get; private set; }
    private string? etag;
    public int Conflicts { get; private set; }
    public int Puts { get; private set; }
    public int Heads { get; private set; }
    public Func<PutObjectRequest,Task>? BeforePut;
    public readonly Dictionary<string,byte[]> Objects=new();
    public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest request,CancellationToken ct=default)
    {
      var bytes=Objects[request.Key];
      return Task.FromResult(new GetObjectResponse{ContentLength=bytes.Length,ResponseStream=new MemoryStream(bytes)});
    }
    public override Task<GetObjectMetadataResponse> GetObjectMetadataAsync(GetObjectMetadataRequest request,CancellationToken ct=default)
    {
      lock(gate)
      {
        Heads++;
        if(Body is null)throw new AmazonS3Exception("missing"){StatusCode=HttpStatusCode.NotFound};
        return Task.FromResult(new GetObjectMetadataResponse{ETag=etag,LastModified=DateTime.UtcNow.AddHours(2)});
      }
    }
    public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request,CancellationToken ct=default)
    {
      if(BeforePut is not null)await BeforePut(request);
      lock(gate)
      {
        Puts++;
        Assert.True(request.IfNoneMatch=="*" || request.IfMatch is not null,"Manifest writes must be conditional");
        if((request.IfNoneMatch=="*" && Body is not null) || (request.IfMatch is not null && request.IfMatch!=etag))
        {Conflicts++;throw new AmazonS3Exception("changed"){StatusCode=HttpStatusCode.PreconditionFailed};}
        Body=request.ContentBody;etag='"'+Guid.NewGuid().ToString("N")+'"';
        return new PutObjectResponse{ETag=etag};
      }
    }
  }

  private static string Sha(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
  private static JsonElement Deck(string json,string slug)
  {
    using var doc=JsonDocument.Parse(json);
    return doc.RootElement.GetProperty("decks").EnumerateArray().Single(d=>d.GetProperty("slug").GetString()==slug).Clone();
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task Paused_A_Cannot_Overwrite_B_And_Rebuilds_Current_Pointer(bool objectInitiallyExists)
  {
    await using var a=await db.OpenAsync();await using var b=await db.OpenAsync();
    var slug="it-fencing-"+Guid.NewGuid().ToString("N");
    var id=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(a,null,"insert into decks(slug,title,author) values($1,'race','tests') returning id",[slug]));
    var oldBytes="{\"cards\":[\"old\"]}";var newBytes="{\"cards\":[\"new\"]}";
    var packages=new Dictionary<string,string>{{"A",oldBytes},{"B",newBytes}};
    foreach(var build in new[]{"A","B"})
      await DbUtil.ExecuteAsync(a,null,"insert into deck_publishes(deck_id,deck_slug,build_id,job_id,s3_key,status,content_sha256) values($1,$2,$3,$4,$5,'SUCCESS',$6)",[id,slug,build,Guid.NewGuid().ToString(),$"content/decks/{slug}/builds/{build}/deck.json",Sha(packages[build])]);
    await DbUtil.ExecuteAsync(a,null,"update decks set live_build_id='A' where id=$1",[id]);
    using var s3=new ConditionalS3();
    foreach(var package in packages)s3.Objects[$"content/decks/{slug}/builds/{package.Key}/deck.json"]=Encoding.UTF8.GetBytes(package.Value);
    if(objectInitiallyExists)await ManifestBuilder.RebuildAsync(a,s3,"bucket","content","premium");
    var paused=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var resume=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var blocked=0;
    s3.BeforePut=async req=>
    {
      if(Deck(req.ContentBody,slug).GetProperty("buildId").GetString()=="A" && Interlocked.Exchange(ref blocked,1)==0)
      {paused.SetResult();await resume.Task.WaitAsync(TimeSpan.FromSeconds(30));}
    };
    // A's clock is ahead of B; version safety must come from ETag and DB, never time ordering.
    var late=ManifestBuilder.RebuildAsync(a,s3,"bucket","content","premium",nowMs:9_000_000);
    try
    {
      await paused.Task.WaitAsync(TimeSpan.FromSeconds(30));
      await DbUtil.ExecuteAsync(b,null,"update decks set live_build_id='B' where id=$1",[id]);
      await ManifestBuilder.RebuildAsync(b,s3,"bucket","content","premium",nowMs:1_000);
      Assert.Equal("B",Deck(s3.Body!,slug).GetProperty("buildId").GetString());
    }
    finally{resume.TrySetResult();}
    await late;
    Assert.Equal(1,s3.Conflicts);
    var final=Deck(s3.Body!,slug);
    Assert.Equal("B",final.GetProperty("buildId").GetString());
    Assert.Equal($"decks/{slug}/builds/B/deck.json",final.GetProperty("path").GetString());
    // Isolated download bytes are actually hashed against the manifest, not a mocked method call.
    using var downloaded=await s3.GetObjectAsync(new GetObjectRequest{BucketName="bucket",Key="content/"+final.GetProperty("path").GetString()});
    var actualHash=Convert.ToHexString(await SHA256.HashDataAsync(downloaded.ResponseStream)).ToLowerInvariant();
    Assert.Equal(actualHash,final.GetProperty("sha256").GetString());
    Assert.NotEqual(Sha(oldBytes),final.GetProperty("sha256").GetString());
    Assert.Equal("B",await DbUtil.ExecuteScalarAsync(b,null,"select live_build_id from decks where id=$1",[id]));
  }

  [Fact]
  public async Task Successful_Build_Content_Cannot_Be_Rewritten()
  {
    await using var c=await db.OpenAsync();var slug="it-immutable-"+Guid.NewGuid().ToString("N");
    var id=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(c,null,"insert into decks(slug,title,author) values($1,'immutable','tests') returning id",[slug]));
    var job=Guid.NewGuid().ToString();
    await DbUtil.ExecuteAsync(c,null,"insert into deck_publishes(deck_id,deck_slug,build_id,job_id,s3_key,status,content_sha256) values($1,$2,'old',$3,'content/old','SUCCESS',$4)",[id,slug,job,Sha("original")]);
    var ex=await Assert.ThrowsAsync<Npgsql.PostgresException>(()=>DbUtil.ExecuteAsync(c,null,"update deck_publishes set content_sha256=$2 where job_id=$1",[job,Sha("tampered")]));
    Assert.Equal("PUBLISH_BUILD_IMMUTABLE",ex.MessageText);
    foreach(var sql in new[]{"update deck_publishes set status='FAILED' where job_id=$1","delete from deck_publishes where job_id=$1"})
      Assert.Equal("PUBLISH_BUILD_IMMUTABLE",(await Assert.ThrowsAsync<Npgsql.PostgresException>(()=>DbUtil.ExecuteAsync(c,null,sql,[job]))).MessageText);
    await DbUtil.ExecuteAsync(c,null,"update deck_publishes set error_message='delivery pending' where job_id=$1",[job]);
  }

  [Fact]
  public async Task Expired_Manifest_Lease_Cannot_Acknowledge_Another_Delivery()
  {
    await using var a=await db.OpenAsync();await using var b=await db.OpenAsync();
    var slug="it-lease-"+Guid.NewGuid().ToString("N");var job=Guid.NewGuid().ToString();
    var id=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(a,null,"insert into decks(slug,title,author) values($1,'lease','tests') returning id",[slug]));
    await DbUtil.ExecuteAsync(a,null,"insert into deck_publishes(deck_id,deck_slug,build_id,job_id,s3_key,status) values($1,$2,'A',$3,'content/A','SUCCESS')",[id,slug,job]);
    var paused=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var resume=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var late=PublishDelivery.DeliverManifest(a,job,async()=>{paused.SetResult();await resume.Task.WaitAsync(TimeSpan.FromSeconds(30));});
    try
    {
      await paused.Task.WaitAsync(TimeSpan.FromSeconds(30));
      await DbUtil.ExecuteAsync(b,null,"update publish_manifest_delivery set lease_until=now()-interval '1 second' where job_id=$1",[job]);
      Assert.True(await PublishDelivery.DeliverManifest(b,job,()=>throw new IOException("B failed")));
    }
    finally{resume.TrySetResult();}
    Assert.True(await late);
    var state=Assert.Single(await DbUtil.QueryAsync(b,null,"select state,attempts,last_error from publish_manifest_delivery where job_id=$1",[job]));
    Assert.Equal("pending",state["state"]);Assert.Equal(2,state["attempts"]);Assert.Equal("B failed",state["last_error"]);
  }
}
