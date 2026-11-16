using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Operations;
namespace RecallSmith.Lambda.IntegrationTests;
[Collection(PostgresCollection.Name)]
public class ConsoleOperationsAuthTests(PostgresFixture db)
{
  [Fact] public async Task Actual_signed_JWT_console_binding_agent_denial_and_statuses_on_all_dispatches()
  {
    using var key=TestJwt.NewKey();const string kid="ops-kid";const string spa="ops-spa";const string agent="ops-agent";
    Auth.Configure(AuthOptions.Parse(null,null,"production",null,spa+","+agent,agent),new StubJwks(TestJwt.Jwks((kid,key))));
    var prior=Environment.GetEnvironmentVariable("WARMUP_DISABLED");Environment.SetEnvironmentVariable("WARMUP_DISABLED","1");
    var dbName=Environment.GetEnvironmentVariable("PGDATABASE");
    var actor="ops-jwt-"+Guid.NewGuid().ToString("N");await db.QueryAsync("insert into users(user_sub) values($1)",actor);
    var originalOut=Console.Out;using var captured=new StringWriter();Console.SetOut(captured);
    try
    {
      foreach(var (issuer,client,groups,bad,expected) in new[]{(TestJwt.ConsoleIssuer,spa,new[]{"super_admin"},false,200),(TestJwt.ConsoleIssuer,spa,new[]{"editor"},false,403),(TestJwt.MobileIssuer,spa,new[]{"super_admin"},false,403),(TestJwt.ConsoleIssuer,"other-client",new[]{"super_admin"},false,403),(TestJwt.ConsoleIssuer,agent,new[]{"super_admin"},false,403),(TestJwt.ConsoleIssuer,spa,new[]{"super_admin"},true,401),(TestJwt.ConsoleIssuer,spa,Array.Empty<string>(),false,403)})
      {
        var payload=TestJwt.Payload(issuer:issuer,sub:actor,groups:groups);payload["client_id"]=client;payload["username"]="must-never-log-admin";
        var token=bad?TestJwt.Unsigned(kid,payload):TestJwt.Sign(key,kid,payload);
        // An unavailable DB makes accidental source access turn an expected auth error into a failure.
        Environment.SetEnvironmentVariable("PGDATABASE",expected==200?dbName:"ops_unreachable_database");Pg.Reset();
        foreach(var path in new[]{ConsoleOperations.OverviewPath,ConsoleOperations.LearnersPath,ConsoleOperations.LearnersPath+"/"+actor})
        {
          var evt=JsonSerializer.SerializeToElement(new {rawPath=path,requestContext=new {http=new {method="GET"}},headers=new Dictionary<string,string>{{"authorization","Bearer "+token}},queryStringParameters=new Dictionary<string,string>()});
          var response=await new VpcFunction().Handler(evt);Assert.True(response.StatusCode==expected,$"{path}: expected {expected}, got {response.StatusCode}: {response.Body}");Assert.Equal("private, no-store",response.Headers["Cache-Control"]);
          if(expected!=200)Assert.Equal(expected==401?"UNAUTHORIZED":"FORBIDDEN",JsonDocument.Parse(response.Body).RootElement.GetProperty("error").GetProperty("code").GetString());
        }
      }
      var missing=JsonSerializer.SerializeToElement(new {rawPath=ConsoleOperations.LearnersPath,requestContext=new {http=new {method="GET"}}});Assert.Equal(403,(await new VpcFunction().Handler(missing)).StatusCode);
      foreach(var path in new[]{ConsoleOperations.LearnersPath+"/sentinel-private-email@example.test",ConsoleOperations.LearnersPath+"/sentinel-private-email%00"})
      {
        var payload=TestJwt.Payload(sub:actor,groups:["super_admin"]);payload["client_id"]=spa;
        var evt=JsonSerializer.SerializeToElement(new {rawPath=path,requestContext=new{http=new{method="GET"}},headers=new Dictionary<string,string>{{"authorization","Bearer "+TestJwt.Unsigned(kid,payload)}},queryStringParameters=new Dictionary<string,string>{{"query","private-search-sentinel"},{"cursor","private-cursor-sentinel"}}});
        Assert.Equal(401,(await new VpcFunction().Handler(evt)).StatusCode);
      }
      Assert.DoesNotContain(actor,captured.ToString());Assert.DoesNotContain("must-never-log-admin",captured.ToString());Assert.DoesNotContain("sentinel-private-email",captured.ToString());Assert.DoesNotContain("private-search-sentinel",captured.ToString());Assert.DoesNotContain("private-cursor-sentinel",captured.ToString());
      Assert.Contains("/api/v1/admin/learners/:sub",captured.ToString());
      Assert.Equal("/api/v1/admin/learners/:sub",RouteMetrics.RouteFor(ConsoleOperations.LearnersPath+"/private-sub"));
    }
    finally {Console.SetOut(originalOut);Environment.SetEnvironmentVariable("WARMUP_DISABLED",prior);Environment.SetEnvironmentVariable("PGDATABASE",dbName);Pg.Reset();Auth.ResetToEnvironment();}
  }
}
