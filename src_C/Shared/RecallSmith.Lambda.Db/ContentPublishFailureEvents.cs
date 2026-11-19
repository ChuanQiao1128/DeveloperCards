using System.Globalization;
using System.Text.Json;
using Amazon.SQS;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Db;

/// <summary>Failure wake-ups for one job. Notify SQS owns delivery/retries; no database sweep.</summary>
public static class ContentPublishFailureEvents
{
  public const string SinceEnv = "CONTENT_PUBLISH_ALERTS_SINCE";
  public const string EventType = "content_publish_failure";
  public static DateTimeOffset? Since => DateTimeOffset.TryParse(
    Environment.GetEnvironmentVariable(SinceEnv), CultureInfo.InvariantCulture,
    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var since) ? since : null;
  internal static Func<SendMessageRequest, Task>? TestSendSeam;
  private static AmazonSQSClient? _sqs;

  public static async Task EnqueueAsync(string jobId, string stage, int delaySeconds = 0)
  {
    if (Since is null) return;
    await EnqueueEventAsync(jobId, EventType, stage, delaySeconds);
  }

  internal static async Task EnqueueEventAsync(string jobId, string eventType, string stage, int delaySeconds)
  {
    var queue = Environment.GetEnvironmentVariable("AUTOMATION_NOTIFY_QUEUE_URL");
    try
    {
      if (string.IsNullOrWhiteSpace(queue)) throw new InvalidOperationException("Missing AUTOMATION_NOTIFY_QUEUE_URL");
      var request = new SendMessageRequest { QueueUrl = queue, DelaySeconds = delaySeconds,
        MessageBody = JsonSerializer.Serialize(new { v = 1, eventType, jobId, stage }) };
      using var deadline = CancellationTokenSource.CreateLinkedTokenSource(RequestBudget.Token);
      deadline.CancelAfter(TimeSpan.FromSeconds(5));
      if (TestSendSeam is { } send) await send(request).WaitAsync(deadline.Token);
      else await (_sqs ??= new AmazonSQSClient(WebhookEvents.BoundedSqsConfig())).SendMessageAsync(request, deadline.Token);
      Log.Event("info", new { tag = "content-publish-event", jobId, stage, delaySeconds, outcome = "enqueued" });
    }
    catch
    {
      RouteMetrics.EmitGauge("AutomationNotifyEnqueueFailures", 1);
      Log.Event("warn", new { tag = "content-publish-event", jobId, stage, outcome = "enqueue_failed" });
      throw; // The source operation must retain its retry/DLQ path rather than acknowledge a lost alert.
    }
  }
}
