using System.Text.Json;
using Amazon.Lambda.Core;
using ConsoleS2.DbBootstrap;
using Npgsql;

var connection = Environment.GetEnvironmentVariable("S2_TEST_CONNECTION") ?? throw new Exception("Owned local PG required");
var options = new NpgsqlConnectionStringBuilder(connection);
if (options.Host is not ("127.0.0.1" or "localhost")) throw new Exception("Local owned fixture only");
await using var conn = new NpgsqlConnection(connection); await conn.OpenAsync();
async Task Execute(string sql) { await using var c = new NpgsqlCommand(sql, conn); await c.ExecuteNonQueryAsync(); }
const string run = "20261116t000000z-aabbccdd";
var manifest = new string('a', 64);
foreach(var pair in new Dictionary<string,string> { ["S2_RUN_ID"]=run, ["S2_MANIFEST_SHA256"]=manifest, ["S2_PRODUCTION_DATABASE"]=options.Database!, ["S2_EXPIRES_AT"]=DateTimeOffset.UtcNow.AddHours(1).ToString("O"), ["PGHOST"]=options.Host!,["PGPORT"]=options.Port.ToString(),["PGSSLMODE"]="disable",["API_ENV"]="test" }) Environment.SetEnvironmentVariable(pair.Key,pair.Value);
await Execute("create table schema_migrations(version int); insert into schema_migrations values(61); create table users(user_sub text primary key); create table deck_publishes(job_id text,deck_slug text,build_id text,updated_at timestamptz,created_at timestamptz,status text); create table publish_dispatch(job_id text,attempts int); create table publish_manifest_delivery(job_id text,state text)");
var function = new Function(); var context = new Context("dc-console-s2-" + run + "-core");
async Task<JsonElement> Call(string op, string? password = null) {
 var input = JsonSerializer.SerializeToElement(new {schemaVersion=1,operation=op,runId=run,manifestSha256=manifest,password=options.Password,newPassword=password});
 return JsonSerializer.SerializeToElement(await function.Handler(input,context));
}
var checks = 0;
void Assert(bool value, string rule) { if(!value) throw new Exception(rule); checks++; Console.WriteLine("PASS " + rule); }
var audit = await Call("audit"); Assert(audit.GetProperty("ok").GetBoolean() && audit.GetProperty("audit").GetProperty("Safe").GetBoolean(),"clean ACL is safe");
await Execute("grant select on users to public");
audit = await Call("audit"); Assert(!audit.GetProperty("audit").GetProperty("Safe").GetBoolean(),"PUBLIC data fails audit");
Assert(!(await Call("provision-isolated",new string('b',40))).GetProperty("ok").GetBoolean(),"unsafe ACL blocks creation");
await Execute("revoke select on users from public");
await Execute("grant select(user_sub) on public.users to public");
Assert(!(await Call("audit")).GetProperty("audit").GetProperty("Safe").GetBoolean(),"PUBLIC column SELECT fails audit");
await Execute("revoke select(user_sub) on public.users from public");

await Execute("create function leak() returns int language sql security definer as 'select 1'");
Assert(!(await Call("audit")).GetProperty("audit").GetProperty("Safe").GetBoolean(),"PUBLIC definer fails audit");
await Execute("revoke execute on function leak() from public");
await Execute("create schema another; grant usage on schema another to public; create table another.private_data(id int); grant select on another.private_data to public");
Assert(!(await Call("audit")).GetProperty("audit").GetProperty("Safe").GetBoolean(),"other-schema PUBLIC data fails audit");
await Execute("revoke select on another.private_data from public");
await Execute("create function another.leak() returns int language sql security definer as 'select 1'");
Assert(!(await Call("audit")).GetProperty("audit").GetProperty("Safe").GetBoolean(),"other-schema PUBLIC definer fails audit");
await Execute("revoke execute on function another.leak() from public");

