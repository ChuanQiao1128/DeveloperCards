using Npgsql;

namespace RecallSmith.Lambda.Db;

public static class PgConnectionSecurity
{
  public const string RdsRootCertificate = "Certificates/ap-southeast-2-bundle.pem";

  public static void Apply(NpgsqlConnectionStringBuilder options)
  {
    var environment = (Environment.GetEnvironmentVariable("API_ENV") ?? "").Trim();
    var production = environment.Equals("production", StringComparison.OrdinalIgnoreCase)
      || environment.Equals("prod", StringComparison.OrdinalIgnoreCase);
    var raw = (Environment.GetEnvironmentVariable("PGSSLMODE") ?? "").Trim().ToLowerInvariant();
    options.SslMode = raw switch
    {
      "" => production ? SslMode.VerifyFull : SslMode.Require,
      "require" => SslMode.Require,
      "verify-full" => SslMode.VerifyFull,
      "disable" when !production => SslMode.Disable,
      "disable" => throw new InvalidOperationException("PGSSLMODE=disable is forbidden in production."),
      _ => throw new InvalidOperationException("PGSSLMODE must be require, verify-full, or disable."),
    };

    var root = Environment.GetEnvironmentVariable("PGSSLROOTCERT");
    if (string.IsNullOrWhiteSpace(root) && production && options.SslMode == SslMode.VerifyFull)
      root = RdsRootCertificate;
    if (!string.IsNullOrWhiteSpace(root))
      options.RootCertificate = Path.IsPathRooted(root.Trim())
        ? root.Trim() : Path.Combine(AppContext.BaseDirectory, root.Trim());
  }
}
