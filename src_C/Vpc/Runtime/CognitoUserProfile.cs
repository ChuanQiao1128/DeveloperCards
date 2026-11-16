using System.Net.Mail;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Runtime;

internal static class CognitoUserProfile
{
  private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(2) };

  internal static async Task<string?> ReadEmail(LambdaRequest req, AuthContext auth, HttpClient? client = null)
  {
    var configured = Environment.GetEnvironmentVariable("COGNITO_MOBILE_ISSUER")?.TrimEnd('/');
    if (string.IsNullOrEmpty(configured) || Claim(auth, "iss")?.TrimEnd('/') != configured || Claim(auth, "token_use") != "access"
      || !(Claim(auth, "scope") ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains("aws.cognito.signin.user.admin")) return null;
    if (!Uri.TryCreate(configured, UriKind.Absolute, out var issuer) || issuer.Scheme != "https" || issuer.Port != 443 || issuer.UserInfo.Length > 0
      || issuer.Query.Length > 0 || issuer.Fragment.Length > 0 || !Regex.IsMatch(issuer.Host, @"^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$")) return null;
    var authorization = req.Headers.GetValueOrDefault("authorization", "");
    if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
    var token = authorization[7..].Trim();
    if (token.Length is 0 or > 16384) return null;

    try
    {
      using var deadline = CancellationTokenSource.CreateLinkedTokenSource(RequestBudget.Token);
      deadline.CancelAfter(TimeSpan.FromSeconds(2));
      using var request = new HttpRequestMessage(HttpMethod.Post, issuer.GetLeftPart(UriPartial.Authority));
      request.Headers.Add("X-Amz-Target", "AWSCognitoIdentityProviderService.GetUser");
      request.Content = new StringContent(JsonSerializer.Serialize(new { AccessToken = token }), Encoding.UTF8, "application/x-amz-json-1.1");
      using var response = await (client ?? Client).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
      if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > 32768) return null;
      await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
      using var bytes = new MemoryStream();
      var buffer = new byte[4096];
      int read;
      while ((read = await stream.ReadAsync(buffer, deadline.Token)) > 0)
      {
        if (bytes.Length + read > 32768) return null;
        bytes.Write(buffer, 0, read);
      }
      using var doc = JsonDocument.Parse(bytes.ToArray());
      var attributes = doc.RootElement.GetProperty("UserAttributes").EnumerateArray().ToArray();
      string? Value(string name)
      {
        foreach (var attribute in attributes)
          if (attribute.GetProperty("Name").GetString() == name) return attribute.GetProperty("Value").GetString();
        return null;
      }
      if (Value("sub") != auth.UserSub) return null;
      var email = Value("email");
      return email is { Length: > 0 and <= 320 } && !email.Any(char.IsControl) && MailAddress.TryCreate(email, out var parsed) && parsed.Address == email ? email : null;
    }
    catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException or ArgumentException)
    {
      // Profile enrichment must not block learning or expose the token/provider response.
      return null;
    }
  }

  private static string? Claim(AuthContext auth, string key) => auth.Claims.TryGetValue(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
