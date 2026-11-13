namespace RecallSmith.Lambda.Worker.Services;

public interface IPublishManifestDelivery
{
  Task<bool> DeliverManifestAsync(string jobId, Func<Task> rebuild);
}
