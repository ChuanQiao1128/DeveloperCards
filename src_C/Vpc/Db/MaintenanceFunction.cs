using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

/// <summary>IAM direct-invoke only. Never registered in VpcFunction or API Gateway.</summary>
public sealed class MaintenanceFunction
{
  // Avoid record-generated ToString exposing the transient password.
  public sealed class Request
  {
    public string Operation { get; init; } = "plan";
    public string? ConfirmDestructive { get; init; }
    public string? Password { get; init; }
  }

  public async Task<APIGatewayProxyResponse> Handler(JsonElement payload, ILambdaContext context)
  {
    if (!DbSafety.MaintenanceOnly || !int.TryParse(context.FunctionVersion, out var version) || version <= 0 ||
        !context.InvokedFunctionArn.EndsWith(":" + context.FunctionVersion, StringComparison.Ordinal))
      throw new InvalidOperationException("Maintenance requires a qualified immutable maintenance version");
    if (payload.ValueKind != JsonValueKind.Object || payload.EnumerateObject().Any(p => p.Name is not ("Operation" or "ConfirmDestructive" or "Password")) ||
        payload.EnumerateObject().Select(p=>p.Name).Distinct().Count() != payload.EnumerateObject().Count())
      throw new ArgumentException("Direct maintenance payload required; HTTP events are forbidden");
    Request request;
    try { request = payload.Deserialize<Request>() ?? throw new JsonException(); }
    catch (JsonException) { throw new ArgumentException("Invalid maintenance payload"); }
    if (request.Operation is not ("plan" or "migrate") || string.IsNullOrWhiteSpace(request.Password))
      throw new ArgumentException("Operation and transient maintenance credential required");
    if (Environment.GetEnvironmentVariable("PGUSER") != "developercards_migrator" ||
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PGPASSWORD")))
      throw new InvalidOperationException("Dedicated maintenance login without stored password required");
    try
    {
      var options = new NpgsqlConnectionStringBuilder {
        Host = Environment.GetEnvironmentVariable("PGHOST"), Database = Environment.GetEnvironmentVariable("PGDATABASE"),
        Port = int.TryParse(Environment.GetEnvironmentVariable("PGPORT"), out var port) ? port : 5432,
        Username = "developercards_migrator", Password = request.Password, Pooling = false, Timeout = 8,
        Options = RecallSmith.Lambda.Db.PgSessionTimeouts.Current.ConnectionOptions,
      };
      RecallSmith.Lambda.Db.PgConnectionSecurity.Apply(options);
      await using var conn = new NpgsqlConnection(options.ConnectionString);
      await conn.OpenAsync(RequestBudget.Token);
      if (await ExecuteScalarAsync(conn, null, "select current_user='developercards_migrator' and session_user='developercards_migrator'", []) is not true)
        throw new InvalidOperationException();
      await ExecuteAsync(conn, null, "set role developercards_schema", []);
      var owner = await ExecuteScalarAsync(conn, null, "select current_user='developercards_schema' and session_user='developercards_migrator'", []);
      if (owner is not true) throw new InvalidOperationException();
      return await Migrate.RunMigrationsAsync(conn, new Res(context.AwsRequestId), request.Operation == "plan", request.ConfirmDestructive,
        "iam:maintenance", context.InvokedFunctionArn);
    }
    catch (OperationCanceledException) { throw; }
    catch { throw new InvalidOperationException("Maintenance database operation failed; details suppressed"); }
  }
}
