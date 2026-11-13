using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using DotNet.Testcontainers.Configurations;
using Testcontainers.PostgreSql;

namespace RecallSmith.Lambda.IntegrationTests;

// Deliberately separate from the plaintext, migrated application fixture.
public sealed class PgTlsFixture : IAsyncLifetime
{
  private readonly string _directory = Path.Combine(Path.GetTempPath(), "recallsmith-pg-tls-" + Guid.NewGuid());
  public string RootPath => Path.Combine(_directory, "root.pem");
  public string UnknownRootPath => Path.Combine(_directory, "unknown-root.pem");
  public PostgreSqlContainer Valid { get; private set; } = null!;
  public PostgreSqlContainer WrongHostname { get; private set; } = null!;
  public PostgreSqlContainer Expired { get; private set; } = null!;
  private readonly List<PostgreSqlContainer> _containers = [];

  public async Task InitializeAsync()
  {
    Directory.CreateDirectory(_directory);
    using var rootKey = RSA.Create(2048);
    using var root = Root("RecallSmith local TLS test CA", rootKey);
    using var unknownKey = RSA.Create(2048);
    using var unknownRoot = Root("RecallSmith unrelated TLS test CA", unknownKey);
    await File.WriteAllTextAsync(RootPath, root.ExportCertificatePem());
    await File.WriteAllTextAsync(UnknownRootPath, unknownRoot.ExportCertificatePem());
    Valid = await StartAsync(root, "localhost", expired: false);
    WrongHostname = await StartAsync(root, "wrong.invalid", expired: false);
    Expired = await StartAsync(root, "localhost", expired: true);
  }

  private static X509Certificate2 Root(string name, RSA key)
  {
    var request = new CertificateRequest("CN=" + name, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
    request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign, true));
    return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-5), DateTimeOffset.UtcNow.AddDays(5));
  }

  private async Task<PostgreSqlContainer> StartAsync(X509Certificate2 root, string hostname, bool expired)
  {
    using var key = RSA.Create(2048);
    var request = new CertificateRequest("CN=" + hostname, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    var names = new SubjectAlternativeNameBuilder();
    names.AddDnsName(hostname);
    request.CertificateExtensions.Add(names.Build());
    request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
    request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
    request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new("1.3.6.1.5.5.7.3.1") }, false));
    using var certificate = request.Create(root, DateTimeOffset.UtcNow.AddDays(-2),
      expired ? DateTimeOffset.UtcNow.AddDays(-1) : DateTimeOffset.UtcNow.AddDays(1), RandomNumberGenerator.GetBytes(16));
    var container = new PostgreSqlBuilder("pgvector/pgvector:0.8.6-pg17")
      .WithDatabase("tls_test").WithUsername("tls_test").WithPassword("tls_test")
      .WithResourceMapping(Encoding.ASCII.GetBytes(certificate.ExportCertificatePem()), "/tmp/pg-tls.crt", 999, 999, UnixFileModes.UserRead)
      .WithResourceMapping(Encoding.ASCII.GetBytes(key.ExportPkcs8PrivateKeyPem()), "/tmp/pg-tls.key", 999, 999, UnixFileModes.UserRead)
      .WithCommand("-c", "ssl=on", "-c", "ssl_cert_file=/tmp/pg-tls.crt", "-c", "ssl_key_file=/tmp/pg-tls.key")
      .Build();
    _containers.Add(container);
    await container.StartAsync();
    return container;
  }

  public async Task DisposeAsync()
  {
    foreach (var container in _containers) await container.DisposeAsync();
    if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
  }
}
