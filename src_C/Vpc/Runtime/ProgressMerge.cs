namespace RecallSmith.Lambda.Vpc.Runtime;

// Algebra of the production SQL over a fixed legacy baseline and disjoint
// accepted event sets. Dedupe supplies idempotence before counts are added.
// A review's entire scheduling snapshot shares (timestamp, UUID) ordering.
public readonly record struct ProgressState(
  int Status,
  int ReviewCount,
  int? LastRating,
  long LastReviewedAtMs,
  long DueAtMs,
  int LastSeenRevision,
  int? SrsStage = null,
  string? LastReviewEventId = null,
  string? SchedulerState = null,
  string? SchedulerVersion = null);

public static class ProgressMerge
{
  public static ProgressState Merge(ProgressState current, ProgressState incoming)
  {
    var incomingWins = CompareRecency(incoming, current) > 0;
    return new ProgressState(
      Math.Max(current.Status, incoming.Status),
      current.ReviewCount + incoming.ReviewCount,
      incomingWins ? incoming.LastRating : current.LastRating,
      Math.Max(current.LastReviewedAtMs, incoming.LastReviewedAtMs),
      incomingWins ? incoming.DueAtMs : current.DueAtMs,
      Math.Max(current.LastSeenRevision, incoming.LastSeenRevision),
      incomingWins ? incoming.SrsStage : current.SrsStage,
      incomingWins ? incoming.LastReviewEventId : current.LastReviewEventId,
      incomingWins ? incoming.SchedulerState : current.SchedulerState,
      incomingWins ? incoming.SchedulerVersion : current.SchedulerVersion);
  }

  private static int CompareRecency(ProgressState a, ProgressState b) =>
    a.LastReviewedAtMs != b.LastReviewedAtMs
      ? a.LastReviewedAtMs.CompareTo(b.LastReviewedAtMs)
      // Canonical UUID text has the same byte order as PostgreSQL uuid.
      : StringComparer.Ordinal.Compare(a.LastReviewEventId?.ToLowerInvariant(), b.LastReviewEventId?.ToLowerInvariant());
}
