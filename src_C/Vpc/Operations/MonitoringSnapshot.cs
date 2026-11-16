using System.Text.Json;
namespace RecallSmith.Lambda.Vpc.Operations;

public static partial class ConsoleOperations
{
  public const string SnapshotKey = "ops/console-monitor/v1/current.json";
  private static readonly string[] CheckNames = ["api-health", "cdn-manifest", "cdn-deck", "console-index", "api-auth-guard", "api-sync-guard", "remote-config", "cognito-console", "cognito-mobile"];
  public sealed record SnapshotViews(Dictionary<string,object?> Synthetic, Dictionary<string,object?> Alarms);
  private static SnapshotViews UnknownSnapshot(DateTimeOffset now, string reason)
  {
    var synthetic = State("unknown", "unknown", "private_s3_snapshot", null, now, null, reason);
    synthetic["schemaVersion"] = null; synthetic["runId"] = null; synthetic["checks"] = Array.Empty<object>();
    var alarms = State("unknown", "unknown", "cloudwatch_snapshot", null, now, null, reason); alarms["items"] = Array.Empty<object>();
    return new(synthetic, alarms);
  }
  private static void Fields(JsonElement obj, params string[] keys)
  {
    if (obj.ValueKind != JsonValueKind.Object || obj.EnumerateObject().Count() != keys.Length || obj.EnumerateObject().Any(p => !keys.Contains(p.Name)) || keys.Any(k => !obj.TryGetProperty(k,out _))) throw new FormatException();
  }
  private static DateTimeOffset Stamp(JsonElement e)
  {
    var raw = e.GetString();
    if (raw is null || raw.Length > 40 || !(raw.EndsWith("Z", StringComparison.Ordinal) || raw.EndsWith("+00:00", StringComparison.Ordinal))) throw new FormatException();
    var t = e.GetDateTimeOffset(); if (t.Offset != TimeSpan.Zero) throw new FormatException(); return t;
  }
  private static string String(JsonElement e, int max)
  {
    var s = e.GetString(); if (!Text(s,max)) throw new FormatException(); return s!;
  }
  public static SnapshotViews ParseSnapshot(byte[] bytes, DateTimeOffset now)
  {
    try
    {
      if (bytes.Length > 65536) throw new FormatException();
      using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 }); var root = doc.RootElement;
      Fields(root,"schemaVersion","runId","observedAt","completedAt","expiresAt","checks","alarms");
      if (root.GetProperty("schemaVersion").GetInt32() != 1) throw new FormatException();
      var runId = String(root.GetProperty("runId"),128);
      if (runId.Any(ch => !char.IsAsciiLetterOrDigit(ch) && ch != '_' && ch != '-')) throw new FormatException();
      var observed = Stamp(root.GetProperty("observedAt")); var completed = Stamp(root.GetProperty("completedAt")); var expires = Stamp(root.GetProperty("expiresAt"));
      if (observed > now.AddSeconds(60) || completed < observed || completed > now.AddSeconds(60) || expires != observed.AddMinutes(30)) throw new FormatException();
      var checkArray = root.GetProperty("checks");
      if (checkArray.ValueKind != JsonValueKind.Array || checkArray.GetArrayLength() != CheckNames.Length) throw new FormatException();
      var seen = new HashSet<string>(); var coreFailed = false; var advisoryFailed = false; var coreUnknown = false; var checks = new List<object>();
      foreach (var c in checkArray.EnumerateArray())
      {
        Fields(c,"name","status","advisory","httpStatus","latencyMs","code");
        var name = String(c.GetProperty("name"),64);
        if (name != CheckNames[seen.Count]) throw new FormatException();
        var status = String(c.GetProperty("status"),16);
        var advisory = c.GetProperty("advisory").GetBoolean();
        if (!CheckNames.Contains(name) || !seen.Add(name) || advisory != (name == "remote-config") || status is not ("healthy" or "degraded" or "failed" or "unknown")) throw new FormatException();
        var http = c.GetProperty("httpStatus").ValueKind == JsonValueKind.Null ? (int?)null : c.GetProperty("httpStatus").GetInt32();
        var latency = c.GetProperty("latencyMs").ValueKind == JsonValueKind.Null ? (int?)null : c.GetProperty("latencyMs").GetInt32();
        var code = c.GetProperty("code").ValueKind == JsonValueKind.Null ? null : String(c.GetProperty("code"),64);
        if (http is <100 or >599 || latency is <0 or >60000 || (code is not null && !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z][A-Z0-9_]{0,47}$"))) throw new FormatException();
        coreUnknown |= !advisory && status == "unknown";
        if (advisory) advisoryFailed |= status != "healthy"; else coreFailed |= status is "failed" or "degraded";
        checks.Add(new {name,status,advisory,httpStatus=http,latencyMs=latency,code});
      }
      var state = now > expires ? "stale" : "fresh";
      var aggregate = state == "stale" ? "unknown" : coreFailed ? "failed" : coreUnknown ? "unknown" : advisoryFailed ? "degraded" : "healthy";
      var synthetic = State(state,aggregate,"private_s3_snapshot",observed,now,expires,state == "stale" ? "snapshot_expired" : null);
      synthetic["schemaVersion"] = 1; synthetic["runId"] = runId; synthetic["checks"] = checks;
      var alarm = root.GetProperty("alarms"); Fields(alarm,"state","observedAt","items","reason");
      var alarmKnown = alarm.GetProperty("state").GetString(); if (alarmKnown is not ("known" or "unknown")) throw new FormatException();
      var alarmObserved = Stamp(alarm.GetProperty("observedAt")); if (alarmObserved < observed || alarmObserved > completed) throw new FormatException();
      var alarmReason = alarm.GetProperty("reason").ValueKind == JsonValueKind.Null ? null : String(alarm.GetProperty("reason"),64);
      if (alarmReason is not (null or "not_configured" or "source_unavailable")) throw new FormatException();
      var alarmItems = alarm.GetProperty("items"); if (alarmItems.ValueKind != JsonValueKind.Array || alarmItems.GetArrayLength() > 20) throw new FormatException();
      var alarmNames = new HashSet<string>(); var alarmFailed = false; var items = new List<object>();
      foreach (var item in alarmItems.EnumerateArray())
      {
        Fields(item,"name","state","stateUpdatedAt"); var name = String(item.GetProperty("name"),255); var status = String(item.GetProperty("state"),32);
        if (!System.Text.RegularExpressions.Regex.IsMatch(name,"^[A-Za-z0-9][A-Za-z0-9:_./# -]{0,254}$") || !alarmNames.Add(name) || status is not ("OK" or "ALARM" or "INSUFFICIENT_DATA" or "UNKNOWN")) throw new FormatException();
        DateTimeOffset? updated = item.GetProperty("stateUpdatedAt").ValueKind == JsonValueKind.Null ? null : Stamp(item.GetProperty("stateUpdatedAt"));
        if (updated > now.AddSeconds(60)) throw new FormatException();
        alarmFailed |= status == "ALARM"; items.Add(new { name, state=status, stateUpdatedAt=updated });
      }
      if (alarmKnown == "unknown" && items.Count != 0) throw new FormatException();
      var alarms = State(alarmKnown == "unknown" ? "unknown" : state, state == "fresh" && alarmKnown == "known" && alarmFailed ? "failed" : "unknown", "cloudwatch_snapshot", alarmObserved, now, expires, state == "stale" ? "snapshot_expired" : alarmReason);
      alarms["items"] = items;
      return new(synthetic,alarms);
    }
    catch { return UnknownSnapshot(now,"invalid_snapshot"); }
  }
}
