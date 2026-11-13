namespace RecallSmith.Lambda.Db;

/// <summary>Complete export inventory, plus tombstones; JSON parsing remains at each producer's existing boundary.</summary>
public sealed record CandidateDeckCard(string StableUid, IReadOnlyList<string>? Prerequisites = null, string? Domain = null, string? ExamTask = null, bool Deleted = false);
public sealed record DeckReferenceError(string Code, string StableUid, string? ReferenceUid = null);
public sealed record DeckReferenceResult(IReadOnlyList<DeckReferenceError> Errors, bool Truncated)
{
  public bool IsValid => Errors.Count == 0 && !Truncated;
}

/// <summary>Shared publish/worker graph and official task rules; no database, I/O, or recursion.</summary>
public static class CandidateDeckValidation
{
  public const int MaxErrors = 100;
  // content/decks/FORMAT.md §5.1; deck mapping: mobile/src/features/domains/examDomains.ts.
  private static readonly HashSet<string> OfficialTasks = new(StringComparer.Ordinal)
  { "1.1", "1.2", "1.3", "2.1", "2.2", "3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3", "4.4" };

  public static DeckReferenceResult Validate(string deckSlug, IReadOnlyList<CandidateDeckCard> cards)
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
      if (official && (card.Domain is not null || card.ExamTask is not null))
      {
        if (card.ExamTask is not null && !OfficialTasks.Contains(card.ExamTask)) Error("UNKNOWN_EXAM_TASK", card.StableUid);
        if (card.Domain is null || string.IsNullOrEmpty(card.ExamTask) || card.ExamTask[0].ToString() != card.Domain) Error("DOMAIN_TASK_MISMATCH", card.StableUid);
      }
      foreach (var uid in card.Prerequisites ?? Array.Empty<string>())
      {
        if (uid == card.StableUid) Error("SELF_REFERENCE", card.StableUid, uid);
        else if (!index.TryGetValue(uid, out var target)) Error("MISSING_PREREQUISITE", card.StableUid, uid);
        else if (cards[target].Deleted) Error("DELETED_PREREQUISITE", card.StableUid, uid);
        else edges[i].Add(target);
      }
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
