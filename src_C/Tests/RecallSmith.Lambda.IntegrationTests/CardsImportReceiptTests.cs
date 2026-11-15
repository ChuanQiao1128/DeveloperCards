using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class CardsImportReceiptTests(PostgresFixture db)
{
  private static readonly AuthContext Admin = AutomationTestKit.Ctx("receipt-admin", agent: false);
  private static object Body(long deckId, string operationId, string question = "Question") => new { deckId, operationId,
    cards = new[] { new { stableUid = "a", orderInDeck = 1, expectedVersion = 0, question, explanation = "Answer", difficulty = 2 } } };
  private static Task<APIGatewayProxyResponse> Lookup(object body, AuthContext? auth = null) =>
    AutomationTestKit.CallAsync(CardsImportReceipt.Handle, "POST", "/api/v1/authoring/cards/import/receipt", body, auth ?? Admin);
  private static Task<APIGatewayProxyResponse> Import(object body, AuthContext? auth = null) =>
    AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", "/api/v1/authoring/cards/import", body, auth ?? Admin);
  private static JsonElement Data(APIGatewayProxyResponse response) => JsonDocument.Parse(response.Body).RootElement.GetProperty("data");

  [Fact]
  public async Task LostResponse_LookupThenReplay_WritesOnce_RejectsChangedBodyAndIsolatesAccount()
  {
    var id = (await AutomationTestKit.NewDeckAsync(db, "receipt-recovery")).Id;
    var operation = Guid.NewGuid().ToString(); var body = Body(id, operation);
    Assert.False(Data(await Lookup(body)).GetProperty("found").GetBoolean());
    var committed = await Import(body); Assert.Equal(200, committed.StatusCode);
    var found = await Lookup(body); Assert.Equal(200, found.StatusCode);
    Assert.True(Data(found).GetProperty("found").GetBoolean());
    Assert.Equal(1, Data(found).GetProperty("result").GetProperty("created").GetInt32());
    Assert.Equal(committed.Body, (await Import(body)).Body);
    Assert.Equal(409, (await Lookup(Body(id, operation, "Changed"))).StatusCode);
    Assert.False(Data(await Lookup(body, Admin with { UserSub = "another-admin" })).GetProperty("found").GetBoolean());
    Assert.Equal(403, (await Lookup(body, Admin with { IsAgentClient = true })).StatusCode);
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from cards where deck_id=$1", id)));
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select version from cards where deck_id=$1", id)));
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from content_release_actions where deck_id=$1", id)));
  }

  [Fact]
  public async Task Receipt_IsRoutedByVpcFunction_WithoutChangingControlledPolicyScope()
  {
    var id = (await AutomationTestKit.NewDeckAsync(db, "receipt-route")).Id;
    var request = JsonSerializer.SerializeToElement(new {
      rawPath = "/api/v1/authoring/cards/import/receipt",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" },
        authorizer = new { jwt = new { claims = new Dictionary<string, object> { ["sub"] = Admin.UserSub!, ["cognito:groups"] = new[] { "super_admin" } } } } },
      headers = new Dictionary<string, string>(), queryStringParameters = new Dictionary<string, string>(),
      body = JsonSerializer.Serialize(Body(id, Guid.NewGuid().ToString())), isBase64Encoded = false
    });
    var response = await new RecallSmith.Lambda.VpcFunction().Handler(request);
    Assert.Equal(200, response.StatusCode);
    Assert.False(Data(response).GetProperty("found").GetBoolean());
    await db.QueryAsync("update decks set slug=$2 where id=$1", id, ContentRelease.DeckSlug);
    Assert.Equal(400, (await Lookup(Body(id, Guid.NewGuid().ToString()))).StatusCode);
  }

  private async Task WaitForLock(string queryPart)
  {
    for (var i = 0; i < 100; i++)
    {
      if (await db.ScalarAsync("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and datname=current_database() and query like $1)", "%" + queryPart + "%") is true) return;
      await Task.Delay(20);
    }
    Assert.Fail("Expected actual PostgreSQL lock wait: " + queryPart);
  }

  [Fact]
  public async Task Lookup_WaitsForConcurrentImportCommit_BeforeAnsweringAbsence()
  {
    var id = (await AutomationTestKit.NewDeckAsync(db, "receipt-concurrent")).Id;
    var body = Body(id, Guid.NewGuid().ToString());
    await using var gate = await db.OpenAsync();
    await DbUtil.ExecuteAsync(gate, null, $"""
      create function receipt_test_gate() returns trigger language plpgsql as $$ begin
        if NEW.deck_id={id} then perform pg_advisory_xact_lock(74116,{id}::int); end if; return NEW; end $$;
      create trigger receipt_test_gate before insert on cards for each row execute function receipt_test_gate();
      """, []);
    await DbUtil.ExecuteAsync(gate, null, "select pg_advisory_lock(74116,$1::int)", [id]);
    Task<APIGatewayProxyResponse>? importing = null, lookup = null;
    try
    {
      importing = Import(body);
      await WaitForLock("insert into cards");
      lookup = Lookup(body);
      await WaitForLock("for no key update");
      Assert.False(lookup.IsCompleted);
      await DbUtil.ExecuteAsync(gate, null, "select pg_advisory_unlock(74116,$1::int)", [id]);
      Assert.Equal(200, (await importing).StatusCode);
      Assert.True(Data(await lookup).GetProperty("found").GetBoolean());
    }
    finally
    {
      await DbUtil.ExecuteAsync(gate, null, "select pg_advisory_unlock_all()", []);
      if (importing is not null) await importing;
      if (lookup is not null) await lookup;
      await DbUtil.ExecuteAsync(gate, null, "drop trigger receipt_test_gate on cards; drop function receipt_test_gate()", []);
    }
  }

  [Fact]
  public async Task PermissionRevokedWhileLookupWaits_IsCheckedAfterLock()
  {
    var id = (await AutomationTestKit.NewDeckAsync(db, "receipt-revoked")).Id;
    var editor = Admin with { UserSub = "receipt-editor", IsSuperAdmin = false, IsEditor = true, Groups = ["editor"] };
    await db.QueryAsync("insert into admin_deck_permissions(admin_sub,deck_id,can_read,can_write) values($1,$2,1,1)", editor.UserSub, id);
    await using var conn = await db.OpenAsync(); await using var tx = await conn.BeginTransactionAsync();
    await DbUtil.QueryAsync(conn, tx, "select id from decks where id=$1 for no key update", [id]);
    var lookup = Lookup(Body(id, Guid.NewGuid().ToString()), editor);
    await WaitForLock("for no key update");
    await db.QueryAsync("update admin_deck_permissions set can_write=0 where admin_sub=$1 and deck_id=$2", editor.UserSub, id);
    await tx.CommitAsync();
    Assert.Equal(403, (await lookup).StatusCode);
  }
}
