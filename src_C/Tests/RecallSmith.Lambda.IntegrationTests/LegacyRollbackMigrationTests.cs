using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;
using DbUtil = RecallSmith.Lambda.Db.DbUtil;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class LegacyRollbackMigrationTests(PostgresFixture db)
{
  private static readonly string MigrationDir = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations");
  private static Task<object?> Scalar(NpgsqlConnection c, string sql, params object?[] args) => DbUtil.ExecuteScalarAsync(c, null, sql, args);
  private static Task Exec(NpgsqlConnection c, string sql, params object?[] args) => DbUtil.ExecuteAsync(c, null, sql, args);
  private static async Task Repair(NpgsqlConnection c) => await Exec(c, await File.ReadAllTextAsync(Path.Combine(MigrationDir, "060_rollback_owner_permissions.sql")));
  private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
  private static JsonElement Table(JsonElement diagnostics, string name) => diagnostics.GetProperty("tables").EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);

  private async Task WithLegacyOwner(Func<NpgsqlConnection, NpgsqlConnection, Task> test)
  {
    var cs = await db.CreateScratchDatabaseAsync("legacy_owner_" + Guid.NewGuid().ToString("N"));
    var name = new NpgsqlConnectionStringBuilder(cs).Database;
    await using var admin = new NpgsqlConnection(cs); await admin.OpenAsync();
    try
    {
      await Exec(admin, """
        create role developercards_app login password 'local-legacy-owner' nosuperuser nocreatedb nocreaterole;
        grant usage,create on schema public to developercards_app;
        """);
      await using var app = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(cs)
        { Username = "developercards_app", Password = "local-legacy-owner", Pooling = false }.ConnectionString);
      await app.OpenAsync();
      Assert.Equal("developercards_app", await Scalar(app, "select session_user"));
      Assert.False((bool)(await Scalar(app, "select rolsuper from pg_roles where rolname=current_user"))!);
      await test(app, admin);
    }
    finally
    {
      await using var cleanup = await db.OpenAsync();
      await Exec(cleanup, $"drop database {name} with(force)");
      await Exec(cleanup, "drop role if exists developercards_app");
    }
  }

  private static async Task<long> SeedRollback(NpgsqlConnection app)
  {
    var id = Convert.ToInt64(await Scalar(app, "insert into decks(slug,title,author) values('legacy','Legacy','test') returning id"));
    await Exec(app, """
      insert into content_review_receipts(id,deck_id,release_id,action_id,payload_hash,editing_snapshot,publish_snapshot,policy,evidence,submitted_by,expires_at)
      values('receipt',$1,'release','review',repeat('a',64),'saved','saved','aws-codex-bilingual-v1','{}','test',now()+interval '1 hour');
      insert into deck_publishes(deck_id,deck_slug,job_id,build_id,s3_key,status,content_sha256,content_bytes,release_generation,release_receipt_id)
      values($1,'legacy','original-job','original','test','SUCCESS',repeat('a',64),100,0,'receipt'),
        ($1,'legacy','attempted-job','attempted','test','SUCCESS',repeat('b',64),100,1,'receipt');
      update decks set slug='aws-saa-fundamentals',live_build_id='attempted',release_generation=1 where id=$1;
      """, id);
    return id;
  }

  private const string Rollback = "select public.content_release_rollback($1,'release','restore','original','attempted',repeat('a',64),repeat('c',64))";

  private static async Task VerifyRollback(NpgsqlConnection app, NpgsqlConnection admin, long id)
  {
    var result = await Scalar(app, Rollback, id);
    Assert.Contains("rollbackCommitted", Assert.IsType<string>(result));
    Assert.Equal(result, await Scalar(app, Rollback, id));
    Assert.Equal("original", await Scalar(app, "select live_build_id from decks where id=$1", id));
    Assert.Equal(2L, await Scalar(app, "select release_generation from decks where id=$1", id));
    Assert.Equal(1L, await Scalar(app, "select count(*) from content_rollback_actions"));
    Assert.Equal("pending", await Scalar(app, "select state from publish_manifest_delivery where job_id='original-job'"));
    Assert.Equal("developercards_app", await Scalar(app, "select actor_sub from content_rollback_actions"));
    var conflict = await Assert.ThrowsAsync<PostgresException>(() => Scalar(app, Rollback.Replace("repeat('c',64)", "repeat('d',64)"), id));
    Assert.Contains("IDEMPOTENCY_CONFLICT", conflict.MessageText);
    foreach (var sql in new[] { "update content_rollback_actions set reason='tampered'", "delete from content_rollback_actions" })
    {
      Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, (await Assert.ThrowsAsync<PostgresException>(() => Exec(app, sql))).SqlState);
      Assert.Contains("RELEASE_EVIDENCE_IMMUTABLE", (await Assert.ThrowsAsync<PostgresException>(() => Exec(admin, sql))).MessageText);
    }
    Assert.False((bool)(await Scalar(app, "select exists(select 1 from pg_class c,aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.content_rollback_actions'::regclass and a.grantee=0 and a.privilege_type='INSERT')"))!);
    Assert.False((bool)(await Scalar(app, "select exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.content_release_rollback(bigint,text,text,text,text,text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')"))!);
  }

  [Fact]
  public Task AlreadyInstalled059_RepairRestoresOnlyVerifiedOwner_AndRejectsMismatch() => WithLegacyOwner(async (app, admin) =>
  {
    await PostgresFixture.ApplyMigrationsAsync(app, 58);
    Assert.Equal("developercards_app", await Scalar(app, "select pg_get_userbyid(relowner) from pg_class where oid='public.decks'::regclass"));
    var migration59 = await File.ReadAllTextAsync(Path.Combine(MigrationDir, "059_publish_build_and_rollback_fencing.sql"));
    var denied59 = await Assert.ThrowsAsync<PostgresException>(() => Exec(app, migration59));
    Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, denied59.SqlState);
    // Model a privileged install of 059 while retaining the actual non-superuser function owner.
    await Exec(admin, migration59);
    var id = await SeedRollback(app);
    var denied = await Assert.ThrowsAsync<PostgresException>(() => Scalar(app, Rollback, id));
    Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, denied.SqlState);
    Assert.Equal("attempted", await Scalar(app, "select live_build_id from decks where id=$1", id));
    Assert.Equal(0L, await Scalar(app, "select count(*) from content_rollback_actions"));
    var before = Json(await MigrationDiagnostics.ReadAsync(app));
    Assert.False(before.GetProperty("rollback").GetProperty("ownerCanInsertLedger").GetBoolean());
    Assert.True(Table(before, "decks").GetProperty("canAlterAsCurrentRole").GetBoolean());
    await Exec(admin, "alter function public.content_release_rollback(bigint,text,text,text,text,text,text) owner to current_user");
    Assert.Contains("ROLLBACK_OWNER_MISMATCH", (await Assert.ThrowsAsync<PostgresException>(() => Repair(app))).MessageText);
    Assert.False((bool)(await Scalar(app, "select has_table_privilege(current_user,'public.content_rollback_actions','INSERT')"))!);
    await Exec(admin, "alter function public.content_release_rollback(bigint,text,text,text,text,text,text) owner to developercards_app");
    await Repair(app); await Repair(app);
    Assert.True(Json(await MigrationDiagnostics.ReadAsync(app)).GetProperty("rollback").GetProperty("ownerCanInsertLedger").GetBoolean());
    await VerifyRollback(app, admin, id);
  });

  [Fact]
  public Task RunnerRejectsMissingOrChangedRepair_AndRollsBack059WithItsGrant() => WithLegacyOwner(async (app, admin) =>
  {
    await PostgresFixture.ApplyMigrationsAsync(app, 58);
    var dir = Path.Combine(Path.GetTempPath(), "rollback-repair-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(dir);
    try
    {
      File.Copy(Path.Combine(MigrationDir, "059_publish_build_and_rollback_fencing.sql"), Path.Combine(dir, "059_publish_build_and_rollback_fencing.sql"));
      Migrate.MigrationsDirOverride.Value = dir;
      await Assert.ThrowsAsync<FileNotFoundException>(() => Migrate.RunMigrationsAsync(app, new Res("missing-repair"), false, null, null, null));
      var repairPath = Path.Combine(dir, "060_rollback_owner_permissions.sql");
      await File.WriteAllTextAsync(repairPath, "create table public.must_not_execute(id int);");
      var changed = await Assert.ThrowsAsync<InvalidOperationException>(() => Migrate.RunMigrationsAsync(app, new Res("changed-repair"), false, null, null, null));
      Assert.Contains("ROLLBACK_OWNER_REPAIR_HASH_MISMATCH", changed.Message);
      Assert.False((bool)(await Scalar(app, "select to_regclass('public.must_not_execute') is not null"))!);
      File.Copy(Path.Combine(MigrationDir, "060_rollback_owner_permissions.sql"), repairPath, true);
      // Failure after the grant proves repair and 059 remain in the same transaction.
      await File.AppendAllTextAsync(Path.Combine(dir, "059_publish_build_and_rollback_fencing.sql"), "\nselect 1/0;");
      Assert.Equal(PostgresErrorCodes.DivisionByZero, (await Assert.ThrowsAsync<PostgresException>(() => Migrate.RunMigrationsAsync(app, new Res("failed-059"), false, null, null, null))).SqlState);
      Assert.False((bool)(await Scalar(app, "select has_table_privilege(current_user,'public.content_rollback_actions','INSERT') or has_table_privilege(current_user,'public.content_rollback_actions','TRIGGER')"))!);
      Assert.Equal(0L, await Scalar(app, "select count(*) from schema_migrations where version in (59,60)"));
      Assert.False((bool)(await Scalar(app, "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='content_rollback_actions' and column_name='actor_sub')"))!);
    }
    finally { Migrate.MigrationsDirOverride.Value = null; Directory.Delete(dir, true); }
  });

  [Fact]
  public Task ProductionRunner_UpgradesRealLegacy51Through60_WithoutPrivilegedInstaller() => WithLegacyOwner(async (app, admin) =>
  {
    await PostgresFixture.ApplyMigrationsAsync(app, 51);
    foreach (var path in Directory.EnumerateFiles(MigrationDir, "*.sql"))
    {
      var name = Path.GetFileNameWithoutExtension(path); var version = int.Parse(name.Split('_')[0]);
      if (version <= 51) await Exec(app, "insert into schema_migrations(version,name) values($1,$2)", version, name);
    }
    var dry = await Migrate.RunMigrationsAsync(app, new Res("legacy-plan"), true, null, null, null);
    var plan = JsonDocument.Parse(dry.Body).RootElement.GetProperty("data");
    Assert.Equal(new[] { 52, 53, 55, 56, 57, 58, 59, 60 }, plan.GetProperty("pending").EnumerateArray().Select(x => x.GetProperty("version").GetInt32()));
    var applied = await Migrate.RunMigrationsAsync(app, new Res("legacy-upgrade"), false, null, "local-test", "local-test");
    Assert.Equal(200, applied.StatusCode);
    Assert.Equal(8, JsonDocument.Parse(applied.Body).RootElement.GetProperty("data").GetProperty("appliedCount").GetInt32());
    Assert.Equal(60, await Scalar(app, "select max(version) from schema_migrations"));
    var diagnostics = Json(await MigrationDiagnostics.ReadAsync(app));
    Assert.Equal("developercards_app", diagnostics.GetProperty("session").GetProperty("currentUser").GetString());
    Assert.Equal("developercards_app", diagnostics.GetProperty("session").GetProperty("sessionUser").GetString());
    Assert.False(diagnostics.GetProperty("session").GetProperty("vectorExtensionInstalled").GetBoolean());
    Assert.False(diagnostics.GetProperty("session").GetProperty("vectorTableExists").GetBoolean());
    Assert.True(diagnostics.GetProperty("rollback").GetProperty("ownerCanInsertLedger").GetBoolean());
    await VerifyRollback(app, admin, await SeedRollback(app));
    var retry = await Migrate.RunMigrationsAsync(app, new Res("legacy-retry"), false, null, null, null);
    Assert.Equal(0, JsonDocument.Parse(retry.Body).RootElement.GetProperty("data").GetProperty("appliedCount").GetInt32());
  });
}
