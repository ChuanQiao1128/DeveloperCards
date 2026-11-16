using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Amazon.Lambda.Core;
using Npgsql;
using RecallSmith.Lambda.Db;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace RecallSmith.Lambda.OperationsObserver;

public sealed record StalledItem(
  [property: JsonPropertyName("phase")] string Phase,
  [property: JsonPropertyName("jobId")] string JobId,
  [property: JsonPropertyName("deckSlug")] string DeckSlug,
  [property: JsonPropertyName("buildId")] string BuildId,
  [property: JsonPropertyName("sinceAt")] DateTime SinceAt);

public sealed record Observation(
  [property: JsonPropertyName("schemaVersion")] int SchemaVersion,
  [property: JsonPropertyName("observedAt")] DateTime ObservedAt,
  [property: JsonPropertyName("status")] string Status,
  [property: JsonPropertyName("stalled")] bool? Stalled,
  [property: JsonPropertyName("truncated")] bool Truncated,
  [property: JsonPropertyName("items")] IReadOnlyList<StalledItem> Items,
  [property: JsonPropertyName("reason")] string? Reason);

public sealed class Function
{
  private readonly Func<NpgsqlConnection> _connection;
  private readonly Action<string> _write;
  private readonly Func<string?> _namespace;
  internal static readonly string Query = LoadQuery();
  private static readonly Regex Identifier = new("\\A[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\\z", RegexOptions.CultureInvariant);
  private static readonly Regex Namespace = new("\\A(?:DeveloperCards|DeveloperCardsConsoleS2_[A-Za-z0-9_-]{1,64})\\z", RegexOptions.CultureInvariant);

  public Function() : this(() => new NpgsqlConnection(ConnectionOptions().ConnectionString),
    Console.WriteLine, () => Environment.GetEnvironmentVariable("METRICS_NAMESPACE") ?? "DeveloperCards") { }

  internal Function(Func<NpgsqlConnection> connection, Action<string> write, Func<string?> metricNamespace)
  {
    _connection = connection;
    _write = write;
    _namespace = metricNamespace;
  }

