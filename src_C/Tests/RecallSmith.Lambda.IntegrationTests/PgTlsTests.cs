using Npgsql;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using SharedPg = RecallSmith.Lambda.Db.Pg;
using VpcPg = RecallSmith.Lambda.Vpc.Db.Pg;

namespace RecallSmith.Lambda.IntegrationTests;

[CollectionDefinition("pg-tls", DisableParallelization = true)]
public sealed class PgTlsCollection : ICollectionFixture<PgTlsFixture>;

[Collection("pg-tls")]
public sealed class PgTlsTests(PgTlsFixture fixture)
{
  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public void VerifyFullIsRecognized(bool vpc)
  {
    using var env = new PgEnvironment("verify-full", "test");
    var options = new NpgsqlConnectionStringBuilder(DataSource(vpc).ConnectionString);
    Assert.Equal(SslMode.VerifyFull, options.SslMode);
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public void TypoIsRejected(bool vpc)
  {
    using var env = new PgEnvironment("verfy-full", "test");
    Assert.Throws<InvalidOperationException>(() => DataSource(vpc));
  }

  [Theory]
  [InlineData(false, "production")]
  [InlineData(true, "production")]
  [InlineData(false, "prod")]
  [InlineData(true, "prod")]
  public void ProductionDisableIsRejected(bool vpc, string apiEnv)
  {
    using var env = new PgEnvironment("disable", apiEnv);
    Assert.Throws<InvalidOperationException>(() => DataSource(vpc));
  }

  [Theory]
  [InlineData(false, "production")]
  [InlineData(true, "production")]
  [InlineData(false, "prod")]
  [InlineData(true, "prod")]
  public void ProductionRequireIsRejected(bool vpc, string apiEnv)
  {
    using var env = new PgEnvironment("require", apiEnv);
    var exception = Assert.Throws<InvalidOperationException>(() => DataSource(vpc));
    Assert.Contains("does not verify the server hostname and CA", exception.Message);
  }

  [Theory]
  [InlineData(false, "production")]
  [InlineData(true, "production")]
  [InlineData(false, " PROD ")]
  [InlineData(true, " PROD ")]
  public void ProductionDefaultsToVerifyFullWithBundledCa(bool vpc, string apiEnv)
  {
    using var env = new PgEnvironment(null, apiEnv);
    var options = new NpgsqlConnectionStringBuilder(DataSource(vpc).ConnectionString);
    Assert.Equal(SslMode.VerifyFull, options.SslMode);
    Assert.Equal(Path.Combine(AppContext.BaseDirectory, Db.PgConnectionSecurity.RdsRootCertificate), options.RootCertificate);
    Assert.True(File.Exists(options.RootCertificate));
    X509Certificate2Collection roots = new();
    roots.ImportFromPemFile(options.RootCertificate);
    Assert.Equal(3, roots.Count);
    Assert.All(roots.Cast<X509Certificate2>(), c => Assert.True(c.NotAfter.ToUniversalTime() > DateTime.UtcNow));
    foreach (var root in roots) root.Dispose();
  }

  [Theory]
  [InlineData(false, "require", SslMode.Require)]
  [InlineData(true, "require", SslMode.Require)]
  [InlineData(false, "disable", SslMode.Disable)]
  [InlineData(true, "disable", SslMode.Disable)]
  [InlineData(false, null, SslMode.Require)]
  [InlineData(true, null, SslMode.Require)]
  public void LocalModesAndExistingPoolSettingsArePreserved(bool vpc, string? mode, SslMode expected)
  {
    using var env = new PgEnvironment(mode, "test");
    env.Set("PG_MAX", "3");
    env.Set("PG_CONNECTION_TIMEOUT", "7000");
    env.Set("PG_IDLE_TIMEOUT", "19000");
    env.Set("PG_MAX_AUTO_PREPARE", "4");
    var options = new NpgsqlConnectionStringBuilder(DataSource(vpc).ConnectionString);
    Assert.Equal(expected, options.SslMode);
    Assert.Equal(3, options.MaxPoolSize);
    Assert.Equal(7, options.Timeout);
    Assert.Equal(19, options.ConnectionIdleLifetime);
    Assert.Equal(vpc ? 0 : 4, options.MaxAutoPrepare);
    Assert.Equal(Db.PgSessionTimeouts.Current.ConnectionOptions, options.Options);
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task TrustedHostnameCompletesRealTlsHandshake(bool vpc)
  {
    using var env = HandshakeEnvironment(fixture.Valid, fixture.RootPath);
    await using var connection = DataSource(vpc).CreateConnection();
    await connection.OpenAsync();
    await using var command = new NpgsqlCommand("select ssl from pg_stat_ssl where pid = pg_backend_pid()", connection);
    Assert.Equal(true, await command.ExecuteScalarAsync());
  }

  [Theory]
  [InlineData(false, "hostname")]
  [InlineData(true, "hostname")]
  [InlineData(false, "unknown-ca")]
  [InlineData(true, "unknown-ca")]
  [InlineData(false, "expired")]
  [InlineData(true, "expired")]
  public async Task InvalidCertificateFailsRealTlsHandshake(bool vpc, string failure)
  {
    var server = failure == "hostname" ? fixture.WrongHostname : failure == "expired" ? fixture.Expired : fixture.Valid;
    using var env = HandshakeEnvironment(server, failure == "unknown-ca" ? fixture.UnknownRootPath : fixture.RootPath);
    await using var connection = DataSource(vpc).CreateConnection();
    var exception = await Assert.ThrowsAsync<NpgsqlException>(() => connection.OpenAsync());
    Assert.IsType<AuthenticationException>(exception.InnerException);
  }

  private static PgEnvironment HandshakeEnvironment(Testcontainers.PostgreSql.PostgreSqlContainer server, string root)
  {
    var env = new PgEnvironment("verify-full", "production");
    env.Set("PGHOST", "localhost");
    env.Set("PGPORT", server.GetMappedPublicPort(5432).ToString(System.Globalization.CultureInfo.InvariantCulture));
    env.Set("PGSSLROOTCERT", root);
    return env;
  }

  private static NpgsqlDataSource DataSource(bool vpc) =>
    (vpc ? VpcPg.DataSource() : SharedPg.DataSource())!;

  private sealed class PgEnvironment : IDisposable
  {
    private readonly Dictionary<string, string?> _saved = new();

    public PgEnvironment(string? sslMode, string apiEnv)
    {
      Dictionary<string, string?> settings = new()
      {
        ["PGHOST"] = "localhost", ["PGPORT"] = "5432",
        ["PGDATABASE"] = "tls_test", ["PGUSER"] = "tls_test", ["PGPASSWORD"] = "tls_test",
        ["PGSSLMODE"] = sslMode, ["API_ENV"] = apiEnv, ["PGSSLROOTCERT"] = null,
      };
      foreach (var (name, value) in settings)
      {
        _saved[name] = Environment.GetEnvironmentVariable(name);
        Environment.SetEnvironmentVariable(name, value);
      }
      SharedPg.Reset();
      VpcPg.Reset();
    }

    public void Set(string name, string value)
    {
      if (!_saved.ContainsKey(name)) _saved[name] = Environment.GetEnvironmentVariable(name);
      Environment.SetEnvironmentVariable(name, value);
    }

    public void Dispose()
    {
      SharedPg.Reset();
      VpcPg.Reset();
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
    }
  }
}
