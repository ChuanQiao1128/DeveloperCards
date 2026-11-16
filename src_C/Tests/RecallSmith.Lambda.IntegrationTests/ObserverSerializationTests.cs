using System.Text;
using System.Text.Json;
using Amazon.Lambda.Serialization.SystemTextJson;
using RecallSmith.Lambda.OperationsObserver;
using Xunit.Abstractions;

namespace RecallSmith.Lambda.IntegrationTests;

public sealed class ObserverSerializationTests(ITestOutputHelper output)
{
  [Theory]
  [InlineData("known", false, null)]
  [InlineData("known", true, null)]
  [InlineData("unknown", null, "DB_UNAVAILABLE")]
  public void LambdaSerializerPreservesMandatoryNullableWireProperties(string status, bool? stalled, string? reason)
  {
    var observation = new Observation(1, new DateTime(2026, 11, 17, 0, 0, 0, DateTimeKind.Utc),
      status, stalled, false, [], reason);
    using var stream = new MemoryStream();
    new DefaultLambdaJsonSerializer().Serialize(observation, stream);
    output.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
    using var document = JsonDocument.Parse(stream.ToArray());
    var wire = document.RootElement;
    Assert.Equal(new[] { "items", "observedAt", "reason", "schemaVersion", "stalled", "status", "truncated" },
      wire.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal));
    Assert.Equal(status, wire.GetProperty("status").GetString());
    if (stalled is null) Assert.Equal(JsonValueKind.Null, wire.GetProperty("stalled").ValueKind);
    else Assert.Equal(stalled.Value, wire.GetProperty("stalled").GetBoolean());
    if (reason is null) Assert.Equal(JsonValueKind.Null, wire.GetProperty("reason").ValueKind);
    else Assert.Equal(reason, wire.GetProperty("reason").GetString());
  }
}
