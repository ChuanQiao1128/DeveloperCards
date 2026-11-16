using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Operations;
using static RecallSmith.Lambda.IntegrationTests.ConsoleOperationsCanaryTests;
namespace RecallSmith.Lambda.IntegrationTests;
[Collection(PostgresCollection.Name)]
public class ConsoleOperationsPrivilegeTests(PostgresFixture db)
{
  [Fact] public async Task Separate_local_login_with_existing_read_audit_grants_then_revoked_audit_is_closed()
  {
    var scratch="ops_privilege_"+Guid.NewGuid().ToString("N");var role="ops_reader_"+Guid.NewGuid().ToString("N");var cs=await db.CreateScratchDatabaseAsync(scratch);
    var names=new[]{"PGDATABASE","PGUSER","PGPASSWORD"};var prior=names.ToDictionary(n=>n,Environment.GetEnvironmentVariable);
    try
    {
      await using(var owner=new NpgsqlConnection(cs))
      {
        await owner.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(owner,int.MaxValue);
        await DbUtil.ExecuteAsync(owner,null,$"""
          create role {role} login password 'local-test-only' nosuperuser nocreatedb nocreaterole;
          grant usage on schema public to {role};
          grant select on users,user_entitlements,user_premium_state,user_progress_events,user_progress,deck_publishes,content_review_receipts to {role};
          grant select,insert on admin_audit to {role};
          grant usage,select on sequence admin_audit_id_seq to {role};
          insert into users(user_sub) values('local-observed');
          """,[]);
      }
      Environment.SetEnvironmentVariable("PGDATABASE",scratch);Environment.SetEnvironmentVariable("PGUSER",role);Environment.SetEnvironmentVariable("PGPASSWORD","local-test-only");Pg.Reset();
      await using(var runtime=await Pg.OpenConnectionOrNullAsync())Assert.Equal(role,await DbUtil.ExecuteScalarAsync(runtime!,null,"select session_user",[]));
      foreach(var response in new[]{await ConsoleOperations.HandleLearners(Request(),new Res("privilege-list"),Admin),await ConsoleOperations.HandleLearner(Request(ConsoleOperations.LearnersPath+"/local-observed"),new Res("privilege-detail"),Admin),await ConsoleOperations.HandleOverview(Request(ConsoleOperations.OverviewPath),new Res("privilege-overview"),Admin)})Assert.Equal(200,response.StatusCode);
      await using(var owner=new NpgsqlConnection(cs))
      {await owner.OpenAsync();await DbUtil.ExecuteAsync(owner,null,$"revoke insert on admin_audit from {role}",[]);}
      Assert.Equal(503,(await ConsoleOperations.HandleLearners(Request(),new Res("revoked-audit"),Admin)).StatusCode);
    }
    finally
    {
      foreach(var pair in prior)Environment.SetEnvironmentVariable(pair.Key,pair.Value);Pg.Reset();
      await db.QueryAsync($"drop database if exists {scratch} with(force)");await db.QueryAsync($"drop role if exists {role}");
    }
  }
}
