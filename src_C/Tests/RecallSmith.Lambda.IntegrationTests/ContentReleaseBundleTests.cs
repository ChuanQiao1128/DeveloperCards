using System.Text.Json;
using Amazon.S3;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

public sealed class ContentReleaseBundleTests
{
  [Fact]
  public void UploadSigningRequestBindsThePrivateObjectAndRequiredHeaders()
  {
    var sha256 = new string('a', 64);
    var expires = DateTime.UtcNow.AddMinutes(10);
    var request = ContentReleaseBundle.CreateUploadRequest("test-bucket", sha256, 1_734_884, expires);

    Assert.Equal("test-bucket", request.BucketName);
    Assert.Equal($"release-input/aws-saa-fundamentals/{sha256}.json", request.Key);
    Assert.Equal(HttpVerb.PUT, request.Verb);
    Assert.Equal(Protocol.HTTPS, request.Protocol);
    Assert.Equal(expires, request.Expires);
    Assert.Equal(1_734_884, request.Headers.ContentLength);
    Assert.Equal("application/json", request.ContentType);
    Assert.Equal("*", request.Headers["If-None-Match"]);
    Assert.Equal("qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=", request.Headers["x-amz-checksum-sha256"]);
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
