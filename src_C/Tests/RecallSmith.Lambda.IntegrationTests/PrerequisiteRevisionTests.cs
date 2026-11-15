using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class PrerequisiteRevisionTests(PostgresFixture db)
{
  [Fact]
  public async Task NavigationOnly_PreservesUidAndLearningRevision_ButInvalidatesReviewAndPublishSnapshots()
  {
    var cs = await db.CreateScratchDatabaseAsync("navigation_revision_" + Guid.NewGuid().ToString("N"));
    await using var conn = new NpgsqlConnection(cs); await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
    var deck = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into decks(slug,title,author) values('aws-saa-fundamentals','AWS','tests') returning id", []));
    var id = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation,revision,teaching) values($1,'a',1,'Q','A',7,'{\"schema\":\"teaching-v1\",\"answer\":\"A\",\"keyPoint\":\"K\",\"mustAnswer\":[\"A\"],\"prerequisites\":[]}'::jsonb) returning id", [deck]));
    await DbUtil.ExecuteAsync(conn, null, "insert into cards(deck_id,stable_uid,order_in_deck,question,explanation) values($1,'b',2,'Foundation','Mechanism')", [deck]);
    async Task<long> Revision() => Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select revision from cards where id=$1", [id]));
    async Task<string> Editing() => await ContentRelease.EditingSnapshot(conn, null, deck);
    async Task<string> Hash() => CardContentHash.Compute((await DbUtil.QueryAsync(conn, null, $"select {CardContentHash.CardColumnsSql} from cards c where id=$1", [id])).Single());
    async Task<string> Published() => PublishSnapshot.Digest((await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deck])).Select(PublishSnapshot.FromRow));
    var editing = await Editing(); var hash = await Hash(); var published = await Published();
    await DbUtil.ExecuteAsync(conn, null, "update cards set teaching=jsonb_set(teaching,'{prerequisites}','[\"b\"]'::jsonb),order_in_deck=3 where id=$1", [id]);
    Assert.Equal(7, await Revision());
    Assert.Equal("a", await DbUtil.ExecuteScalarAsync(conn, null, "select stable_uid from cards where id=$1", [id]));
    Assert.NotEqual(editing, await Editing()); Assert.NotEqual(hash, await Hash()); Assert.NotEqual(published, await Published());
    foreach (var assignment in new[] { "question='Changed question'", "explanation='Changed answer'", "teaching=jsonb_set(teaching,'{mustAnswer}','[\"Changed scoring\"]'::jsonb)", "teaching=jsonb_set(teaching,'{answer}','\"Changed conclusion\"'::jsonb)" })
    {
      var before = await Revision();
      await DbUtil.ExecuteAsync(conn, null, $"update cards set {assignment} where id=$1", [id]);
      Assert.Equal(before + 1, await Revision());
    }
    var immutable = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null, "update cards set stable_uid='changed' where id=$1", [id]));
    Assert.Equal("RELEASE_UID_IMMUTABLE", immutable.MessageText);
  }
}
