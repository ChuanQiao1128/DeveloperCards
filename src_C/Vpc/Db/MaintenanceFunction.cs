using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

/// <summary>IAM direct-invoke only. Never registered in VpcFunction or API Gateway.</summary>
public sealed class MaintenanceFunction
{
  public sealed record Request(string Operation = "plan", string? ConfirmDestructive = null);

  public async Task<APIGatewayProxyResponse> Handler(JsonElement payload, ILambdaContext context)
  {
    // A numeric invoked ARN rejects aliases (including prod) and $LATEST. Configuration is immutable in a version.
    if (!DbSafety.MaintenanceOnly || !int.TryParse(context.FunctionVersion, out var version) || version <= 0 ||
        !context.InvokedFunctionArn.EndsWith(":" + context.FunctionVersion, StringComparison.Ordinal))
      throw new InvalidOperationException("Maintenance requires a qualified immutable maintenance version");
    if (payload.ValueKind != JsonValueKind.Object || payload.EnumerateObject().Any(p => p.Name is not ("Operation" or "ConfirmDestructive")))
      throw new ArgumentException("Direct maintenance payload required; HTTP events are forbidden");
    var request = payload.Deserialize<Request>() ?? throw new ArgumentException("Invalid maintenance payload");
    if (request.Operation is not ("plan" or "migrate"))
      throw new ArgumentException("Operation must be plan or migrate");
    var login = Environment.GetEnvironmentVariable("PGUSER");
    if (login != "developercards_migrator") throw new InvalidOperationException("Dedicated maintenance login required");
    await using var conn = await Pg.OpenConnectionOrNullAsync()
      ?? throw new InvalidOperationException("Missing maintenance database configuration");
    // No role selection comes from the payload. This login alone can SET ROLE to the schema owner.
    await ExecuteAsync(conn, null, "set role developercards_schema", []);
    var owner = await ExecuteScalarAsync(conn, null, "select current_user='developercards_schema' and session_user='developercards_migrator'", []);
    if (owner is not true) throw new InvalidOperationException("Maintenance database role is not isolated");
    var res = new Res(context.AwsRequestId);
    return await Migrate.RunMigrationsAsync(conn, res, request.Operation == "plan", request.ConfirmDestructive,
      "iam:maintenance", context.InvokedFunctionArn);
  }
}
