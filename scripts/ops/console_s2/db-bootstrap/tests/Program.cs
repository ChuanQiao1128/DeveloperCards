using System.Text.Json;
using System.Reflection;
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
async Task<JsonElement> Call(string op, string? password = null, string? userSub = null) {
 var input = JsonSerializer.SerializeToElement(new {schemaVersion=1,operation=op,runId=run,manifestSha256=manifest,password=options.Password,newPassword=password,userSub});
 return JsonSerializer.SerializeToElement(await function.Handler(input,context));
}
var checks = 0;
void Assert(bool value, string rule) { if(!value) throw new Exception(rule); checks++; Console.WriteLine("PASS " + rule); }
await using(var attributes = new NpgsqlCommand("select not rolsuper and rolcreaterole and rolcreatedb and current_setting('server_version_num')::int between 170000 and 179999 from pg_roles where rolname=current_user",conn)) Assert(await attributes.ExecuteScalarAsync() is true,"real PG17 non-superuser CREATEROLE CREATEDB fixture");
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

var expectedDb = "dc_console_s2_" + run.Replace('-', '_'); var expectedRole = expectedDb + "_runtime";
await Execute($"create role {expectedRole} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '{new string('b',40)}'; comment on role {expectedRole} is 'console-s2:{run}:{manifest}'");
try { await Execute($"create database {expectedDb} owner {expectedRole}"); Assert(false,"legacy owner creation must fail"); }
catch(PostgresException e) { Assert(e.SqlState=="42501","legacy CREATE DATABASE OWNER reproduces SET privilege failure"); }
async Task CheckCreatorMembership(string label) {
 await using var c = new NpgsqlCommand("select not pg_has_role('postgres',$1,'SET') and not pg_has_role('postgres',$1,'USAGE') and exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where r.rolname=$1 and u.rolname='postgres' and m.admin_option and not m.inherit_option and not m.set_option) and not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=$1)",conn);
 c.Parameters.AddWithValue(expectedRole); Assert(await c.ExecuteScalarAsync() is true,label);
}
await CheckCreatorMembership("creator ADMIN only before repaired role-only resume");
var created = await Call("provision-isolated",new string('b',40)); Assert(created.GetProperty("ok").GetBoolean(),"isolated database created");
Assert((await Call("provision-isolated",new string('b',40))).GetProperty("ok").GetBoolean(),"same-owned create reconciled");
await CheckCreatorMembership("temporary SET revoked and creator ADMIN preserved after create");
await Execute($"grant {expectedRole} to postgres with admin false, inherit false, set true; set role {expectedRole}; comment on database {expectedDb} is null; reset role; revoke {expectedRole} from postgres granted by postgres");
Assert((await Call("provision-isolated",new string('b',40))).GetProperty("ok").GetBoolean(),"lost response before database COMMENT reconciled");
await Execute($"grant {expectedRole} to postgres with admin false, inherit false, set true; set role {expectedRole}; comment on database {expectedDb} is 'foreign-marker'; reset role; revoke {expectedRole} from postgres granted by postgres");
var countPath = Environment.GetEnvironmentVariable("S2_TEST_GRANT_COUNT_PATH")!;
var beforeForeignGrant = File.ReadAllText(countPath);
Environment.SetEnvironmentVariable("PGPORT", Environment.GetEnvironmentVariable("S2_TEST_GRANT_OBSERVER_PORT"));
try { Assert(!(await Call("provision-isolated",new string('b',40))).GetProperty("ok").GetBoolean(),"foreign database marker refuses owner operation"); }
finally { Environment.SetEnvironmentVariable("PGPORT", options.Port.ToString()); }
Assert(File.ReadAllText(countPath)==beforeForeignGrant,"foreign database rejected before any temporary GRANT reaches server");
await CheckCreatorMembership("temporary SET removed after rejected ownership reconciliation");
await Execute($"grant {expectedRole} to postgres with admin false, inherit false, set true; set role {expectedRole}; comment on database {expectedDb} is 'console-s2:{run}:{manifest}'; reset role; revoke {expectedRole} from postgres granted by postgres");

// Private-scope invocation and local wire faults are test-only; Handler exposes no injection switches.
var scope = typeof(Function).GetMethod("WithRuntimeOwner",BindingFlags.NonPublic|BindingFlags.Static)!;
Task<object> OwnerScope(NpgsqlConnection admin, Func<Task<object>> work, string? masterPassword = null, CancellationToken token = default)
 => (Task<object>)scope.Invoke(null,[admin,expectedDb,"console-s2:"+run+":"+manifest,masterPassword ?? options.Password!,work,token])!;
