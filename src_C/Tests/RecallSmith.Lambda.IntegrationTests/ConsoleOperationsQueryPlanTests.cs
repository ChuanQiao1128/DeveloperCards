using Npgsql;
using RecallSmith.Lambda.Db;
namespace RecallSmith.Lambda.IntegrationTests;
[Collection(PostgresCollection.Name)]
public class ConsoleOperationsQueryPlanTests(PostgresFixture db, Xunit.Abstractions.ITestOutputHelper output)
{
  [Fact] public async Task Isolated_10k_directory_plans_with_and_without_exact_collation_index()
  {
    var name="ops_plans_"+Guid.NewGuid().ToString("N");var cs=await db.CreateScratchDatabaseAsync(name);
    try
    {
      await using(var conn=new NpgsqlConnection(cs))
      {
        await conn.OpenAsync();await PostgresFixture.ApplyMigrationsAsync(conn,int.MaxValue);
        var migration=await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory,"Db","Migrations","061_console_learner_read_indexes.sql"));
        await DbUtil.ExecuteAsync(conn,null,migration,[]);
        Assert.Equal("CREATE INDEX idx_users_sub_c ON public.users USING btree (user_sub COLLATE \"C\")",await DbUtil.ExecuteScalarAsync(conn,null,"select pg_get_indexdef('public.idx_users_sub_c'::regclass)",[]));
        await DbUtil.ExecuteAsync(conn,null,"drop index idx_users_sub_c;create index idx_users_sub_c on users(email)",[]);
        var mismatch=await Assert.ThrowsAsync<PostgresException>(()=>DbUtil.ExecuteAsync(conn,null,migration,[]));Assert.Contains("CONSOLE_LEARNER_INDEX_DEFINITION_MISMATCH",mismatch.MessageText);
        await DbUtil.ExecuteAsync(conn,null,"drop index idx_users_sub_c",[]);
        await DbUtil.ExecuteAsync(conn,null,"""
          insert into users(user_sub,email,created_at)
          select '00000000-0000-0000-0000-'||lpad(n::text,12,'0'),'learner'||lpad(n::text,5,'0')||'@example.test','2026-01-01T00:00:00Z'::timestamptz
          from generate_series(1,10000)n;
          analyze users;
          """,[]);
        output.WriteLine("Deterministic isolated users: 10000; actual handler query shape. No live performance claim.");
        foreach(var indexed in new[]{false,true})
        {
          if(indexed)await DbUtil.ExecuteAsync(conn,null,"create index idx_users_sub_c on users(user_sub COLLATE \"C\");analyze users",[]);
          foreach(var (label,after,pattern) in new[]{("empty-first","","%%"),("common-prefix","","%learner009%"),("empty-after-5000","00000000-0000-0000-0000-000000005000","%%")})
          {
            output.WriteLine($"INDEX={indexed}; CASE={label}");
            var plan=await DbUtil.QueryAsync(conn,null,"""
              explain(analyze,buffers) select user_sub,email,created_at,last_seen_at,last_platform,last_version from users
              where created_at<=$1 and user_sub COLLATE "C">$2 COLLATE "C" and(user_sub ilike $3 escape '\' or email ilike $3 escape '\')
              order by user_sub COLLATE "C" limit $4
              """,[new DateTime(2026,11,16,0,0,0,DateTimeKind.Utc),after,pattern,26]);
            foreach(var row in plan)output.WriteLine(Convert.ToString(row["QUERY PLAN"]));Assert.NotEmpty(plan);
          }
        }
      }
    }
    finally {await db.QueryAsync($"drop database if exists {name} with(force)");}
  }
}
