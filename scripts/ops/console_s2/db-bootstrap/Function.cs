using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.Core;
using Npgsql;
using RecallSmith.Lambda.Db;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]
namespace ConsoleS2.DbBootstrap;

// This package is only for an owner-invoked, unaliased version of the isolated core clone.
// The production core package, aliases, environment and roles never receive this handler.
public sealed class Function
{
  private static readonly Regex RunPattern = new("^[0-9]{8}t[0-9]{6}z-[a-f0-9]{8}$");
  private static readonly Regex HashPattern = new("^[a-f0-9]{64}$");
  private static readonly HashSet<string> Operations = ["audit", "provision-observer", "provision-isolated", "configure-isolated-observer", "migrate-isolated", "explain-observer", "lock-sync-fixture", "lock-audit-fixture", "drop-isolated"];
  private const string ObserverRole = "developercards_operations_observer";
  private const string SafeError = "DB_PREREQUISITE_UNAVAILABLE";

  public async Task<object> Handler(JsonElement input, ILambdaContext context)
  {
    try
    {
      var run = Env("S2_RUN_ID");
      var manifest = Env("S2_MANIFEST_SHA256");
      var productionDb = Env("S2_PRODUCTION_DATABASE");
      if (!RunPattern.IsMatch(run) || !HashPattern.IsMatch(manifest)
          || !Regex.IsMatch(productionDb, "^[a-z][a-z0-9_]{1,62}$")
          || context.FunctionName != "dc-console-s2-" + run + "-core"
          || (!Regex.IsMatch(context.FunctionVersion, "^[1-9][0-9]*$") || context.InvokedFunctionArn != "arn:aws:lambda:ap-southeast-2:622994489535:function:" + context.FunctionName + ":" + context.FunctionVersion)) return Rejected();
      var fields = Parse(input);
      if (fields is null || !fields.TryGetValue("runId", out var rid) || rid.GetString() != run
          || !fields.TryGetValue("manifestSha256", out var mh) || mh.GetString() != manifest
          || !fields.TryGetValue("schemaVersion", out var sv) || !sv.TryGetInt32(out var version) || version != 1
          || !fields.TryGetValue("operation", out var op) || op.ValueKind != JsonValueKind.String
          || !Operations.Contains(op.GetString()!) || !fields.TryGetValue("password", out var pw)
          || pw.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(pw.GetString())) return Rejected();
      var operation = op.GetString()!;
      if (operation != "drop-isolated" && (!DateTimeOffset.TryParse(Env("S2_EXPIRES_AT"), out var expiry) || expiry <= DateTimeOffset.UtcNow)) return Rejected();
      using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Min(60, Math.Max(1, context.RemainingTime.TotalSeconds - 3))));
      var database = "dc_console_s2_" + run.Replace('-', '_');
      var marker = "console-s2:" + run + ":" + manifest;
      await using var admin = await Open("postgres", "postgres", pw.GetString()!, timeout.Token);
      if (await Scalar(admin, "select current_user='postgres' and rolcreaterole and rolcreatedb from pg_roles where rolname=current_user", timeout.Token) is not true) return Rejected();
      if (operation == "drop-isolated") return await Drop(admin, database, marker, timeout.Token);
      await using var production = await Open(productionDb, "postgres", pw.GetString()!, timeout.Token);
      var audit = await Audit(production, timeout.Token);
      if (operation == "audit") return new { schemaVersion = 1, ok = true, audit };
      if (!audit.Safe) return new { schemaVersion = 1, ok = false, reason = "UNSAFE_PRODUCTION_PUBLIC_ACL", audit };
      if (operation is "lock-sync-fixture" or "lock-audit-fixture")
      {
        if (!await OwnedDatabase(admin, database, marker, timeout.Token)) return Rejected();
        var user = fields.TryGetValue("userSub", out var sub) && sub.ValueKind == JsonValueKind.String ? sub.GetString() : null;
        if (operation == "lock-sync-fixture" && !Guid.TryParse(user, out _)) return Rejected();
        await using var isolated = await Open(database, "postgres", pw.GetString()!, timeout.Token);
        var seconds = operation == "lock-sync-fixture" ? 45 : 10;
        if (context.RemainingTime.TotalSeconds < seconds + 5) return Rejected();
        await using var tx = await isolated.BeginTransactionAsync(timeout.Token);
        await Execute(isolated, "set local statement_timeout=50000; set local idle_in_transaction_session_timeout=55000", timeout.Token);
        if (operation == "lock-sync-fixture")
        {
          if (await Scalar(isolated, "select user_sub from public.users where user_sub=$1 for update", timeout.Token, user!) is not string) return Rejected();
        }
        else await Execute(isolated, "lock table public.admin_audit in share mode", timeout.Token);
        await using var sleep = new NpgsqlCommand("select pg_sleep($1)", isolated, tx) { CommandTimeout = 50 };
        sleep.Parameters.AddWithValue(seconds);
        await sleep.ExecuteNonQueryAsync(timeout.Token);
        await tx.RollbackAsync(timeout.Token);
        return new { schemaVersion = 1, ok = true, isolatedLockReleased = true, seconds };
      }
      var password = fields.TryGetValue("newPassword", out var next) && next.ValueKind == JsonValueKind.String ? next.GetString() : null;
      if (password is null || !Regex.IsMatch(password, "^[A-Za-z0-9]{40,64}$")) return Rejected();
      if (operation == "migrate-isolated")
      {
        if (!await OwnedDatabase(admin, database, marker, timeout.Token)) return Rejected();
        await using var isolated = await Open(database, database + "_runtime", password, timeout.Token);
        return await MigrateIsolated(isolated, timeout.Token);
      }
      if (operation == "explain-observer")
      {
        await using var observer = await Open(productionDb, ObserverRole, password, timeout.Token);
        await using var tx = await observer.BeginTransactionAsync(timeout.Token);
        await Execute(observer, "set transaction read only; set local statement_timeout=2000; set local lock_timeout=250", timeout.Token);
        var plan = (string?)await Scalar(observer, "explain (analyze,buffers,format json) " + ReadResource("Backlog.sql"), timeout.Token);
        if (plan is null || System.Text.Encoding.UTF8.GetByteCount(plan) > 131072) throw new InvalidOperationException();
        await tx.CommitAsync(timeout.Token);
        return new { schemaVersion = 1, ok = true, queryPlan = JsonSerializer.Deserialize<JsonElement>(plan), restrictedObserverLogin = true };
      }
      if (operation == "provision-observer")
        return await ProvisionObserver(production, productionDb, ObserverRole, password, marker, timeout.Token);
      if (operation == "configure-isolated-observer")
      {
        if (!await OwnedDatabase(admin, database, marker, timeout.Token)) return Rejected();
        await using var isolated = await Open(database, "postgres", pw.GetString()!, timeout.Token);
        if (!(await Audit(isolated, timeout.Token)).Safe) return Rejected();
        return await ProvisionObserver(isolated, database, database + "_observer", password, marker, timeout.Token);
      }
      return await ProvisionIsolated(admin, production, database, password, marker, timeout.Token);
    }
    catch (Exception) { return new { schemaVersion = 1, ok = false, reason = SafeError }; }
  }

  private static object Rejected() => new { schemaVersion = 1, ok = false, reason = "INVALID_OWNER_REQUEST" };
  private static string Env(string key) => Environment.GetEnvironmentVariable(key) ?? "";
  private static Dictionary<string, JsonElement>? Parse(JsonElement input)
  {
    if (input.ValueKind != JsonValueKind.Object) return null;
    var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
    foreach (var property in input.EnumerateObject())
      if (!new[] { "schemaVersion", "operation", "runId", "manifestSha256", "password", "newPassword", "userSub" }.Contains(property.Name)
          || !fields.TryAdd(property.Name, property.Value)) return null;
    return fields;
  }
  private static string Quote(string name) => "\"" + name.Replace("\"", "\"\"") + "\"";
  private static async Task<NpgsqlConnection> Open(string db, string user, string password, CancellationToken ct)
  {
    var options = new NpgsqlConnectionStringBuilder {
      Host = Env("PGHOST"), Port = int.TryParse(Env("PGPORT"), out var port) ? port : 5432, Database = db, Username = user, Password = password,
      Pooling = false, Timeout = 3, CommandTimeout = 5, IncludeErrorDetail = false,
      Options = "-c statement_timeout=5000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=5000 -c search_path=public"
    };
    PgConnectionSecurity.Apply(options);
    var conn = new NpgsqlConnection(options.ConnectionString);
    try { await conn.OpenAsync(ct); return conn; } catch { await conn.DisposeAsync(); throw; }
  }
  private static async Task<object?> Scalar(NpgsqlConnection c, string sql, CancellationToken ct, params object[] values)
  {
    await using var cmd = new NpgsqlCommand(sql, c);
    foreach (var value in values) cmd.Parameters.Add(new NpgsqlParameter { Value = value });
    return await cmd.ExecuteScalarAsync(ct);
  }
  private static async Task Execute(NpgsqlConnection c, string sql, CancellationToken ct, params object[] values)
  {
    await using var cmd = new NpgsqlCommand(sql, c);
    foreach (var value in values) cmd.Parameters.Add(new NpgsqlParameter { Value = value });
    await cmd.ExecuteNonQueryAsync(ct);
  }
  private sealed record AuditResult(bool Safe, long PublicDataGrants, long PublicCreateGrants, long PublicDefinerFunctions, long PublicDefaultDataGrants, int SchemaVersion);
  private static async Task<AuditResult> Audit(NpgsqlConnection c, CancellationToken ct)
  {
    // No business rows are read. PUBLIC privileges are inherited by every fresh login.
    await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
    await Execute(c, "set transaction read only", ct);
    const string sql = """
      select
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace,
          lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)' and c.relkind in('r','p','v','m','S','f') and a.grantee=0)
       + (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace,
          lateral aclexplode(a.attacl) acl
        where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
        and a.attnum>0 and not a.attisdropped and acl.grantee=0) as public_data,
       (select count(*) from pg_namespace n,lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)' and a.grantee=0 and a.privilege_type='CREATE') as public_create,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
          lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)' and p.prosecdef and a.grantee=0 and a.privilege_type='EXECUTE') as public_definer,
       (select count(*) from pg_default_acl d,lateral aclexplode(d.defaclacl) a
        where a.grantee=0 and d.defaclobjtype in('r','S') and (d.defaclnamespace=0 or d.defaclnamespace in(select oid from pg_namespace where nspname not in('pg_catalog','information_schema') and nspname !~ '^pg_(toast|temp)'))) as public_default,
       (select coalesce(max(version),0) from public.schema_migrations)::int as schema_version
      """;
    await using var cmd = new NpgsqlCommand(sql, c, tx);
    await using var reader = await cmd.ExecuteReaderAsync(ct);
    if (!await reader.ReadAsync(ct)) throw new InvalidOperationException();
    var a = reader.GetInt64(0); var b = reader.GetInt64(1); var d = reader.GetInt64(2); var e = reader.GetInt64(3); var v = reader.GetInt32(4);
    await reader.DisposeAsync(); await tx.CommitAsync(ct);
    return new(a == 0 && b == 0 && d == 0 && e == 0 && v == 61, a, b, d, e, v);
  }
  private static async Task<bool> OwnedRole(NpgsqlConnection c, string role, string marker, CancellationToken ct)
    => await Scalar(c, "select shobj_description(oid,'pg_authid')=$2 from pg_roles where rolname=$1", ct, role, marker) is true;
  private static async Task CreateRole(NpgsqlConnection c, string role, string password, string marker, CancellationToken ct)
  {
    if (await Scalar(c, "select exists(select 1 from pg_roles where rolname=$1)", ct, role) is true)
    {
      if (!await OwnedRole(c, role, marker, ct)) throw new InvalidOperationException();
      // A lost create response is reconciled; the owner-saved password is never rotated here.
      await Execute(c, $"alter role {Quote(role)} connection limit {(role.EndsWith("_observer", StringComparison.Ordinal) ? 2 : 6)}", ct);
      return;
    }
    await Execute(c, "select set_config('s2.role_password',$1,false),set_config('s2.role_marker',$2,false)", ct, password, marker);
    await Execute(c, "do $$ begin execute format('create role %I login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit " + (role.EndsWith("_observer", StringComparison.Ordinal) ? "2" : "6") + " password %L', '" + role + "',current_setting('s2.role_password')); execute format('comment on role %I is %L','" + role + "',current_setting('s2.role_marker')); end $$", ct);
  }
  private static async Task<bool> RoleHasNoMembership(NpgsqlConnection c, string role, CancellationToken ct)
    => await Scalar(c, "select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit and not exists(select 1 from pg_auth_members m where m.member=r.oid) from pg_roles r where rolname=$1", ct, role) is true;
  private static async Task<bool> ProtectedDatabaseAccessSafe(NpgsqlConnection conn, string role, bool observer, CancellationToken ct)
  {
    const string sql = """
      select not has_database_privilege($1,current_database(),'CREATE') and not exists(
       select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and case when c.relkind in('r','p','v','m','f') then (
        has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege($1,c.oid,'INSERT,UPDATE,REFERENCES')
        or (has_any_column_privilege($1,c.oid,'SELECT') and not($2 and n.nspname='public' and c.relname in('deck_publishes','publish_dispatch','publish_manifest_delivery'))))
       else false end)
      and not exists(
       select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and case when c.relkind='S' then has_sequence_privilege($1,c.oid,'SELECT,USAGE,UPDATE') else false end)
      and not exists(
       select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname not in('pg_catalog','information_schema') and n.nspname !~ '^pg_(toast|temp)'
       and p.prosecdef and has_schema_privilege($1,n.oid,'USAGE') and has_function_privilege($1,p.oid,'EXECUTE'))
      and not exists(
       select 1 from pg_namespace n where n.nspname not in('pg_catalog','information_schema')
       and n.nspname !~ '^pg_(toast|temp)' and has_schema_privilege($1,n.oid,'CREATE'))
      """;
    return await Scalar(conn, sql, ct, role, observer) is true;
  }
  private static async Task<object> ProvisionObserver(NpgsqlConnection production, string db, string role, string password, string marker, CancellationToken ct)
  {
    await using var tx = await production.BeginTransactionAsync(ct);
    await CreateRole(production, role, password, marker, ct);
    await Execute(production, $"grant connect on database {Quote(db)} to {Quote(role)}; grant usage on schema public to {Quote(role)}; grant select on public.deck_publishes,public.publish_dispatch,public.publish_manifest_delivery to {Quote(role)}; alter role {Quote(role)} set default_transaction_read_only=on", ct);
    if (!await RoleHasNoMembership(production, role, ct)) throw new InvalidOperationException();
    if (!await ProtectedDatabaseAccessSafe(production, role, true, ct)) throw new InvalidOperationException();
    await tx.CommitAsync(ct);
    return new { schemaVersion = 1, ok = true, role, protectedDatabaseAccessSafe = true, connectionLimit = 2 };
  }
  private static async Task<object> ProvisionIsolated(NpgsqlConnection admin, NpgsqlConnection production, string db, string password, string marker, CancellationToken ct)
  {
    var role = db + "_runtime";
    await using (var tx = await admin.BeginTransactionAsync(ct))
    {
      await CreateRole(admin, role, password, marker, ct);
      if (!await RoleHasNoMembership(admin, role, ct)) throw new InvalidOperationException();
      await tx.CommitAsync(ct);
    }
    if (!await ProtectedDatabaseAccessSafe(production, role, false, ct)) throw new InvalidOperationException();
    var exists = await Scalar(admin, "select exists(select 1 from pg_database where datname=$1)", ct, db) is true;
    if (exists)
    {
      if (!await OwnedDatabase(admin, db, marker, ct)) throw new InvalidOperationException();
    }
    else
    {
      // CREATE DATABASE is nontransactional. A matching role/database owner is recorded before the call.
      await Execute(admin, $"create database {Quote(db)} owner {Quote(role)}", ct);

    }
    await Execute(admin, "select set_config('s2.db_marker',$1,false)", ct, marker);
    await Execute(admin, "do $$ begin execute format('comment on database %I is %L','" + db + "',current_setting('s2.db_marker')); end $$", ct);
    await Execute(admin, $"revoke all on database {Quote(db)} from public; grant connect on database {Quote(db)} to {Quote(role)}", ct);
    return new { schemaVersion = 1, ok = true, database = db, role, productionPrivilegesAbsent = true, migrationsApplied = false };
  }
  private static async Task<bool> OwnedDatabase(NpgsqlConnection admin, string db, string marker, CancellationToken ct)
    => await OwnedRole(admin, db + "_runtime", marker, ct) && await Scalar(admin,
      "select (shobj_description(oid,'pg_database')=$2 or shobj_description(oid,'pg_database') is null) and pg_get_userbyid(datdba)=$3 from pg_database where datname=$1", ct, db, marker, db + "_runtime") is true;
  private static string ReadResource(string name)
  {
    using var stream = typeof(Function).Assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException();
    using var reader = new StreamReader(stream);
    return reader.ReadToEnd();
  }
  private static async Task<object> MigrateIsolated(NpgsqlConnection conn, CancellationToken ct)
  {
    var applied = new List<int>();
    var resources = typeof(Function).Assembly.GetManifestResourceNames()
      .Where(x => Regex.IsMatch(x, @"^Migrations\.[0-9]{3}_[A-Za-z0-9_]+\.sql$"))
      .OrderBy(x => x, StringComparer.Ordinal).ToArray();
    if (resources.Length == 0 || !resources[^1].StartsWith("Migrations.061_")) throw new InvalidOperationException();
    var repair = ReadResource("Migrations.060_rollback_owner_permissions.sql");
    if (Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(repair))) != "23ba2f9850189e705218da549574bc428d357f76a4aa5032aa0da794294a4b65") throw new InvalidOperationException();
    await Execute(conn, "select pg_advisory_lock(77889911)", ct);
    try
    {
      await Execute(conn, "create table if not exists public.schema_migrations(version int primary key,name text not null,applied_at timestamptz not null default now())", ct);
      foreach (var name in resources)
      {
        var number = int.Parse(name.Substring("Migrations.".Length, 3));
        if (await Scalar(conn, "select exists(select 1 from public.schema_migrations where version=$1)", ct, number) is true) continue;
        await using var tx = await conn.BeginTransactionAsync(ct);
        // Fixed fresh isolated DB only; source SQL includes intentional historical destructive steps.
        if (number == 59) await Execute(conn, repair, ct);
        await Execute(conn, ReadResource(name), ct);
        await Execute(conn, "insert into public.schema_migrations(version,name) values($1,$2)", ct, number, name["Migrations.".Length..^4]);
        await tx.CommitAsync(ct);
        applied.Add(number);
      }
      // Historical056 conditionally grants the production app role in every database.
      // Remove those isolated grants; production roles receive no CONNECT to this DB.
      if (await Scalar(conn, "select exists(select 1 from pg_roles where rolname='developercards_app')", ct) is true)
        await Execute(conn, "revoke all on all tables in schema public from developercards_app; revoke execute on all functions in schema public from developercards_app", ct);
      return new { schemaVersion = 1, ok = true, schema = 61, applied, isolatedOnly = true };
    }
    finally { await Execute(conn, "select pg_advisory_unlock(77889911)", ct); }
  }
  private static async Task<object> Drop(NpgsqlConnection admin, string db, string marker, CancellationToken ct)
  {
    var role = db + "_runtime";
    var observer = db + "_observer";
    var roleExists = await Scalar(admin, "select exists(select 1 from pg_roles where rolname=$1)", ct, role) is true;
    var observerExists = await Scalar(admin, "select exists(select 1 from pg_roles where rolname=$1)", ct, observer) is true;
    var databaseExists = await Scalar(admin, "select exists(select 1 from pg_database where datname=$1)", ct, db) is true;
    if (!roleExists && !observerExists && !databaseExists)
      return new { schemaVersion = 1, ok = true, alreadyAbsent = true, productionObserverRetained = true };
    if (roleExists && !await OwnedRole(admin, role, marker, ct)) throw new InvalidOperationException();
    if (observerExists && !await OwnedRole(admin, observer, marker, ct)) throw new InvalidOperationException();
    if (databaseExists)
    {
      if (!roleExists || !await OwnedDatabase(admin, db, marker, ct)) throw new InvalidOperationException();
      await Execute(admin, $"drop database {Quote(db)} with(force)", ct);
    }
    if (observerExists) await Execute(admin, $"drop role {Quote(observer)}", ct);
    if (roleExists) await Execute(admin, $"drop role {Quote(role)}", ct);
    return new { schemaVersion = 1, ok = true, deletedDatabase = db, deletedRole = role, productionObserverRetained = true };
  }
}
