using System.Text.Json;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

public sealed class ContentReleaseBundleTests
{
  [Fact]
  public async Task UploadSignatureBindsThePrivateObjectAndRequiredHeaders()
  {
    var sha256 = new string('a', 64);
    using var s3 = new AmazonS3Client(new BasicAWSCredentials("test-key", "test-secret"), RegionEndpoint.APSoutheast2);
    var request = ContentReleaseBundle.CreateUploadRequest("test-bucket", sha256, 1_734_884, DateTime.UtcNow.AddMinutes(10));
    var url = new Uri(await s3.GetPreSignedURLAsync(request));

    Assert.Equal("https", url.Scheme);
    Assert.Equal($"/release-input/aws-saa-fundamentals/{sha256}.json", url.AbsolutePath);
    var query = url.Query.TrimStart('?').Split('&').Select(part => part.Split('=', 2))
      .ToDictionary(part => part[0], part => Uri.UnescapeDataString(part[1]));
    var signedHeaders = query["X-Amz-SignedHeaders"].Split(';');
    Assert.Contains("content-length", signedHeaders);
    Assert.Contains("content-type", signedHeaders);
    Assert.Contains("if-none-match", signedHeaders);
    Assert.Contains("x-amz-checksum-sha256", signedHeaders);
  }

  [Theory]
  [InlineData(null, false, 403)]
  [InlineData("editor", true, 403)]
  [InlineData("editor", false, 400)]
  public async Task AuthoringGateRejectsUnauthorizedOrInvalidRequests(string? user, bool isAgent, int status)
  {
    var auth = new AuthContext(new Dictionary<string, JsonElement>(), user, user, user is null ? [] : ["editor"],
      IsSuperAdmin: false, IsEditor: user is not null, IsAdmin: user is not null, IsAgentClient: isAgent);
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = ContentReleaseBundle.Route,
      requestContext = new { http = new { method = "GET" } },
      queryStringParameters = new { sha256 = "../content/manifest.json" }
    }));
    var response = await ContentReleaseBundle.Handle(req, new Res("test"), auth);
    Assert.Equal(status, response.StatusCode);
  }
}
