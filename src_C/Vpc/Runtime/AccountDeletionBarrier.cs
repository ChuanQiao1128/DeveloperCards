using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class AccountDeletionBarrier
{
  public static bool IsRejection(PostgresException ex) =>
    ex.SqlState == "55000" && ex.MessageText == "ACCOUNT_DELETION_PENDING";

  public static APIGatewayProxyResponse Rejected(Res res) =>
    res.Raw(409, new { success = false, error = new { code = "ACCOUNT_DELETION_PENDING", message = "Account deletion is in progress. Retry deletion or sign out." } });
}
