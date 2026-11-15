using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class GuardedCardWritesTests(PostgresFixture db)
{
  private static readonly AuthContext Admin = AutomationTestKit.Ctx("guarded-write-admin", agent: false);
  private static Task<APIGatewayProxyResponse> Put(object body, AuthContext auth) =>
    AutomationTestKit.CallAsync(Cards.HandleAuthoringCards, "PUT", "/api/v1/authoring/cards", body, auth);
  private async Task<(long A, long B, long Card, AuthContext Editor)> Setup()
  {
    var a = (await AutomationTestKit.NewDeckAsync(db, "guard-write-a")).Id;
    var b = (await AutomationTestKit.NewDeckAsync(db, "guard-write-b")).Id;
    var card = Convert.ToInt64(await db.ScalarAsync("insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,difficulty) values($1,'guarded',1,'original','answer',2) returning id", a));
    var editor = Admin with { UserSub = "guard-write-editor-" + Guid.NewGuid(), IsSuperAdmin = false, IsEditor = true, Groups = ["editor"] };
    await db.QueryAsync("insert into admin_deck_permissions(admin_sub,deck_id,can_read,can_write) values($1,$2,1,1)", editor.UserSub, a);
    return (a, b, card, editor);
  }
  private async Task WaitForLocks(int count)
  {
    for (var n = 0; n < 150; n++)
    {
      if (Convert.ToInt64(await db.ScalarAsync("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()")) >= count) return;
      await Task.Delay(20);
    }
    Assert.Fail($"Expected {count} PostgreSQL lock waits");
  }
  private async Task<Dictionary<string, object?>> Row(long card) => Assert.Single(await db.QueryAsync("select deck_id,question,version from cards where id=$1", card));

  [Fact]
  public async Task AnticipatedVersion_ConcurrentMove_CannotWriteNewUnauthorizedDeck()
  {
    var s = await Setup();
    await using var conn = await db.OpenAsync(); await using var tx = await conn.BeginTransactionAsync();
    await DbUtil.ExecuteAsync(conn, tx, "lock table admin_deck_permissions in access exclusive mode", []);
    var pending = Put(new { id = s.Card, expectedVersion = 2, question = "unauthorized" }, s.Editor);
    await WaitForLocks(1); // The editor has resolved A and is waiting at the permission read.
    var move = Put(new { id = s.Card, expectedVersion = 1, deckId = s.B }, Admin);
    // Legacy code lets the move finish; fixed code holds A/card until permission/CAS resolves.
    for (var n = 0; n < 150 && !move.IsCompleted; n++)
    {
      var waits = Convert.ToInt64(await db.ScalarAsync("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()"));
      if (waits >= 2) break;
      await Task.Delay(20);
    }
    await tx.CommitAsync();
    Assert.Equal(200, (await move).StatusCode);
    Assert.Equal(409, (await pending).StatusCode);
    var row = await Row(s.Card);
    Assert.Equal(s.B, Convert.ToInt64(row["deck_id"])); Assert.Equal("original", row["question"]); Assert.Equal(2L, Convert.ToInt64(row["version"]));
  }

  [Fact]
  public async Task PermissionRevoked_WhileWaitingForCard_CannotWrite()
  {
    var s = await Setup();
    await using var conn = await db.OpenAsync(); await using var tx = await conn.BeginTransactionAsync();
    await DbUtil.QueryAsync(conn, tx, "select id from cards where id=$1 for update", [s.Card]);
    var pending = Put(new { id = s.Card, expectedVersion = 1, question = "unauthorized" }, s.Editor);
    await WaitForLocks(1);
    await db.QueryAsync("update admin_deck_permissions set can_write=0 where admin_sub=$1 and deck_id=$2", s.Editor.UserSub, s.A);
    await tx.CommitAsync();
    Assert.Equal(403, (await pending).StatusCode);
    var row = await Row(s.Card); Assert.Equal("original", row["question"]); Assert.Equal(1L, Convert.ToInt64(row["version"]));
  }

  [Fact]
  public async Task AuthorizedEdit_Succeeds_AndForgedDeckIdDoesNotAuthorizeAnotherCard()
  {
    var s = await Setup();
    Assert.Equal(200, (await Put(new { id = s.Card, expectedVersion = 1, question = "authorized" }, s.Editor)).StatusCode);
    Assert.Equal(200, (await Put(new { id = s.Card, expectedVersion = 2, deckId = s.B }, Admin)).StatusCode);
    Assert.Equal(403, (await Put(new { id = s.Card, expectedVersion = 3, deckId = s.A, question = "forged" }, s.Editor)).StatusCode);
    var row = await Row(s.Card); Assert.Equal("authorized", row["question"]); Assert.Equal(s.B, Convert.ToInt64(row["deck_id"])); Assert.Equal(3L, Convert.ToInt64(row["version"]));
  }
}
