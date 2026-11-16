using System.Text.Json;
using RecallSmith.Lambda.Vpc.Operations;

namespace RecallSmith.Lambda.IntegrationTests;

public class ConsoleOperationsProducerContractTests
{
  [Fact]
  public void The_Python_producer_wire_is_consumed_without_reinterpreting_a_failure_as_health()
  {
    const string relative = "services/synthetic-check/tests/fixtures/operations-snapshot-v1.json";
    var directory = new DirectoryInfo(AppContext.BaseDirectory);
    while (directory is not null && !File.Exists(Path.Combine(directory.FullName, relative)))
      directory = directory.Parent;
    Assert.NotNull(directory);
    var view = ConsoleOperations.ParseSnapshot(File.ReadAllBytes(Path.Combine(directory.FullName, relative)),
      new DateTimeOffset(2026, 11, 16, 0, 0, 2, TimeSpan.Zero));
    Assert.Equal("fresh", view.Synthetic["state"]);
    Assert.Equal("failed", view.Synthetic["status"]);
    Assert.Equal(9, Assert.IsAssignableFrom<IEnumerable<object>>(view.Synthetic["checks"]).Count());
    Assert.Equal("unknown", view.Alarms["status"]);
  }
  public static IEnumerable<object[]> InvalidWires()
  {
    const string relative="services/synthetic-check/tests/fixtures/operations-snapshot-invalid-wire-v1.json";
    var directory=new DirectoryInfo(AppContext.BaseDirectory);
    while(directory is not null && !File.Exists(Path.Combine(directory.FullName,relative)))directory=directory.Parent;
    Assert.NotNull(directory);
    using var fixture=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(directory.FullName,relative)));
    Assert.Equal(1,fixture.RootElement.GetProperty("schemaVersion").GetInt32());
    foreach(var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
      yield return new object[]{item.GetProperty("id").GetString()!,Convert.FromBase64String(item.GetProperty("bodyBase64").GetString()!)};
  }
  [Theory]
  [MemberData(nameof(InvalidWires))]
  public void Shared_invalid_wire_is_rejected_without_repairing_the_observation(string id,byte[] wire)
  {
    var view=ConsoleOperations.ParseSnapshot(wire,new DateTimeOffset(2026,11,16,0,0,10,TimeSpan.Zero));
    Assert.True(Equals("invalid_snapshot",view.Synthetic["reason"]),id);
    Assert.True(Equals("invalid_snapshot",view.Alarms["reason"]),id);
    Assert.Equal("unknown",view.Synthetic["state"]);Assert.Equal("unknown",view.Alarms["state"]);
  }

}