async Task ExpectScopeFailure(Func<Task<object>> work, string rule) {
 bool failed=false; try { await work(); } catch { failed=true; } Assert(failed,rule);
}
Environment.SetEnvironmentVariable("PGPORT",Environment.GetEnvironmentVariable("S2_TEST_GRANT_OBSERVER_PORT"));
try { Assert((await Call("provision-isolated",new string('b',40))).GetProperty("ok").GetBoolean(),"observed proxy passes normal owned provision"); }
finally { Environment.SetEnvironmentVariable("PGPORT",options.Port.ToString()); }
Assert(int.Parse(File.ReadAllText(countPath))==int.Parse(beforeForeignGrant)+1,"wire observer positively counts a real temporary GRANT");
await using(var cancelled = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection){Pooling=false}.ConnectionString)) {
 await cancelled.OpenAsync(); using var cancel = new CancellationTokenSource();
 await ExpectScopeFailure(()=>OwnerScope(cancelled,()=>{cancel.Cancel();return Task.FromCanceled<object>(cancel.Token);},token:cancel.Token),"cancelled owned work remains failure");
}
await CheckCreatorMembership("cancelled work revokes SET using uncancelled cleanup budget");
await using(var broken = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection){Pooling=false}.ConnectionString)) {
 await broken.OpenAsync();
 await ExpectScopeFailure(()=>OwnerScope(broken,async()=>{await broken.CloseAsync();return new {ok=true};}),"RESET on broken connection cannot return success");
}
await CheckCreatorMembership("fresh admin revokes SET despite original RESET failure");
var lossCountPath=Environment.GetEnvironmentVariable("S2_TEST_GRANT_LOSS_COUNT_PATH")!;
var lossBefore=int.Parse(File.ReadAllText(lossCountPath)); var committedBefore=int.Parse(File.ReadAllText(lossCountPath+".committed")); bool workAfterLoss=false;
await using(var lost = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection){Pooling=false,Port=int.Parse(Environment.GetEnvironmentVariable("S2_TEST_GRANT_LOSS_PORT")!)}.ConnectionString)) {
 await lost.OpenAsync();
 await ExpectScopeFailure(()=>OwnerScope(lost,()=>{workAfterLoss=true;return Task.FromResult<object>(new {ok=true});}),"committed GRANT response loss remains failure");
}
Assert(!workAfterLoss && int.Parse(File.ReadAllText(lossCountPath))==lossBefore+1,"wire fault intercepted actual GRANT before work delegate");
Assert(int.Parse(File.ReadAllText(lossCountPath+".committed"))==committedBefore+1,"wire fault confirms GRANT CommandComplete plus committed ReadyForQuery before dropping response");
await CheckCreatorMembership("committed GRANT response loss still triggers fresh-session revoke");
await using(var failedRevoke = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection){Pooling=false}.ConnectionString)) {
 await failedRevoke.OpenAsync();
 await ExpectScopeFailure(()=>OwnerScope(failedRevoke,()=>Task.FromResult<object>(new {ok=true}),masterPassword:"wrong-local-fixture-password"),"fresh cleanup authentication failure cannot return PASS");
}
await using(var remaining = new NpgsqlCommand("select pg_has_role('postgres',$1,'SET')",conn)) { remaining.Parameters.AddWithValue(expectedRole);Assert(await remaining.ExecuteScalarAsync() is true,"failed cleanup explicitly leaves uncertain grant for reconciliation"); }
await Execute($"revoke {expectedRole} from postgres granted by postgres");
await CheckCreatorMembership("owned reconciliation removes failed-cleanup grant and retains ADMIN");
await Execute("create role developercards_app nologin");
var migrated = await Call("migrate-isolated",new string('b',40));
Assert(migrated.GetProperty("ok").GetBoolean(),"frozen fresh isolated migrations through61");
Assert((await Call("migrate-isolated",new string('b',40))).GetProperty("applied").GetArrayLength()==0,"migration repeat no-op");
Assert((await Call("configure-isolated-observer",new string('d',40))).GetProperty("ok").GetBoolean(),"isolated observer grant after migration");
await CheckCreatorMembership("temporary SET removed after isolated observer setup");
Assert((await Call("lock-audit-fixture")).GetProperty("ok").GetBoolean(),"fixed isolated audit lock under non-super owner scope");
await CheckCreatorMembership("temporary SET removed after fixed lock");
const string syncUser="6f478a5c-48dc-48e9-9321-1a5212ce475f";
await using(var setupSync = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(connection){Database=expectedDb,Username=expectedRole,Password=new string('b',40),Pooling=false}.ConnectionString)) {
 await setupSync.OpenAsync(); await using var insert = new NpgsqlCommand("insert into public.users(user_sub) values($1)",setupSync);insert.Parameters.AddWithValue(syncUser);await insert.ExecuteNonQueryAsync();
}
Assert((await Call("lock-sync-fixture",userSub:syncUser)).GetProperty("ok").GetBoolean(),"fixed 45-second sync lock under non-super owner scope");
await CheckCreatorMembership("temporary SET removed after fixed sync lock");

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
