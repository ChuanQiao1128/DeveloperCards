using System.Collections.Concurrent;
using System.Diagnostics;
using Npgsql;

namespace RecallSmith.Lambda.Common;

/// <summary>One cooperative deadline for the whole online invocation. Workers and maintenance do not mount it.</summary>
public sealed class RequestBudget : IDisposable
{
  public static readonly TimeSpan OnlineLimit = TimeSpan.FromSeconds(25);
  private static readonly AsyncLocal<RequestBudget?> Ambient = new();
  private readonly RequestBudget? _previous;
  private readonly CancellationTokenSource _deadline;
  private readonly ConcurrentBag<CancellationTokenSource> _linked = new();
  private readonly long _started = Stopwatch.GetTimestamp();
  private readonly TimeSpan _duration;
  public static CancellationToken Token => Ambient.Value?._deadline.Token ?? CancellationToken.None;
  public static bool Expired => Token.IsCancellationRequested;

  private RequestBudget(TimeSpan duration)
  {
    _previous = Ambient.Value;
    _duration = duration > TimeSpan.Zero ? duration : TimeSpan.Zero;
    _deadline = new CancellationTokenSource();
    _deadline.CancelAfter(_duration);
    if (_duration == TimeSpan.Zero) _deadline.Cancel();
    Ambient.Value = this;
  }

  public static RequestBudget BeginOnline(TimeSpan? lambdaRemaining = null)
  {
    var duration = lambdaRemaining is { } remaining ? remaining - TimeSpan.FromMilliseconds(500) : OnlineLimit;
    return new RequestBudget(duration < OnlineLimit ? duration : OnlineLimit);
  }

  public static CancellationToken Combine(CancellationToken caller)
  {
    var scope = Ambient.Value;
    if (scope is null) return caller;
    if (!caller.CanBeCanceled || caller == scope._deadline.Token) return scope._deadline.Token;
    var linked = CancellationTokenSource.CreateLinkedTokenSource(caller, scope._deadline.Token);
    scope._linked.Add(linked);
    return linked.Token;
  }

  public static NpgsqlCommand Command(NpgsqlCommand command)
  {
    var scope = Ambient.Value;
    if (scope is null) return command;
    Token.ThrowIfCancellationRequested();
    var seconds = Math.Max(1, (int)Math.Ceiling((scope._duration - Stopwatch.GetElapsedTime(scope._started)).TotalSeconds));
    command.CommandTimeout = command.CommandTimeout == 0 ? seconds : Math.Min(command.CommandTimeout, seconds);
    return command;
  }

  public void Dispose()
  {
    Ambient.Value = _previous;
    foreach (var linked in _linked) linked.Dispose();
    _deadline.Dispose();
  }
}
