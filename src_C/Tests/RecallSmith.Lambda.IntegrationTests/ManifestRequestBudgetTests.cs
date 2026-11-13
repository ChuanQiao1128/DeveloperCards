using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

public sealed class ManifestRequestBudgetTests
{
  private sealed class HeadProbe(bool waitForCancellation) : AmazonS3Client(
    new AnonymousAWSCredentials(), new AmazonS3Config { RegionEndpoint = RegionEndpoint.APSoutheast2 })
  {
    public CancellationToken Seen;
    public override async Task<GetObjectMetadataResponse> GetObjectMetadataAsync(
      GetObjectMetadataRequest request, CancellationToken cancellationToken = default)
    {
      Seen = cancellationToken;
      if (waitForCancellation)
      {
        Assert.True(cancellationToken.CanBeCanceled, "The actual manifest HEAD must receive the effective deadline");
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
      }
      throw new InvalidOperationException("HEAD probe stops before DB or PUT");
    }
  }

  [Fact]
  public async Task OnlineDefaultCallerTokenCancelsActualHead()
  {
    using var scope = RequestBudget.BeginOnline(TimeSpan.FromMilliseconds(550));
    using var s3 = new HeadProbe(true);
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      ManifestBuilder.RebuildAsync(null!, s3, "dummy-bucket", "content", "premium"));
    Assert.True(s3.Seen.IsCancellationRequested);
  }

  [Fact]
  public async Task WorkerRetainsExplicitCancellationWithoutOnlineScope()
  {
    using var caller = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
    using var s3 = new HeadProbe(true);
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      ManifestBuilder.RebuildAsync(null!, s3, "dummy-bucket", "content", "premium", ct: caller.Token));
    Assert.Equal(caller.Token, s3.Seen);
  }

  [Fact]
  public async Task WorkerDefaultDoesNotInheritAnOnlineDeadline()
  {
    using var s3 = new HeadProbe(false);
    await Assert.ThrowsAsync<InvalidOperationException>(() =>
      ManifestBuilder.RebuildAsync(null!, s3, "dummy-bucket", "content", "premium"));
    Assert.False(s3.Seen.CanBeCanceled);
  }
}