  public async Task<Observation> Handler(JsonElement input, ILambdaContext? context)
  {
    var now = SampleTime();
    string? metricNamespace = _namespace();
    metricNamespace = metricNamespace is not null && Namespace.IsMatch(metricNamespace) ? metricNamespace : null;
    Observation result;
    if (!ValidEvent(input) || metricNamespace is null)
      result = Unknown(now, "INVALID_CONFIG");
    else
    {
      // Leave two seconds for safe output before the eight-second Lambda deadline.
      var milliseconds = Math.Min(6000, (context?.RemainingTime.TotalMilliseconds ?? 8000) - 2000);
      using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Max(1, milliseconds)));
      try
      {
        if (milliseconds <= 0) throw new OperationCanceledException();
        await using var connection = _connection();
        using (var connect = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token))
        {
          connect.CancelAfter(TimeSpan.FromSeconds(2));
          await connection.OpenAsync(connect.Token);
        }
        result = await SampleAsync(connection, deadline.Token);
      }
      catch (InvalidOperationException) { result = Unknown(now, "INVALID_CONFIG"); }
      catch (ArgumentException) { result = Unknown(now, "INVALID_CONFIG"); }
      catch (PostgresException error) when (error.SqlState is "57014" or "55P03")
      { result = Unknown(now, "QUERY_TIMEOUT"); }
      catch (OperationCanceledException) { result = Unknown(now, "QUERY_TIMEOUT"); }
      catch (NpgsqlException error) when (error.InnerException is TimeoutException)
      { result = Unknown(now, "QUERY_TIMEOUT"); }
      catch (Exception) { result = Unknown(now, "DB_UNAVAILABLE"); }
    }
    WriteLogs(result, metricNamespace);
    return result;
  }

  internal static bool ValidEvent(JsonElement input)
  {
    if (input.ValueKind != JsonValueKind.Object) return false;
    var properties = input.EnumerateObject().ToArray();
    return properties.Length == 2 && properties.Select(p => p.Name).Distinct().Count() == 2
      && input.TryGetProperty("schemaVersion", out var version) && version.ValueKind == JsonValueKind.Number
      && version.TryGetInt32(out var number) && number == 1
      && input.TryGetProperty("job", out var job) && job.ValueKind == JsonValueKind.String
      && job.GetString() == "observe-publishing";
  }

  internal static NpgsqlConnectionStringBuilder ConnectionOptions()
  {
    static string Required(string name) => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(name))
      ? Environment.GetEnvironmentVariable(name)! : throw new InvalidOperationException("INVALID_CONFIG");
    var rawPort = Environment.GetEnvironmentVariable("PGPORT");
    var port = rawPort is null ? 5432 : int.TryParse(rawPort, out var parsed) && parsed is > 0 and <= 65535
      ? parsed : throw new InvalidOperationException("INVALID_CONFIG");
    var options = new NpgsqlConnectionStringBuilder
    {
      Host = Required("PGHOST"), Port = port, Database = Required("PGDATABASE"),
      Username = Required("PGUSER"), Password = Required("PGPASSWORD"),
      Pooling = false, MaxPoolSize = 1, Timeout = 2, CommandTimeout = 2, CancellationTimeout = 250,
      ApplicationName = "operations-observer",
      // Independent from API/worker session settings, including connection startup.
      Options = "-c default_transaction_read_only=on -c statement_timeout=2000 -c lock_timeout=250 -c idle_in_transaction_session_timeout=3000 -c search_path=public",
    };
    PgConnectionSecurity.Apply(options);
    return options;
  }

  internal static async Task<NpgsqlTransaction> BeginReadOnlyAsync(NpgsqlConnection connection, CancellationToken token)
  {
    var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
    try
    {
      await using var setup = new NpgsqlCommand("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout=2000; SET LOCAL lock_timeout=250", connection, transaction);
      await setup.ExecuteNonQueryAsync(token);
      return transaction;
    }
    catch { await transaction.DisposeAsync(); throw; }
  }

  internal static async Task<Observation> SampleAsync(NpgsqlConnection connection, CancellationToken token)
  {
    await using var transaction = await BeginReadOnlyAsync(connection, token);
    var observedAt = SampleTime();
    var items = new List<StalledItem>(20);
    var truncated = false;
    await using (var command = new NpgsqlCommand(Query, connection, transaction) { CommandTimeout = 2 })
    await using (var reader = await command.ExecuteReaderAsync(token))
    {
      while (await reader.ReadAsync(token))
      {
        if (items.Count == 20) { truncated = true; break; }
        static string Safe(string value) => Identifier.IsMatch(value) ? value : "redacted";
        items.Add(new StalledItem(reader.GetString(0), Safe(reader.GetString(1)), Safe(reader.GetString(2)),
          Safe(reader.GetString(3)), reader.GetDateTime(5).ToUniversalTime()));
      }
    }
    await transaction.CommitAsync(token);
    return new(1, observedAt, "known", items.Count > 0, truncated, items, null);
  }

  private void WriteLogs(Observation result, string? metricNamespace)
  {
    var summary = new Dictionary<string, object?>
    {
      ["Service"] = "operations-observer", ["tag"] = "operations-observer",
      ["status"] = result.Status, ["reason"] = result.Reason,
    };
    if (metricNamespace is not null)
    {
      var metrics = new List<object> { new { Name = "ObserverSuccess", Unit = "Count" } };
      summary["ObserverSuccess"] = result.Status == "known" ? 1 : 0;
      if (result.Status == "known")
      {
        metrics.Add(new { Name = "PublishStalled", Unit = "Count" });
        summary["PublishStalled"] = result.Stalled == true ? 1 : 0;
      }
      summary["_aws"] = new { Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        CloudWatchMetrics = new[] { new { Namespace = metricNamespace, Dimensions = new[] { new[] { "Service" } }, Metrics = metrics } } };
    }
    _write(JsonSerializer.Serialize(summary));
    var contextItems = result.Items.ToList();
    string context;
    do
    {
      context = JsonSerializer.Serialize(new { tag = "operations-observer-context", observedAt = result.ObservedAt,
        items = contextItems, truncated = result.Truncated || contextItems.Count < result.Items.Count });
      if (Encoding.UTF8.GetByteCount(context) <= 8192) break;
      contextItems.RemoveAt(contextItems.Count - 1);
    } while (true);
    _write(context);
  }

  // The Python v1 time parser accepts microseconds, while .NET clocks also carry 100ns ticks.
  private static DateTime SampleTime() => new(DateTime.UtcNow.Ticks / 10 * 10, DateTimeKind.Utc);

  private static Observation Unknown(DateTime at, string reason) => new(1, at, "unknown", null, false, [], reason);
  private static string LoadQuery()
  {
    using var stream = typeof(Function).Assembly.GetManifestResourceStream("RecallSmith.Lambda.OperationsObserver.Backlog.sql")!;
    using var reader = new StreamReader(stream);
    return reader.ReadToEnd();
  }
}
