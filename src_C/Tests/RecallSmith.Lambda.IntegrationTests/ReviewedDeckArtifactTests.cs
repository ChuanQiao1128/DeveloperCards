using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

public class ReviewedDeckArtifactTests
{
  [Theory]
  [InlineData("valid")]
  [InlineData("changed translation")]
  [InlineData("missing help")]
  [InlineData("wrong order")]
  [InlineData("wrong revision")]
  public async Task ChecksTheFinalSerializedFileBeforeIssuingItsHash(string variant)
  {
    var expected = new DeckExportData
    {
      Slug = "aws-saa-fundamentals", Version = "build-42", TotalCards = 1, VerifyReviewedContent = true,
      Cards = [new CardExportData {
        StableUid = "aws-one", OrderInDeck = 1, Revision = 2, Question = "Which route?", Explanation = "Use the local route.",
        Translations = JsonSerializer.SerializeToElement(new Dictionary<string, object> { ["zh-CN"] = new { question = "哪条路由？" } }),
        FrontHelp = JsonSerializer.SerializeToElement(new[] { new { term = "route", definition = "The network path" } }),
      }],
    };
    var actual = JsonSerializer.Deserialize<DeckExportData>(ContentJson.Serialize(expected), ContentJson.Options)!;
    var card = actual.Cards[0];
    if (variant == "changed translation") card.Translations = JsonSerializer.SerializeToElement(new { other = "different" });
    if (variant == "missing help") card.FrontHelp = null;
    if (variant == "wrong order") card.OrderInDeck++;
    if (variant == "wrong revision") card.Revision++;
    var bytes = Encoding.UTF8.GetBytes(ContentJson.Serialize(actual));
    var path = Path.GetTempFileName();
    try
    {
      await File.WriteAllBytesAsync(path, bytes);
      if (variant != "valid")
      {
        await Assert.ThrowsAsync<BusinessException>(() => S3DeckUploader.VerifyAndHashAsync(path, expected));
        return;
      }
      var proof = await S3DeckUploader.VerifyAndHashAsync(path, expected);
      Assert.True(proof.ReviewedContentVerified);
      Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), proof.Sha256);
      Assert.Equal(bytes.LongLength, proof.Bytes);
    }
    finally { File.Delete(path); }
  }
}
