using System.Globalization;
using System.Security.Authentication;
using Npgsql;
using RecallSmith.Lambda.Db;
using Observer = RecallSmith.Lambda.OperationsObserver.Function;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection("pg-tls")]
public sealed class OperationsObserverTlsTests(PgTlsFixture fixture)
{
  [Fact]
  public async Task OwnConnectionUsesVerifyFullAndIndependentReadOnlyTimeouts()
  {
    using var environment = new LocalEnvironment(fixture.Valid, fixture.RootPath);
    var options = Observer.ConnectionOptions();
    Assert.Equal(SslMode.VerifyFull, options.SslMode);
    Assert.Equal(fixture.RootPath, options.RootCertificate);
    Assert.False(options.Pooling);
    Assert.Equal(1, options.MaxPoolSize);
    Assert.Equal(2, options.Timeout);
    Assert.Equal(2, options.CommandTimeout);
    Assert.Contains("default_transaction_read_only=on", options.Options);
    Assert.Contains("statement_timeout=2000", options.Options);
    Assert.Contains("lock_timeout=250", options.Options);
    await using var connection = new NpgsqlConnection(options.ConnectionString);
    await connection.OpenAsync();
    Assert.Equal("on", await new NpgsqlCommand("show transaction_read_only", connection).ExecuteScalarAsync());
    Assert.Equal("2s", await new NpgsqlCommand("show statement_timeout", connection).ExecuteScalarAsync());
    Assert.Equal("250ms", await new NpgsqlCommand("show lock_timeout", connection).ExecuteScalarAsync());
    Environment.SetEnvironmentVariable("PGSSLROOTCERT", null);
    Assert.Equal(Path.Combine(AppContext.BaseDirectory, PgConnectionSecurity.RdsRootCertificate), Observer.ConnectionOptions().RootCertificate);
    Assert.True(File.Exists(Observer.ConnectionOptions().RootCertificate));
  }

  [Theory]
  [InlineData("hostname")] [InlineData("expired")] [InlineData("unknown-ca")]
  public async Task ObserverRejectsInvalidServerCertificates(string failure)
  {
    var server = failure == "hostname" ? fixture.WrongHostname : failure == "expired" ? fixture.Expired : fixture.Valid;
    using var environment = new LocalEnvironment(server, failure == "unknown-ca" ? fixture.UnknownRootPath : fixture.RootPath);
    await using var connection = new NpgsqlConnection(Observer.ConnectionOptions().ConnectionString);
    var exception = await Assert.ThrowsAsync<NpgsqlException>(() => connection.OpenAsync());
    Assert.IsType<AuthenticationException>(exception.InnerException);
  }

  [Theory]
  [InlineData("require")] [InlineData("disable")]
  public void ProductionCannotDowngradeTls(string mode)
  {
    using var environment = new LocalEnvironment(fixture.Valid, fixture.RootPath);
    Environment.SetEnvironmentVariable("PGSSLMODE", mode);
    Assert.Throws<InvalidOperationException>(() => Observer.ConnectionOptions());
  }

  private sealed class LocalEnvironment : IDisposable
  {
    private readonly Dictionary<string, string?> _saved = new();
    public LocalEnvironment(Testcontainers.PostgreSql.PostgreSqlContainer server, string root)
    {
      var values = new Dictionary<string, string?>
      {
        ["PGHOST"] = "localhost", ["PGPORT"] = server.GetMappedPublicPort(5432).ToString(CultureInfo.InvariantCulture),
        ["PGDATABASE"] = "tls_test", ["PGUSER"] = "tls_test", ["PGPASSWORD"] = "tls_test",
        ["PGSSLMODE"] = "verify-full", ["API_ENV"] = "production", ["PGSSLROOTCERT"] = root,
        // The observer must ignore unrelated API timeout overrides.
        ["PG_STATEMENT_TIMEOUT_MS"] = "20000", ["PG_LOCK_TIMEOUT_MS"] = "20000",
      };
      foreach (var (key, value) in values)
      {
        _saved[key] = Environment.GetEnvironmentVariable(key);
        Environment.SetEnvironmentVariable(key, value);
      }
    }
    public void Dispose()
    {
      foreach (var (key, value) in _saved) Environment.SetEnvironmentVariable(key, value);
    }
  }
}
