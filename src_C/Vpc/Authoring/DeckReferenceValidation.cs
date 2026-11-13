using System.Text.Json;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>A complete candidate inventory, including tombstones when available. JSON uses the existing authoring shapes.</summary>
public sealed record DeckReferenceCard(string StableUid, JsonElement? Teaching = null, JsonElement? Tags = null, bool Deleted = false);
public sealed record DeckReferenceError(string Code, string StableUid, string? ReferenceUid = null);
public sealed record DeckReferenceResult(IReadOnlyList<DeckReferenceError> Errors, bool Truncated)
{
  public bool IsValid => Errors.Count == 0 && !Truncated;
}

/// <summary>Pure publish-time validation; do not run against a partial draft/import batch.</summary>
public static class DeckReferenceValidation
{
  public const int MaxErrors = 100;
  // content/decks/FORMAT.md §5.1; deck mapping: mobile/src/features/domains/examDomains.ts.
  private static readonly HashSet<string> OfficialTasks = new(StringComparer.Ordinal)
  { "1.1", "1.2", "1.3", "2.1", "2.2", "3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3", "4.4" };

  public static DeckReferenceResult Validate(string deckSlug, IReadOnlyList<DeckReferenceCard> cards)
  {
    var errors = new List<DeckReferenceError>();
    var truncated = false;
    void Error(string code, string uid, string? reference = null)
    {
      if (errors.Count < MaxErrors) errors.Add(new(code, uid, reference));
      else truncated = true;
    }
    var index = new Dictionary<string, int>(StringComparer.Ordinal);
    for (var i = 0; i < cards.Count; i++)
    {
      var card = cards[i];
      if (string.IsNullOrWhiteSpace(card.StableUid)) Error("MISSING_UID", card.StableUid);
      else if (!index.TryAdd(card.StableUid, i)) Error("DUPLICATE_UID", card.StableUid);
    }
    var edges = new List<int>[cards.Count];
    var official = deckSlug is "aws-saa-c03" or "aws-saa-fundamentals";
    for (var i = 0; i < cards.Count; i++)
    {
      edges[i] = new List<int>();
      var card = cards[i];
      if (card.Deleted) continue;
      try
      {
        var tags = card.Tags is { } rawTags ? TagsValidation.Canonicalize(rawTags) : null;
        if (official && tags is not null)
        {
          using var parsed = JsonDocument.Parse(tags);
          var tag = parsed.RootElement;
          var domain = tag.TryGetProperty("domain", out var d) ? d.GetString() : null;
          var task = tag.TryGetProperty("examTask", out var t) ? t.GetString() : null;
          if (task is not null && !OfficialTasks.Contains(task)) Error("UNKNOWN_EXAM_TASK", card.StableUid);
          if (domain is null || task is null || task[0].ToString() != domain) Error("DOMAIN_TASK_MISMATCH", card.StableUid);
        }
      }
      catch (TranslationValidationError e) { Error(e.Code, card.StableUid); }
      try
      {
        var teaching = card.Teaching is { } rawTeaching ? TeachingValidation.Canonicalize(rawTeaching) : null;
        if (teaching is null) continue;
        using var parsed = JsonDocument.Parse(teaching);
        if (!parsed.RootElement.TryGetProperty("prerequisites", out var prerequisites)) continue;
        foreach (var item in prerequisites.EnumerateArray())
        {
          var uid = item.GetString()!;
          if (uid == card.StableUid) Error("SELF_REFERENCE", card.StableUid, uid);
          else if (!index.TryGetValue(uid, out var target)) Error("MISSING_PREREQUISITE", card.StableUid, uid);
          else if (cards[target].Deleted) Error("DELETED_PREREQUISITE", card.StableUid, uid);
          else edges[i].Add(target);
        }
      }
      catch (TranslationValidationError e) { Error(e.Code, card.StableUid); }
    }
    // An explicit DFS stack keeps a long valid chain off the call stack; each edge is visited once.
    var state = new byte[cards.Count];
    var stack = new Stack<(int Node, int Next)>();
    for (var root = 0; root < cards.Count; root++)
    {
      if (state[root] != 0 || cards[root].Deleted) continue;
      state[root] = 1;
      stack.Push((root, 0));
      while (stack.TryPop(out var frame))
      {
        if (frame.Next == edges[frame.Node].Count) { state[frame.Node] = 2; continue; }
        var target = edges[frame.Node][frame.Next];
        stack.Push((frame.Node, frame.Next + 1));
        if (state[target] == 1) Error("PREREQUISITE_CYCLE", cards[frame.Node].StableUid, cards[target].StableUid);
        else if (state[target] == 0) { state[target] = 1; stack.Push((target, 0)); }
      }
    }
    return new(errors, truncated);
  }
}
