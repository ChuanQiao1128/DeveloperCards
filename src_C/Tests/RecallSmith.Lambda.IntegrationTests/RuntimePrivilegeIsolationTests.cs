using System.Text.Json;
using Amazon.Lambda.Core;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Db;
using RecallSmith.Lambda.Vpc.Runtime;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Repositories;
using Pg = RecallSmith.Lambda.Db.Pg;
using DbUtil = RecallSmith.Lambda.Db.DbUtil;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class RuntimePrivilegeIsolationTests(PostgresFixture db)
{
  private static readonly AuthContext Admin = new(new Dictionary<string,JsonElement>(),"isolation-test","isolation-test",["super_admin"],true,false,true);
  private static LambdaRequest Request() => new(JsonSerializer.SerializeToElement(new { rawPath="/api/v1/admin/db/migrate",requestContext=new {http=new {method="POST"}},headers=new{},body="{}" }));
  private static readonly string[] EnvNames = ["PGDATABASE","PGUSER","PGPASSWORD","DB_ACCESS_MODE"];
  private static async Task Denied(NpgsqlConnection c,string sql)
  {
    var ex=await Assert.ThrowsAsync<PostgresException>(()=>DbUtil.ExecuteAsync(c,null,sql,[]));
    Assert.Equal(PostgresErrorCodes.InsufficientPrivilege,ex.SqlState);
  }
  private static void Configure(NpgsqlConnectionStringBuilder b,string? mode)
  {
    Environment.SetEnvironmentVariable("PGDATABASE",b.Database);Environment.SetEnvironmentVariable("PGUSER",b.Username);
    Environment.SetEnvironmentVariable("PGPASSWORD",b.Password);Environment.SetEnvironmentVariable("DB_ACCESS_MODE",mode);
    Pg.Reset();RecallSmith.Lambda.Vpc.Db.Pg.Reset();
  }

  [Fact]
  public async Task SeparateLogins_RunActualApiDeletionAndWorker_WithoutDdlOrEvidenceTampering()
  {
    var saved=EnvNames.ToDictionary(n=>n,Environment.GetEnvironmentVariable);
    var cs=await db.CreateScratchDatabaseAsync("isolation_"+Guid.NewGuid().ToString("N"));
    await using var owner=new NpgsqlConnection(cs);await owner.OpenAsync();
    try
    {
      await PostgresFixture.ApplyMigrationsAsync(owner,int.MaxValue);
      // Separate authenticated logins/passwords; no SET ROLE from an admin connection simulates runtime.
      await DbUtil.ExecuteAsync(owner,null,"""
        create role developercards_schema nologin nosuperuser nocreatedb nocreaterole;
        create role developercards_migrator login password 'local-maintenance-password' nosuperuser nocreatedb nocreaterole;
        create role developercards_app login password 'local-runtime-password' nosuperuser nocreatedb nocreaterole;
        """,[]);
      await DbUtil.ExecuteAsync(owner,null,await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Db","isolate-runtime.sql")),[]);
      var runtime=new NpgsqlConnectionStringBuilder(cs){Username="developercards_app",Password="local-runtime-password",Pooling=false};
      Configure(runtime,"isolated");
      await using var c=await Pg.OpenConnectionOrNullAsync();Assert.NotNull(c);
      Assert.Equal("developercards_app",await DbUtil.ExecuteScalarAsync(c!,null,"select session_user",[]));
      foreach(var sql in new[]{"create table public.runtime_ddl(id int)","create schema runtime_schema","alter table cards disable trigger all","drop function public.enforce_account_deletion_barrier() cascade","set role developercards_schema","set role developercards_migrator","truncate account_deletions","delete from account_deletions","update account_deletions set identity_status='pending_owner_confirmation'","delete from content_review_receipts","update content_review_revocations set reason='tampered'","delete from content_release_actions","delete from admin_audit","insert into schema_migrations(version,name) values(999,'fake')","set session_replication_role=replica"})
        await Denied(c!,sql);
      var user="isolation-user";
      var req=new LambdaRequest(JsonSerializer.SerializeToElement(new{rawPath="/api/v1/user/bootstrap",requestContext=new{http=new{method="POST"}},body="{}",headers=new{}}));
      var auth=new AuthContext(new Dictionary<string,JsonElement>(),user,user,[],false,false,false);
      Assert.Equal(200,(await Bootstrap.HandleBootstrap(req,new Res("isolation"),auth)).StatusCode);
      await LambdaHost.PostProgressEventsAsync(user,new{events=new[]{new{eventId=Guid.NewGuid(),deckSlug="isolation",stableUid="card",rating=3,eventTimeMs=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}}});
      await AccountDeletion.DeleteUserDataAsync(c!,user);
      Assert.Equal(409,(await Bootstrap.HandleBootstrap(req,new Res("isolation"),auth)).StatusCode);
      Assert.Equal(1L,await DbUtil.ExecuteScalarAsync(c!,null,"select count(*) from account_deletions where sub=$1",[user]));
      await Assert.ThrowsAsync<PostgresException>(()=>DbUtil.ExecuteAsync(c!,null,"insert into users(user_sub) values($1)",[user]));
      var id=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(c!,null,"insert into decks(slug,title,author) values('isolation','Isolation','tests') returning id",[]));
      // API-side publish DML including 053 snapshot/dispatch, followed by real Worker claim/completion.
      await DbUtil.ExecuteAsync(c!,null,"""
        insert into deck_publishes(job_id,build_id,s3_key,deck_id,deck_slug,status,publish_editing_snapshot)
        values('isolated-job','isolated-build','content/test',$1,'isolation','PENDING',content_editing_snapshot($1));
        insert into publish_dispatch(job_id,deck_id) values('isolated-job',$1);
        """,[id]);
      var jobs=new JobRepository();Assert.True(await jobs.TryAcquireJobAsync("isolated-job"));
      await jobs.CompleteJobAsync("isolated-job",0);
      Assert.Equal("SUCCESS",await DbUtil.ExecuteScalarAsync(c!,null,"select status from deck_publishes where job_id='isolated-job'",[]));
      Assert.Equal(1L,await DbUtil.ExecuteScalarAsync(c!,null,"select count(*) from publish_manifest_delivery where job_id='isolated-job'",[]));
      var frozen=await Assert.ThrowsAsync<PostgresException>(()=>DbUtil.ExecuteAsync(c!,null,"update deck_publishes set publish_editing_snapshot='tamper' where job_id='isolated-job'",[]));
      Assert.Contains("PUBLISH_SNAPSHOT_IMMUTABLE",frozen.MessageText);
      await ControlledPublish(c!);
      Assert.Equal(404,(await Migrate.HandleDbMigrate(Request(),new Res("isolation"),Admin)).StatusCode);
      Assert.Equal(404,(await AppRole.HandleBootstrapRoles(Request(),new Res("isolation"),Admin)).StatusCode);
      Assert.Equal(200,(await Migrate.HandleDbMigrationsList(Request(),new Res("isolation"),Admin)).StatusCode);

      var maintenance=new NpgsqlConnectionStringBuilder(cs){Username="developercards_migrator",Password="local-maintenance-password",Pooling=false};
      Configure(maintenance,"maintenance");
      await using(var m=new NpgsqlConnection(maintenance.ConnectionString))
      {await m.OpenAsync();await DbUtil.ExecuteAsync(m,null,"set role developercards_schema; create table public.maintenance_only(id int)",[]);}
      var handler=new MaintenanceFunction();
      await Assert.ThrowsAsync<InvalidOperationException>(()=>handler.Handler(JsonSerializer.SerializeToElement(new{Operation="plan"}),new Context("prod","17")));
      await Assert.ThrowsAsync<ArgumentException>(()=>handler.Handler(JsonSerializer.SerializeToElement(new{rawPath="/api/v1/admin/db/migrate"}),new Context("17","17")));
      // Empty frozen migration set exercises maintenance authentication and read path without re-running history.
      var dir=Path.Combine(Path.GetTempPath(),"isolation-migrations-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
      try
      {
        await File.WriteAllTextAsync(Path.Combine(dir,"999_isolation.sql"),"-- destructive: true\ncreate table isolated_confirmed(id int);");
        Migrate.MigrationsDirOverride.Value=dir;
        var plan=await handler.Handler(JsonSerializer.SerializeToElement(new{Operation="plan"}),new Context("17","17"));Assert.Equal(200,plan.StatusCode);
        var blocked=await handler.Handler(JsonSerializer.SerializeToElement(new{Operation="migrate"}),new Context("17","17"));Assert.Contains("blockedBy",blocked.Body);
        Assert.False((bool)(await DbUtil.ExecuteScalarAsync(owner,null,"select to_regclass('public.isolated_confirmed') is not null",[]))!);
        var applied=await handler.Handler(JsonSerializer.SerializeToElement(new{Operation="migrate",ConfirmDestructive="999"}),new Context("17","17"));Assert.Equal(200,applied.StatusCode);
        Assert.True((bool)(await DbUtil.ExecuteScalarAsync(owner,null,"select to_regclass('public.isolated_confirmed') is not null",[]))!);
      }
      finally{Migrate.MigrationsDirOverride.Value=null;Directory.Delete(dir,true);}
    }
    finally
    {
      foreach(var (name,value) in saved)Environment.SetEnvironmentVariable(name,value);
      Pg.Reset();RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await using var admin=await db.OpenAsync();
      await DbUtil.ExecuteAsync(admin,null,$"drop database {new NpgsqlConnectionStringBuilder(cs).Database} with(force)",[]);
      await DbUtil.ExecuteAsync(admin,null,"drop role if exists developercards_app,developercards_migrator,developercards_schema",[]);
    }
  }

  private static async Task ControlledPublish(NpgsqlConnection c)
  {
    var id=Convert.ToInt64(await DbUtil.ExecuteScalarAsync(c,null,"insert into decks(slug,title,author,translation_locales) values('aws-saa-fundamentals','AWS','test',array['zh-CN']) returning id",[]));
    LambdaRequest Req(string method,string path,object? body=null)=>new(JsonSerializer.SerializeToElement(new{rawPath=path,requestContext=new{http=new{method}},headers=new{},queryStringParameters=new{deckId=id.ToString()},body=body is null?null:JsonSerializer.Serialize(body)}));
    JsonElement Data(Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse r)
    {Assert.True(r.StatusCode==200,r.Body);return JsonDocument.Parse(r.Body).RootElement.GetProperty("data").Clone();}
    async Task<JsonElement> Snapshot()=>Data(await ContentRelease.Handle(Req("GET","/api/v1/authoring/release/snapshot"),new Res("isolation"),Admin));
    var before=await Snapshot();
    Data(await CardsImport.HandleCardsImport(Req("POST","/api/v1/authoring/cards/import",new{deckId=id,releaseId="isolation",idempotencyKey="import",expectedEditingSnapshot=before.GetProperty("editingSnapshot").GetString(),cards=new[]{new{stableUid="isolation-card",orderInDeck=1,difficulty=2,question="Question",explanation="Answer",translations=new Dictionary<string,object>{{"zh-CN",new{v=1,question="问题",explanation="答案"}}}}}}),new Res("isolation"),Admin));
    var snap=await Snapshot();
    var review=new{deckId=id,releaseId="isolation",actionId="review",expectedEditingSnapshot=snap.GetProperty("editingSnapshot").GetString(),policy=ContentRelease.Policy,policyHash=ContentRelease.PolicyHash,reviewSchema=ContentRelease.ReviewSchema,schemaHash=ContentRelease.ReviewSchemaHash,
      runId="run",batchAuthorizationRef="local test",authorizationScope="aws-saa-fundamentals:full-deck-bilingual-release",model="codex",evidenceRef="evidence.json",reportRef="report.json",evidenceHash=new string('a',64),reportHash=new string('b',64),promptHash=new string('c',64),corpusHash=new string('d',64),mainSHA=new string('e',40),evidenceVersion="1",reportVersion="1",promptVersion="1",corpusVersion="1",expiresAt=DateTimeOffset.UtcNow.AddHours(1),
      cards=snap.GetProperty("cards").EnumerateArray().Select(x=>new{stableUid=x.GetProperty("stableUid").GetString(),cardContentHash=x.GetProperty("cardContentHash").GetString(),schema=x.GetProperty("schema").GetString(),revision=x.GetProperty("revision").GetInt32(),orderInDeck=1,verdict="PASS",blockers=Array.Empty<string>(),unknowns=Array.Empty<string>()}).ToArray()};
    var receipt=Data(await ContentRelease.Handle(Req("POST","/api/v1/authoring/release/review",review),new Res("isolation"),Admin)).GetProperty("receiptId").GetString();
    await Denied(c,"update content_review_receipts set evidence='{}'::jsonb");
    try
    {
      Vpc.Authoring.Publish.TestEnqueueSeam=new("test-queue","test-bucket",_=>Task.CompletedTask);
      var job=Data(await Vpc.Authoring.Publish.HandleAuthoringPublish(Req("POST","/api/v1/authoring/publish",new{deckId=id,releaseId="isolation",actionId="publish",expectedEditingSnapshot=snap.GetProperty("editingSnapshot").GetString(),expectedLive=(string?)null,receiptId=receipt}),new Res("isolation"),Admin));
      var jid=job.GetProperty("jobId").GetString()!;var repo=new JobRepository();Assert.True(await repo.TryAcquireJobAsync(jid));
      await DbUtil.ExecuteAsync(c,null,"update deck_publishes set content_sha256=$2,content_bytes=100 where job_id=$1",[jid,new string('a',64)]);
      await repo.CompleteJobAsync(jid,1);
      Assert.Equal(job.GetProperty("buildId").GetString(),await DbUtil.ExecuteScalarAsync(c,null,"select live_build_id from decks where id=$1",[id]));
      await DbUtil.ExecuteAsync(c,null,"insert into content_review_revocations(receipt_id,reason,actor_sub) values($1,'local-test','isolation')",[receipt]);
      await Denied(c,"delete from content_review_revocations");
    }
    finally{Vpc.Authoring.Publish.TestEnqueueSeam=null;}
  }

  [Fact]
  public async Task Diagnostics_OnEmptySchema_DoNotCreateMigrationsTable()
  {
    var saved=EnvNames.ToDictionary(n=>n,Environment.GetEnvironmentVariable);
    var cs=await db.CreateScratchDatabaseAsync("diagnostics_"+Guid.NewGuid().ToString("N"));
    try
    {
      Configure(new NpgsqlConnectionStringBuilder(cs),"isolated");
      Assert.Equal(200,(await Migrate.HandleDbMigrationsList(Request(),new Res("read-only"),Admin)).StatusCode);
      await using var c=new NpgsqlConnection(cs);await c.OpenAsync();
      Assert.False((bool)(await DbUtil.ExecuteScalarAsync(c,null,"select to_regclass('schema_migrations') is not null",[]))!);
    }
    finally{foreach(var (name,value) in saved)Environment.SetEnvironmentVariable(name,value);Pg.Reset();RecallSmith.Lambda.Vpc.Db.Pg.Reset();}
  }

  private sealed class Context(string qualifier,string version):ILambdaContext
  {
    public string AwsRequestId=>"maintenance-isolation"; public IClientContext ClientContext=>null!;
    public string FunctionName=>"core-vpc"; public string FunctionVersion=>version; public ICognitoIdentity Identity=>null!;
    public string InvokedFunctionArn=>"arn:aws:lambda:ap-southeast-2:000000000000:function:core-vpc:"+qualifier;
    public ILambdaLogger Logger=>null!; public string LogGroupName=>"test"; public string LogStreamName=>"test";
    public int MemoryLimitInMB=>512; public TimeSpan RemainingTime=>TimeSpan.FromSeconds(90);
  }
}
