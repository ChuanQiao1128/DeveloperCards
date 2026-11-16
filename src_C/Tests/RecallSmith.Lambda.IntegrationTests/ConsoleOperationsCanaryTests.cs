using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Operations;
namespace RecallSmith.Lambda.IntegrationTests;
[Collection(PostgresCollection.Name)]
public class ConsoleOperationsCanaryTests(PostgresFixture db, Xunit.Abstractions.ITestOutputHelper output)
{
  internal static AuthContext Admin => new(new Dictionary<string,JsonElement>(),"console-ops-admin","private-admin-name",["super_admin"],true,false,true);
  internal static LambdaRequest Request(string path = ConsoleOperations.LearnersPath, Dictionary<string,string>? query = null) => new(JsonSerializer.SerializeToElement(new {rawPath=path,requestContext=new {http=new {method="GET"}},queryStringParameters=query ?? [],headers=new Dictionary<string,string>()}));
  internal static JsonElement Data(Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse r) => JsonDocument.Parse(r.Body).RootElement.GetProperty("data").Clone();
  [Fact] public async Task Auth_rejects_before_any_database_read_and_preserves_codes()
  {
    foreach(var (auth,status) in new[]{(Admin with {RejectReason="bad"},401),(Admin with {UserSub=null},403),(Admin with {IsSuperAdmin=false},403),(Admin with {AdminDenyReason="admin_issuer"},403),(Admin with {IsAgentClient=true},403)})
    {
      var r=await ConsoleOperations.HandleLearners(Request(),new Res("auth"),auth);
      Assert.Equal(status,r.StatusCode);Assert.Equal("private, no-store",r.Headers["Cache-Control"]);
    }
  }
  [Fact] public async Task Stable_paging_literal_search_bound_cursor_and_audit()
  {
    var prefix="ops-canary-"+Guid.NewGuid().ToString("N");
    foreach(var suffix in new[]{"a","b","c"}) await db.QueryAsync("insert into users(user_sub,email) values($1,$2)",prefix+suffix,suffix=="b"?null:prefix+"%_");
    var q=new Dictionary<string,string>{{"query",prefix},{"limit","2"}};
    var first=await ConsoleOperations.HandleLearners(Request(query:q),new Res("first"),Admin);Assert.Equal(200,first.StatusCode);
    var page=Data(first);Assert.Equal(2,page.GetProperty("items").GetArrayLength());Assert.Equal(JsonValueKind.Null,page.GetProperty("items")[1].GetProperty("email").ValueKind);
    await db.QueryAsync("insert into users(user_sub) values($1)",prefix+"z");
    q["cursor"]=page.GetProperty("nextCursor").GetString()!;
    var second=await ConsoleOperations.HandleLearners(Request(query:q),new Res("second"),Admin);Assert.Equal(200,second.StatusCode);
    Assert.Single(Data(second).GetProperty("items").EnumerateArray());Assert.Equal(prefix+"c",Data(second).GetProperty("items")[0].GetProperty("sub").GetString());
    q["query"]="different";Assert.Equal(400,(await ConsoleOperations.HandleLearners(Request(query:q),new Res("mismatch"),Admin)).StatusCode);
    var literal=await ConsoleOperations.HandleLearners(Request(query:new(){{"query",prefix+"%_"}}),new Res("literal"),Admin);
    Assert.Equal(2,Data(literal).GetProperty("items").GetArrayLength());
    var audits=await db.QueryAsync("select actor_username,before_state,after_state,target from admin_audit where trace_id='literal'");Assert.Single(audits);Assert.Null(audits[0]["actor_username"]);Assert.Null(audits[0]["before_state"]);Assert.Equal("learners",audits[0]["target"]);
    var plan=await db.QueryAsync("explain select user_sub from users where user_sub COLLATE \"C\" > $1 COLLATE \"C\" order by user_sub COLLATE \"C\" limit 26",prefix);Assert.NotEmpty(plan);foreach(var row in plan)output.WriteLine(Convert.ToString(row["QUERY PLAN"]));
  }
}
