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
}
