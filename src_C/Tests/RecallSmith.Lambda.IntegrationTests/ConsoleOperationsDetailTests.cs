using System.Reflection;
using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Operations;
using RecallSmith.Lambda.Vpc.Runtime;
using static RecallSmith.Lambda.IntegrationTests.ConsoleOperationsCanaryTests;

namespace RecallSmith.Lambda.IntegrationTests;
[Collection(PostgresCollection.Name)]
public class ConsoleOperationsDetailTests(PostgresFixture db)
{
  private static readonly DateTimeOffset Now = new(2026,11,16,0,0,0,TimeSpan.Zero);
  private async Task<string> User()
  {var sub="ops-detail-"+Guid.NewGuid().ToString("N");await db.QueryAsync("insert into users(user_sub) values($1)",sub);return sub;}
  private Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> Get(string sub, Dictionary<string,string>? query=null) => ConsoleOperations.HandleLearner(Request(ConsoleOperations.LearnersPath+"/"+Uri.EscapeDataString(sub),query),new Res("detail-"+sub),Admin,Now);
  [Theory]
  [InlineData(true,1,"production",false,null,"premium","revenuecat",true,"active_rc")]
  [InlineData(false,1,"production",false,null,"premium","revenuecat",true,"active_rc")]
  [InlineData(true,-1,"production",false,null,"free","none",false,"inactive_or_absent_rc")]
  [InlineData(true,0,"production",false,null,"premium","revenuecat",true,"active_rc")]
  [InlineData(false,0,"production",false,null,"free","none",false,"inactive_or_absent_rc")]
  [InlineData(true,1,"sandbox",true,null,"premium","revenuecat",false,"sandbox_disallowed")]
  [InlineData(true,1,"sandbox",false,null,"premium","revenuecat",true,"active_rc")]
  [InlineData(false,-1,"production",false,"premium_all","premium","legacy",false,"inactive_or_absent_rc")]
  [InlineData(false,-1,"production",false,"deck:test","premium","legacy",false,"inactive_or_absent_rc")]
  public async Task Fixed_clock_raw_evidence_and_actual_projection_rules(bool raw,int expiry,string env,bool block,string? legacy,string tier,string source,bool eligible,string reason)
  {
    var sub=await User();
    await db.QueryAsync("insert into user_premium_state(app_user_id,premium_active,premium_env,expires_at_ms) values($1,$2,$3,$4)",sub,raw,env,expiry==0?null:Now.AddDays(expiry).ToUnixTimeMilliseconds());
    if(legacy!=null)await db.QueryAsync("insert into user_entitlements(user_sub,entitlement_key,tier,source) values($1,$2,'premium','manual')",sub,legacy);
    var prior=Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM");Environment.SetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM",block?"true":"false");
    try
    {
      var response=await Get(sub);Assert.Equal(200,response.StatusCode);var evidence=Data(response).GetProperty("entitlements");var e=evidence.GetProperty("effective");
      Assert.Equal(tier,e.GetProperty("entitlementsTier").GetString());Assert.Equal(source,e.GetProperty("entitlementsSource").GetString());Assert.Equal(eligible,e.GetProperty("premiumDownloadEligible").GetBoolean());Assert.Equal(reason,e.GetProperty("downloadReason").GetString());
      Assert.Equal(raw,evidence.GetProperty("revenueCat").GetProperty("premiumActiveRaw").GetBoolean());Assert.Equal(Now,evidence.GetProperty("evaluatedAt").GetDateTimeOffset());
      // Keep the console clock fixed; normalize only the comparison fixture to the existing handlers' live clock.
      if(expiry!=0)await db.QueryAsync("update user_premium_state set expires_at_ms=$2 where app_user_id=$1",sub,DateTimeOffset.UtcNow.AddDays(expiry).ToUnixTimeMilliseconds());
      var actual=await Entitlements.HandleEntitlements(Request(),new Res("actual"),Admin with {UserSub=sub});
      Assert.Equal(tier,Data(actual).GetProperty("tier").GetString());
      // Invoke the existing download's DB predicate without touching S3 or bypass configuration.
      var method=typeof(PremiumDeckUrl).GetMethod("IsPremiumFromDb",BindingFlags.NonPublic|BindingFlags.Static)!;
      var task=(Task)method.Invoke(null,[sub])!;await task;
      var premiumInfo=task.GetType().GetProperty("Result")!.GetValue(task)!;
      var actualActive=(bool)premiumInfo.GetType().GetProperty("Premium")!.GetValue(premiumInfo)!;
      Assert.Equal(eligible,actualActive && !(block && env=="sandbox"));
    }
    finally {Environment.SetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM",prior);}
  }
  [Fact] public async Task Missing_rc_legacy_beyond_display_cap_still_proves_premium()
  {
    var sub=await User();
    await db.QueryAsync("insert into user_entitlements(user_sub,entitlement_key,tier,source) select $1,'a'||n,'free','manual' from generate_series(1,101)n",sub);
    await db.QueryAsync("insert into user_entitlements(user_sub,entitlement_key,tier,source) values($1,'premium_all','premium','manual')",sub);
    var e=Data(await Get(sub)).GetProperty("entitlements");Assert.Equal("absent",e.GetProperty("revenueCat").GetProperty("state").GetString());
    Assert.True(e.GetProperty("legacy").GetProperty("truncated").GetBoolean());Assert.Equal(100,e.GetProperty("legacy").GetProperty("items").GetArrayLength());
    Assert.Equal("premium",e.GetProperty("effective").GetProperty("entitlementsTier").GetString());Assert.False(e.GetProperty("effective").GetProperty("premiumDownloadEligible").GetBoolean());
  }
  [Fact] public async Task Unique_late_received_events_separate_projection_and_union_paging_then_delete()
  {
    var sub=await User();var eventId=Guid.NewGuid();
    await db.QueryAsync("insert into user_progress(user_sub,deck_slug,stable_uid,review_count) values($1,'a','card',7)",sub);
    await db.QueryAsync("insert into user_progress_events(event_id,user_sub,deck_slug,stable_uid,event_time,server_received_at) values($1,$2,'z','card',$3,$4) on conflict do nothing",eventId,sub,Now.AddDays(-5).UtcDateTime,Now.UtcDateTime);
    await db.QueryAsync("insert into user_progress_events(event_id,user_sub,deck_slug,stable_uid,event_time) values($1,$2,'z','card',$3) on conflict do nothing",eventId,sub,Now.AddDays(-5).UtcDateTime);
    await db.QueryAsync("insert into user_progress_events(event_id,user_sub,deck_slug,stable_uid,event_time,server_received_at) values($1,$2,'z','card',$3,$4)",Guid.NewGuid(),sub,Now.AddDays(-10).UtcDateTime,Now.AddMinutes(1).UtcDateTime);
    var q=new Dictionary<string,string>{{"deckLimit","1"}};var first=Data(await Get(sub,q));var p=first.GetProperty("progress");
    Assert.Equal(2,p.GetProperty("uniqueReceivedEventCount").GetInt32());Assert.Equal(7,p.GetProperty("projectedReviewCount").GetInt32());Assert.Equal(1,p.GetProperty("projectedCardCount").GetInt32());
    Assert.Equal(Now.AddDays(-5),p.GetProperty("latestEventAt").GetDateTimeOffset());Assert.Equal(Now.AddMinutes(1),p.GetProperty("latestReceivedAt").GetDateTimeOffset());
    Assert.Equal("a",p.GetProperty("decks")[0].GetProperty("deckSlug").GetString());
    q["deckCursor"]=p.GetProperty("nextDeckCursor").GetString()!;var second=Data(await Get(sub,q)).GetProperty("progress");Assert.Equal("z",second.GetProperty("decks")[0].GetProperty("deckSlug").GetString());Assert.Equal(2,second.GetProperty("decks")[0].GetProperty("uniqueReceivedEventCount").GetInt32());
    Assert.Equal("unknown",first.GetProperty("device").GetProperty("queueState").GetString());Assert.Equal(JsonValueKind.Null,first.GetProperty("device").GetProperty("pendingEventCount").ValueKind);
    await db.QueryAsync("delete from users where user_sub=$1",sub);Assert.Equal(404,(await Get(sub)).StatusCode);
  }
  [Theory][InlineData("query","\tterm")][InlineData("limit","0")][InlineData("limit","101")][InlineData("cursor","bad==")][InlineData("cursor","e30")]
  public async Task Bad_list_inputs_have_private_400(string key,string value)
  {var r=await ConsoleOperations.HandleLearners(Request(query:new(){{key,value}}),new Res("bad"),Admin);Assert.Equal(400,r.StatusCode);Assert.Equal("private, no-store",r.Headers["Cache-Control"]);}
  [Theory][InlineData("a%2Fb")][InlineData("a/b")][InlineData("%00")][InlineData("%zz")]
  public async Task Bad_sub_has_private_400(string sub)
  {var r=await ConsoleOperations.HandleLearner(Request(ConsoleOperations.LearnersPath+"/"+sub),new Res("bad"),Admin);Assert.Equal(400,r.StatusCode);}
  [Fact] public async Task Optional_source_failures_are_isolated_and_required_audit_fails_closed()
  {
    var old=Environment.GetEnvironmentVariable("PGDATABASE");var scratch="ops_failure_"+Guid.NewGuid().ToString("N");await db.CreateScratchDatabaseAsync(scratch);
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE",scratch);Pg.Reset();
      await using(var conn=await Pg.OpenConnectionOrNullAsync())
      {
        await DbUtil.ExecuteAsync(conn!,null,"create table users(user_sub text primary key,email text,created_at timestamptz default now(),last_seen_at timestamptz,last_platform text,last_version text);insert into users(user_sub) values('observed');create table admin_audit(actor_sub text,actor_username text,action text,target text,before_state jsonb,after_state jsonb,trace_id text)",[]);
      }
      var r=await Get("observed");Assert.Equal(200,r.StatusCode);var data=Data(r);Assert.Equal("unknown",data.GetProperty("entitlements").GetProperty("state").GetString());Assert.Equal("unknown",data.GetProperty("progress").GetProperty("state").GetString());Assert.Equal("unknown",data.GetProperty("entitlements").GetProperty("effective").GetProperty("entitlementsTier").GetString());
      await using(var conn=await Pg.OpenConnectionOrNullAsync())await DbUtil.ExecuteAsync(conn!,null,"create table user_entitlements(user_sub text,entitlement_key text,tier text,source text,expires_at timestamptz,updated_at timestamptz default now());insert into user_entitlements(user_sub,entitlement_key,tier,source) values('observed','premium_all','premium','manual')",[]);
      var partial=Data(await Get("observed")).GetProperty("entitlements");Assert.Equal("partial",partial.GetProperty("state").GetString());Assert.Equal("premium",partial.GetProperty("effective").GetProperty("entitlementsTier").GetString());Assert.Equal("unknown",partial.GetProperty("effective").GetProperty("entitlementsSource").GetString());Assert.Equal(JsonValueKind.Null,partial.GetProperty("effective").GetProperty("premiumDownloadEligible").ValueKind);
      var overview=await ConsoleOperations.HandleOverview(Request(ConsoleOperations.OverviewPath),new Res("optional"),Admin);Assert.Equal(200,overview.StatusCode);Assert.Equal("unknown",Data(overview).GetProperty("publishing").GetProperty("state").GetString());
      await using(var conn=await Pg.OpenConnectionOrNullAsync())await DbUtil.ExecuteAsync(conn!,null,"drop table admin_audit",[]);
      foreach(var response in new[]{await Get("observed"),await ConsoleOperations.HandleLearners(Request(),new Res("audit-fail"),Admin),await ConsoleOperations.HandleOverview(Request(ConsoleOperations.OverviewPath),new Res("audit-fail"),Admin)})
      {Assert.Equal(503,response.StatusCode);Assert.Equal(JsonValueKind.Null,JsonDocument.Parse(response.Body).RootElement.GetProperty("data").ValueKind);Assert.Equal("private, no-store",response.Headers["Cache-Control"]);}
    }
    finally {Environment.SetEnvironmentVariable("PGDATABASE",old);Pg.Reset();}
  }
}
