using System.Text.Json;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public sealed record DeckReferenceCard(string StableUid, JsonElement? Teaching = null, JsonElement? Tags = null, bool Deleted = false);

/// <summary>Existing authoring canonicalizers adapt complete candidates to the shared publish/worker graph rules.</summary>
public static class DeckReferenceValidation
{
  public const int MaxErrors = CandidateDeckValidation.MaxErrors;
  public static DeckReferenceResult Validate(string deckSlug, IReadOnlyList<DeckReferenceCard> cards)
  {
    var shapeErrors = new List<DeckReferenceError>();
    var candidates = new List<CandidateDeckCard>(cards.Count);
    var truncated = false;
    foreach (var card in cards)
    {
      string? teaching = null, tags = null;
      if (!card.Deleted)
      {
        try { tags = card.Tags is { } t ? TagsValidation.Canonicalize(t) : null; }
        catch (TranslationValidationError error) { Add(error.Code, card.StableUid); }
        try { teaching = card.Teaching is { } t ? TeachingValidation.Canonicalize(t) : null; }
        catch (TranslationValidationError error) { Add(error.Code, card.StableUid); }
      }
      using var parsedTeaching = teaching is null ? null : JsonDocument.Parse(teaching);
      using var parsedTags = tags is null ? null : JsonDocument.Parse(tags);
      var prerequisites = parsedTeaching?.RootElement.TryGetProperty("prerequisites", out var refs) == true ? refs.EnumerateArray().Select(r => r.GetString()!).ToArray() : null;
      var domain = parsedTags?.RootElement.TryGetProperty("domain", out var d) == true ? d.GetString() : null;
      var task = parsedTags?.RootElement.TryGetProperty("examTask", out var tsk) == true ? tsk.GetString() : null;
      candidates.Add(new(card.StableUid, prerequisites, domain, task, card.Deleted));
    }
    var graph = CandidateDeckValidation.Validate(deckSlug, candidates);
    var all = graph.Errors.Concat(shapeErrors).ToArray();
    return new(all.Take(MaxErrors).ToArray(), truncated || graph.Truncated || all.Length > MaxErrors);
    void Add(string code, string uid)
    {
      if (shapeErrors.Count < MaxErrors) shapeErrors.Add(new(code, uid)); else truncated = true;
    }
  }
}
