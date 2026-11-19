using System.Text.Json;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Content;

/// <summary>
/// 内容分发文件（deck.json / package.json / chunks / patches）的统一序列化配置。
/// 必须与 S3DeckUploader 写 deck.json 的配置完全一致：camelCase、不缩进。
/// </summary>
public static class ContentJson
{
  public static readonly JsonSerializerOptions Options = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false
  };

  public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

  internal static async Task VerifyReviewedArtifactAsync(Stream file, DeckExportData expected)
  {
    DeckExportData? actual;
    try { actual = await JsonSerializer.DeserializeAsync<DeckExportData>(file, Options); }
    catch (JsonException) { throw new BusinessException("RELEASE_ARTIFACT_INVALID: deck.json did not deserialize"); }

    if (actual is null || actual.Slug != expected.Slug || actual.Version != expected.Version ||
        actual.Title != expected.Title || actual.Locale != expected.Locale || actual.DeckType != expected.DeckType ||
        actual.TotalCards != expected.TotalCards || actual.Cards?.Count != expected.Cards.Count)
      throw new BusinessException("RELEASE_ARTIFACT_MISMATCH: deck identity or card count differs");

    for (var i = 0; i < expected.Cards.Count; i++)
    {
      var card = actual.Cards![i];
      var reviewed = expected.Cards[i];
      if (card is null ||
          (card.StableUid, card.OrderInDeck, card.Revision, card.Difficulty, card.Question, card.Explanation,
            card.CodeLanguage, card.CodeSnippet, card.RealWorldUsage, card.Topic) !=
          (reviewed.StableUid, reviewed.OrderInDeck, reviewed.Revision, reviewed.Difficulty, reviewed.Question, reviewed.Explanation,
            reviewed.CodeLanguage, reviewed.CodeSnippet, reviewed.RealWorldUsage, reviewed.Topic) ||
          !EqualJson(card.Mcq, reviewed.Mcq) || !EqualJson(card.Source, reviewed.Source) ||
          !EqualJson(card.Translations, reviewed.Translations) || !EqualJson(card.FrontHelp, reviewed.FrontHelp) ||
          !EqualJson(card.Teaching, reviewed.Teaching) || !EqualJson(card.Tags, reviewed.Tags))
        throw new BusinessException("RELEASE_ARTIFACT_MISMATCH: serialized cards differ from the reviewed export");
    }
  }

  private static bool EqualJson(JsonElement? left, JsonElement? right) =>
    left is { } a && right is { } b ? JsonElement.DeepEquals(a, b) : left is null && right is null;
}