var created = await Call("provision-isolated",new string('b',40)); Assert(created.GetProperty("ok").GetBoolean(),"isolated database created");
Assert((await Call("provision-isolated",new string('b',40))).GetProperty("ok").GetBoolean(),"same-owned create reconciled");
await Execute("create role developercards_app nologin");
var migrated = await Call("migrate-isolated",new string('b',40));
Assert(migrated.GetProperty("ok").GetBoolean(),"frozen fresh isolated migrations through61");
Assert((await Call("migrate-isolated",new string('b',40))).GetProperty("applied").GetArrayLength()==0,"migration repeat no-op");
Assert((await Call("configure-isolated-observer",new string('d',40))).GetProperty("ok").GetBoolean(),"isolated observer grant after migration");
var db = created.GetProperty("database").GetString()!; var role = created.GetProperty("role").GetString()!;
await using (var isolatedLogin = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection) {Username=role,Password=new string('b',40)}.ConnectionString)) {
 await isolatedLogin.OpenAsync();
 try { await using var c = new NpgsqlCommand("select * from users",isolatedLogin); await c.ExecuteScalarAsync(); Assert(false,"cross database denied"); } catch(PostgresException e) { Assert(e.SqlState=="42501","isolated login cannot read production fixture"); }
}
var observer = await Call("provision-observer",new string('c',40)); Assert(observer.GetProperty("ok").GetBoolean(),"observer3-table grant");
Assert((await Call("explain-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"actual bounded EXPLAIN as observer");
await using(var limit = new NpgsqlCommand("select rolconnlimit from pg_roles where rolname='developercards_operations_observer'",conn)) Assert((int)(await limit.ExecuteScalarAsync())! == 2,"observer connection limit2");
await Execute("grant select on another.private_data to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"effective other-schema table privilege rejected");
await Execute("revoke select on another.private_data from developercards_operations_observer; grant execute on function another.leak() to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"effective definer execution rejected");
await Execute("revoke execute on function another.leak() from developercards_operations_observer; create sequence another.private_seq; grant usage on sequence another.private_seq to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"effective sequence privilege rejected");
await Execute("revoke usage on sequence another.private_seq from developercards_operations_observer");
Assert((await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"safe owned observer grant retry");
await Execute("grant select(user_sub) on public.users to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"effective private column SELECT rejected");
await Execute("revoke select(user_sub) on public.users from developercards_operations_observer; grant update(job_id) on public.deck_publishes to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"allowed table column UPDATE rejected");
await Execute("revoke update(job_id) on public.deck_publishes from developercards_operations_observer; grant maintain on public.users to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"PG17 direct MAINTAIN rejected");
await Execute("revoke maintain on public.users from developercards_operations_observer");
await Execute("grant create on schema another to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"effective schema CREATE rejected");
await Execute("revoke create on schema another from developercards_operations_observer; grant create on database postgres to developercards_operations_observer");
Assert(!(await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"effective database CREATE rejected");
await Execute("revoke create on database postgres from developercards_operations_observer");
await Execute("create schema postgres; create table postgres.deck_publishes(id int); create table postgres.publish_dispatch(id int); create table postgres.publish_manifest_delivery(id int)");
Assert((await Call("provision-observer",new string('c',40))).GetProperty("ok").GetBoolean(),"pinned public path ignores postgres schema");
await using(var wrong = new NpgsqlCommand("select has_table_privilege('developercards_operations_observer','postgres.deck_publishes','SELECT')",conn)) Assert(await wrong.ExecuteScalarAsync() is false,"shadow table never granted");
await using (var read = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection) {Username="developercards_operations_observer",Password=new string('c',40)}.ConnectionString)) {
 await read.OpenAsync();
 await using var c = new NpgsqlCommand("show default_transaction_read_only",read); Assert((string?)await c.ExecuteScalarAsync()=="on","observer transaction readonly default");
 try { await using var forbidden = new NpgsqlCommand("select * from users",read); await forbidden.ExecuteScalarAsync(); Assert(false,"observer users forbidden"); } catch(PostgresException e) { Assert(e.SqlState=="42501","observer cannot read learners"); }
}
Assert((await Call("drop-isolated")).GetProperty("ok").GetBoolean(),"owned teardown");
Environment.SetEnvironmentVariable("S2_EXPIRES_AT",DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O"));
Assert((await Call("drop-isolated")).GetProperty("alreadyAbsent").GetBoolean(),"expired all-absent teardown retry reconciled");
Assert(!(await Call("audit")).GetProperty("ok").GetBoolean(),"expired new work rejected");
Environment.SetEnvironmentVariable("S2_EXPIRES_AT",DateTimeOffset.UtcNow.AddHours(1).ToString("O"));
var invalid = JsonSerializer.SerializeToElement(new {schemaVersion=1,operation="audit",runId=run,manifestSha256=manifest,password=options.Password,sql="drop database postgres"});
Assert(!JsonSerializer.SerializeToElement(await function.Handler(invalid,context)).GetProperty("ok").GetBoolean(),"generic SQL rejected");
context.Version="$LATEST";
Assert(!(await Call("audit")).GetProperty("ok").GetBoolean(),"latest handler rejected");
Console.WriteLine($"{checks} checks passed; no AWS calls");
sealed class Context(string name):ILambdaContext {
 public string Version="1"; public string FunctionName=>name; public string FunctionVersion=>Version; public string InvokedFunctionArn=>"arn:aws:lambda:ap-southeast-2:622994489535:function:"+name+":"+Version;
 public TimeSpan RemainingTime=>TimeSpan.FromSeconds(90); public string AwsRequestId=>"local-owned-test"; public IClientContext ClientContext=>null!; public ICognitoIdentity Identity=>null!; public ILambdaLogger Logger=>null!; public string LogGroupName=>"local"; public string LogStreamName=>"local"; public int MemoryLimitInMB=>256;
}
