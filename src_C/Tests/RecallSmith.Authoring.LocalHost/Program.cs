using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using RecallSmith.Lambda;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.IntegrationTests;

// Test-only loopback host: real dispatcher and PostgreSQL, fixed synthetic identities.
// This never validates Cognito or API Gateway's JWT verification.
Environment.SetEnvironmentVariable("API_ENV", "local-test");
Environment.SetEnvironmentVariable("AUTOMATION_MODE", "off");
Environment.SetEnvironmentVariable("AI_QA_ENABLED", "0");
var db = new PostgresFixture();
await db.InitializeAsync();
var function = new VpcFunction();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:5187");
var app = builder.Build();
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../"));
var dist = new PhysicalFileProvider(Path.Combine(root, "frontend/dist"));
var identities = new Dictionary<string, (string Sub, string[] Groups)>();
foreach (var who in new[] { "owner", "reader", "outsider" })
{
  var claims = new Dictionary<string, object> { ["sub"] = "local-" + who, ["cognito:groups"] = new[] { "editor" } };
  string Segment(object o) => Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
  var token = Segment(new { alg = "none" }) + "." + Segment(claims) + ".local-test-only";
  identities.Add(token, ("local-" + who, ["editor"]));
}
var dropNext = 0;
var editAfterCommit = 0;

JsonElement Event(string method, string path, string query, string? body, string? token)
{
  var known = token is not null && identities.TryGetValue(token, out _);
  var identity = known ? identities[token!] : (Sub: "", Groups: Array.Empty<string>());
  return JsonSerializer.SerializeToElement(new {
    rawPath = path,
    requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method },
      authorizer = new { jwt = new { claims = known ? new Dictionary<string, object> {
        ["sub"] = identity.Sub, ["cognito:groups"] = identity.Groups,
      } : new Dictionary<string, object>() } } },
    headers = new Dictionary<string, string>(),
    queryStringParameters = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(query).ToDictionary(p => p.Key, p => p.Value.ToString()),
    body, isBase64Encoded = false,
  });
}

// Controls exist only in this non-shipping executable and operate on its disposable DB.
app.MapGet("/__test/ready", () => Results.Ok(new { ready = true }));
app.MapPost("/__test/seed", async () => {
  var rows = await db.QueryAsync("insert into decks(slug,title,author) values($1,$2,$3) returning id", "local-" + Guid.NewGuid().ToString("N"), "Local authoring verification", "Synthetic test");
  var deckId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  foreach (var who in new[] { "owner", "reader" })
    await db.QueryAsync("insert into admin_deck_permissions(admin_sub,deck_id,can_read,can_write) values($1,$2,1,$3) returning id", "local-" + who, deckId, who == "owner" ? 1 : 0);
  var cards = await db.QueryAsync("insert into cards(deck_id,stable_uid,question,explanation,difficulty,order_in_deck) values($1,'local-card','Original question','Original answer',2,5) returning id", deckId);
  return Results.Ok(new { deckId, cardId = Convert.ToInt64(cards[0]["id"]), tokens = identities.ToDictionary(p => p.Value.Sub[6..], p => p.Key) });
});
app.MapGet("/__test/state/{deckId:long}", async (long deckId) => Results.Ok(new {
  cards = await db.QueryAsync("select id,stable_uid,question,explanation,version,order_in_deck from cards where deck_id=$1 and is_deleted=0 order by id", deckId),
  receipts = await db.QueryAsync("select action_id,kind from content_release_actions where deck_id=$1", deckId),
}));
app.MapPost("/__test/drop-next-import", (HttpRequest request) => {
  Interlocked.Exchange(ref editAfterCommit, request.Query.ContainsKey("edit") ? 1 : 0);
  Interlocked.Exchange(ref dropNext, 1);
  return Results.Ok();
});
app.Map("/api/{**path}", async (HttpContext context) => {
  var token = context.Request.Headers.Authorization.ToString().Replace("Bearer ", "", StringComparison.Ordinal);
  var body = await new StreamReader(context.Request.Body).ReadToEndAsync();
  var response = await function.Handler(Event(context.Request.Method, context.Request.Path, context.Request.QueryString.Value ?? "", string.IsNullOrEmpty(body) ? null : body, token));
  if (context.Request.Path.Value!.EndsWith("/cards/import", StringComparison.Ordinal) && response.StatusCode == 200 && Interlocked.Exchange(ref dropNext, 0) == 1)
  {
    if (Interlocked.Exchange(ref editAfterCommit, 0) == 1)
    {
      using var input = JsonDocument.Parse(body);
      var did = input.RootElement.GetProperty("deckId").GetInt64();
      var card = (await db.QueryAsync("select id,version from cards where deck_id=$1 order by id limit 1", did))[0];
      var edit = JsonSerializer.Serialize(new { id = Convert.ToInt64(card["id"]), expectedVersion = Convert.ToInt64(card["version"]), question = "Edit after import commit" });
      var edited = await function.Handler(Event("PUT", "/api/v1/authoring/cards", "", edit, token));
      if (edited.StatusCode != 200) throw new InvalidOperationException("Fault setup edit failed");
    }
    context.Abort();
    return;
  }
  context.Response.StatusCode = response.StatusCode;
  context.Response.ContentType = "application/json";
  await context.Response.WriteAsync(response.Body ?? "");
});
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = dist });
app.UseStaticFiles(new StaticFileOptions { FileProvider = dist });
app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = dist });
try { await app.RunAsync(); }
finally { await db.DisposeAsync(); }
