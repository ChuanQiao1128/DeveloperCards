using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Operations;

public static partial class ConsoleOperations
{
  public static async Task<APIGatewayProxyResponse> HandleOverview(LambdaRequest req, Res res, AuthContext auth, IAmazonS3? snapshotClient = null, DateTimeOffset? evaluatedAt = null)
  {
    var deny = Deny(auth, res); if (deny is not null) return deny;
    if (req.Method != "GET") return Private(res.MethodNotAllowed());
    if (req.Query.Count != 0) return Invalid(res);
    var now = evaluatedAt ?? DateTimeOffset.UtcNow;
    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync(); if (conn is null) return Unavailable(res);
      await using var tx = await conn.BeginTransactionAsync(RequestBudget.Token);
      var publish = await Optional(conn, tx, """
        select p.job_id,p.deck_slug,p.status,p.updated_at,p.build_id,r.release_id
        from deck_publishes p left join content_review_receipts r on r.id=p.release_receipt_id
        where p.job_id is not null and p.status in ('PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED')
        order by p.updated_at desc,p.id desc limit 21
        """, []);
      await Audit(conn, tx, auth, res, "console.operations.read", "operations");
      await tx.CommitAsync(RequestBudget.Token);
      var snapshot = await ReadSnapshot(now, snapshotClient);
      var publishing = State(publish is null ? "unknown" : "fresh", "unknown", "deck_publishes", publish is null ? null : now, now, null, publish is null ? "source_unavailable" : null);
      publishing["items"] = publish?.Take(20).Select(p => new { jobId = p["job_id"], deckSlug = p["deck_slug"], status = p["status"], updatedAt = p["updated_at"], releaseId = p["release_id"], buildId = p["build_id"], deliveryVerification = "unknown", href = (string?)null }).ToArray() ?? [];
      publishing["truncated"] = publish?.Count > 20;
      var database = State("fresh", "healthy", "postgresql", now, now, null, null); database["reachable"] = true;
      return Private(res.Ok(new { fetchedAt = now, synthetic = snapshot.Synthetic, alarms = snapshot.Alarms, database, publishing, links = new { cloudWatch = SafeLink("OPS_CLOUDWATCH_URL"), sentry = SafeLink("OPS_SENTRY_URL") } }));
    }
    catch (Exception ex) when (ex is Npgsql.NpgsqlException or AuditUnavailableException or OperationCanceledException or TimeoutException) { return Unavailable(res); }
    catch { return Private(res.Error500(null)); }
  }
  private static string? SafeLink(string name)
  {
    var raw = Environment.GetEnvironmentVariable(name);
    if (raw?.Length > 2048 || !Uri.TryCreate(raw, UriKind.Absolute, out var url) || url.Scheme != "https" || !string.IsNullOrEmpty(url.UserInfo) || !string.IsNullOrEmpty(url.Query)) return null;
    if (name == "OPS_CLOUDWATCH_URL")
      return url.Host.Equals("ap-southeast-2.console.aws.amazon.com", StringComparison.OrdinalIgnoreCase)
        && url.IsDefaultPort && url.AbsolutePath == "/cloudwatch/home"
        && System.Text.RegularExpressions.Regex.IsMatch(url.Fragment, "^#dashboards:name=[A-Za-z0-9_-]{1,255}$") ? url.AbsoluteUri : null;
    return string.IsNullOrEmpty(url.Fragment) ? url.AbsoluteUri : null;
  }
  private static Dictionary<string,object?> State(string state, string status, string source, DateTimeOffset? observed, DateTimeOffset fetched, DateTimeOffset? expires, string? reason) => new()
  {
    ["state"] = state, ["status"] = status, ["source"] = source, ["observedAt"] = observed, ["fetchedAt"] = fetched, ["expiresAt"] = expires, ["reason"] = reason,
  };
  private static async Task<SnapshotViews> ReadSnapshot(DateTimeOffset now, IAmazonS3? injected)
  {
    var bucket = Environment.GetEnvironmentVariable("OPS_SNAPSHOT_BUCKET");
    var key = Environment.GetEnvironmentVariable("OPS_SNAPSHOT_KEY");
    if (string.IsNullOrWhiteSpace(bucket) || key != SnapshotKey || bucket != Environment.GetEnvironmentVariable("PREMIUM_BUCKET")) return UnknownSnapshot(now, "not_configured");
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(RequestBudget.Token);
    deadline.CancelAfter(TimeSpan.FromSeconds(2));
    AmazonS3Client? owned = null;
    try
    {
      var client = injected ?? (owned = new AmazonS3Client(new AmazonS3Config { MaxErrorRetry = 0, Timeout = TimeSpan.FromSeconds(2) }));
      using var response = await client.GetObjectAsync(new GetObjectRequest { BucketName = bucket, Key = key }, deadline.Token);
      if (response.ContentLength > 65536) return UnknownSnapshot(now, "invalid_snapshot");
      using var data = new MemoryStream(); var buffer = new byte[8192];
      while (true)
      {
        var count = await response.ResponseStream.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, 65537 - (int)data.Length)), deadline.Token);
        if (count == 0) break;
        data.Write(buffer, 0, count);
        if (data.Length > 65536) return UnknownSnapshot(now, "invalid_snapshot");
      }
      return ParseSnapshot(data.ToArray(), now);
    }
    catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound) { return UnknownSnapshot(now, "snapshot_missing"); }
    catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.Forbidden) { return UnknownSnapshot(now, "snapshot_denied"); }
    catch (OperationCanceledException) { return UnknownSnapshot(now, "source_timeout"); }
    catch { return UnknownSnapshot(now, "source_unavailable"); }
    finally { owned?.Dispose(); }
  }
}
