using System.Net;
using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Runtime;
using static RecallSmith.Lambda.IntegrationTests.ConsoleOperationsCanaryTests;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class BootstrapProfileTests(PostgresFixture db)
{
  private const string Issuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_fixture";

  private sealed class Provider(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
  {
    public int Calls;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { Calls++; return respond(request, token); }
  }

  private sealed class FailingBody : MemoryStream
  {
    public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => throw new IOException("private provider stream failure");
  }

  [Theory]
  [InlineData("matched")]
  [InlineData("wrong-sub")]
  [InlineData("unavailable")]
  [InlineData("malformed")]
  [InlineData("oversize")]
  [InlineData("stream-failure")]
  public async Task Bootstrap_only_stores_identity_email_for_the_verified_subject(string mode)
  {
    var sub = "profile-" + Guid.NewGuid().ToString("N");
    var auth = Admin with { UserSub = sub, Claims = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(new { iss = Issuer, token_use = "access", scope = "aws.cognito.signin.user.admin" }))! };
    var request = new LambdaRequest(JsonSerializer.SerializeToElement(new { rawPath = "/api/v1/user/bootstrap", requestContext = new { http = new { method = "POST" } }, headers = new { authorization = "Bearer fixture-access-token" }, body = JsonSerializer.Serialize(new { email = "untrusted@example.invalid", clientPlatform = "iOS", clientVersion = "2.1.0", deviceId = "test-device" }) }));
    var previous = Environment.GetEnvironmentVariable("COGNITO_MOBILE_ISSUER");
    Environment.SetEnvironmentVariable("COGNITO_MOBILE_ISSUER", Issuer);
    using var handler = new Provider(async (outbound, token) =>
    {
      Assert.Equal("https://cognito-idp.ap-southeast-2.amazonaws.com/", outbound.RequestUri!.ToString());
      Assert.Equal("AWSCognitoIdentityProviderService.GetUser", Assert.Single(outbound.Headers.GetValues("X-Amz-Target")));
      Assert.Equal("application/x-amz-json-1.1", outbound.Content!.Headers.ContentType!.MediaType);
      using var payload = JsonDocument.Parse(await outbound.Content.ReadAsStringAsync(token));
      Assert.Equal("fixture-access-token", payload.RootElement.GetProperty("AccessToken").GetString());
      Assert.Null(outbound.Headers.Authorization);
      var body = mode == "malformed" ? "{" : mode == "oversize" ? new string('x', 32769) : JsonSerializer.Serialize(new { UserAttributes = new[] { new { Name = "sub", Value = mode == "wrong-sub" ? "different-user" : sub }, new { Name = "email", Value = "trusted@example.invalid" } } });
      return new HttpResponseMessage(mode == "unavailable" ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK) { Content = mode == "stream-failure" ? new StreamContent(new FailingBody()) : new StringContent(body) };
    });
    using var client = new HttpClient(handler);
    try
    {
      var response = await Bootstrap.HandleBootstrap(request, new Res("profile"), auth, client);
      Assert.Equal(200, response.StatusCode);
      Assert.Equal(1, handler.Calls);
      var row = Assert.Single(await db.QueryAsync("select email,last_platform,last_version,last_device_id from users where user_sub=$1", sub));
      Assert.Equal(mode == "matched" ? "trusted@example.invalid" : null, row["email"]);
      Assert.Equal("iOS", row["last_platform"]);
      Assert.Equal("2.1.0", row["last_version"]);
      Assert.Equal("test-device", row["last_device_id"]);
      Assert.DoesNotContain("fixture-access-token", response.Body);
    }
    finally { Environment.SetEnvironmentVariable("COGNITO_MOBILE_ISSUER", previous); }
  }

  [Fact]
  public async Task Profile_lookup_never_sends_tokens_to_an_untrusted_issuer()
  {
    _ = db;
    var previous = Environment.GetEnvironmentVariable("COGNITO_MOBILE_ISSUER");
    Environment.SetEnvironmentVariable("COGNITO_MOBILE_ISSUER", "https://example.invalid/pool");
    using var handler = new Provider((_, _) => throw new Exception("Must not send a token"));
    using var client = new HttpClient(handler);
    try
    {
      var auth = Admin with { Claims = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>("{\"iss\":\"https://example.invalid/pool\",\"token_use\":\"access\",\"scope\":\"aws.cognito.signin.user.admin\"}")! };
      Assert.Null(await CognitoUserProfile.ReadEmail(Request().WithHeader("Authorization", "Bearer private-token"), auth, client));
      Assert.Equal(0, handler.Calls);
    }
    finally { Environment.SetEnvironmentVariable("COGNITO_MOBILE_ISSUER", previous); }
  }
}
