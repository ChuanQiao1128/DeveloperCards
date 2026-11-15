using System.Net;
using System.Reflection;
using System.Text;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class ImmutablePublishUploadTests
{
  private sealed class ObjectStore(string existing):AmazonS3Client(new AnonymousAWSCredentials(),new AmazonS3Config{RegionEndpoint=RegionEndpoint.APSoutheast2})
  {
    public string Body=existing;
    public int Gets;
    public override async Task<PutObjectResponse> PutObjectAsync(PutObjectRequest req,CancellationToken ct=default)
    {
      if(req.IfNoneMatch=="*")throw new AmazonS3Exception("exists"){StatusCode=HttpStatusCode.PreconditionFailed};
      using var reader=new StreamReader(req.InputStream,Encoding.UTF8,leaveOpen:true);Body=await reader.ReadToEndAsync(ct);
      return new PutObjectResponse();
    }
    public override Task<GetObjectResponse> GetObjectAsync(GetObjectRequest req,CancellationToken ct=default)
    {Gets++;return Task.FromResult(new GetObjectResponse{ContentLength=Encoding.UTF8.GetByteCount(Body),ResponseStream=new MemoryStream(Encoding.UTF8.GetBytes(Body))});}
  }

  [Theory]
  [InlineData(true)]
  [InlineData(false)]
  public async Task Existing_Build_Can_Only_Be_Reused_With_Identical_Downloaded_Bytes(bool same)
  {
    const string saved="{\"cards\":[\"saved\"]}";var incoming=same?saved:"{\"cards\":[\"other\"]}";
    var env=Environment.GetEnvironmentVariable("CONTENT_BUCKET");Environment.SetEnvironmentVariable("CONTENT_BUCKET","local-p4");
    var field=typeof(S3DeckUploader).GetField("_s3",BindingFlags.Static|BindingFlags.NonPublic)!;
    var previous=field.GetValue(null);using var store=new ObjectStore(saved);field.SetValue(null,store);
    try
    {
      var uploader=new S3DeckUploader();
      if(same)await uploader.UploadJsonAsync("content/decks/test/builds/b/deck.json",incoming,S3DeckUploader.ImmutableCacheControl);
      else await Assert.ThrowsAsync<InvalidOperationException>(()=>uploader.UploadJsonAsync("content/decks/test/builds/b/deck.json",incoming,S3DeckUploader.ImmutableCacheControl));
      Assert.Equal(saved,store.Body);Assert.Equal(1,store.Gets);
    }
    finally{field.SetValue(null,previous);Environment.SetEnvironmentVariable("CONTENT_BUCKET",env);}
  }
}
