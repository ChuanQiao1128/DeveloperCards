using System.Text.Json;
using System.Text.Json.Nodes;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>Build a fresh ordinary import from current preview versions. Guard regressions send raw bodies instead.</summary>
internal static class GenericImportTestKit
{
  public static async Task<string> JsonAsync(long deckId, object[] cards)
  {
    var body = JsonSerializer.SerializeToNode(new { deckId, operationId = Guid.NewGuid().ToString("D"), cards })!;
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    var rows = await DbUtil.QueryAsync(conn!, null, "select stable_uid,version from cards where deck_id=$1 and is_deleted=0", [deckId]);
    var versions = rows.ToDictionary(r => (string)r["stable_uid"]!, r => Convert.ToInt64(r["version"]));
    foreach (var card in body["cards"]!.AsArray())
    {
      if (card is not JsonObject item || item.ContainsKey("expectedVersion")) continue;
      var uid = item["stableUid"]?.ToString();
      item["expectedVersion"] = uid is not null && versions.TryGetValue(uid, out var version) ? version : 0L;
    }
    return body.ToJsonString();
  }
}
