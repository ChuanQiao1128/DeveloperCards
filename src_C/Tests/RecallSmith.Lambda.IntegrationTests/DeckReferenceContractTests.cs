using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

// No database fixture: these are the actual pure authoring/worker contracts.
public class DeckReferenceContractTests
{
  private static string Root
  {
    get
    {
      for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        if (Directory.Exists(Path.Combine(d.FullName, "contracts", "content-v1"))) return d.FullName;
      throw new DirectoryNotFoundException("contracts/content-v1");
    }
  }
  private static string Sample(string name) => File.ReadAllText(Path.Combine(Root, "contracts", "content-v1", "samples", name));
  private static JsonElement Json(string value) => JsonSerializer.Deserialize<JsonElement>(value);
  private static JsonElement Teach(params string[] refs) => JsonSerializer.SerializeToElement(new { answer = "A", keyPoint = "K", mustAnswer = new[] { "A" }, prerequisites = refs });
  private static DeckReferenceCard Card(string uid, params string[] refs) => new(uid, Teach(refs));

  [Fact]
  public void SharedCases_UseExistingCanonicalizers()
  {
    var cases = Json(Sample("cases.json"));
    foreach (var kind in new[] { "teaching", "tags" })
      foreach (var c in cases.GetProperty(kind).EnumerateArray())
      {
        string? Canon() => kind == "teaching" ? TeachingValidation.Canonicalize(c.GetProperty("input")) : TagsValidation.Canonicalize(c.GetProperty("input"));
        if (c.TryGetProperty("error", out var error)) Assert.Equal(error.GetString(), Assert.Throws<TranslationValidationError>(() => { Canon(); }).Code);
        else
        {
          var result = Canon();
          var expected = c.GetProperty("canonical");
          if (expected.ValueKind == JsonValueKind.Null) Assert.Null(result);
          else Assert.Equal(PublishSnapshot.CanonicalJson(expected.GetRawText()), PublishSnapshot.CanonicalJson(result!));
        }
      }
  }

  [Fact]
  public void SharedTranslations_UseActualVersionAndNullHandling()
  {
    var card = Json(Sample("deck.json")).GetProperty("cards")[1];
    var english = new TranslationValidation.EnglishCard(card.GetProperty("question").GetString()!, card.GetProperty("explanation").GetString(), "", null);
    foreach (var c in Json(Sample("cases.json")).GetProperty("translations").EnumerateArray())
    {
      if (c.GetProperty("valid").GetBoolean()) TranslationValidation.Canonicalize(c.GetProperty("input"), english, "en-US");
      else Assert.Equal(c.GetProperty("error").GetString(), Assert.Throws<TranslationValidationError>(() => TranslationValidation.Canonicalize(c.GetProperty("input"), english, "en-US")).Code);
    }
  }

  [Fact]
  public void MissingVersusNull_PreservesUpdateIntent_AndResponseOmitsEmptyFields()
  {
    Assert.Null(TeachingValidation.Read(Json("{}"), out var missing));
    Assert.False(missing);
    Assert.Null(TeachingValidation.Read(Json("{\"teaching\":null}"), out var sent));
    Assert.True(sent);
    Assert.Null(TagsValidation.Read(Json("{}"), out missing));
    Assert.False(missing);
    Assert.Null(TagsValidation.Read(Json("{\"tags\":null}"), out sent));
    Assert.True(sent);
    var row = new Dictionary<string, object?> { ["teaching"] = Json("null"), ["tags"] = Json("{}") };
    TeachingValidation.ShapeRow(row);
    Assert.Empty(row);
  }

  [Fact]
  public void GoldenDeck_UsesWorkerSerializerAndHashPaths_WithoutLosingStructure()
  {
    var deck = JsonSerializer.Deserialize<DeckExportData>(Sample("deck.json"), ContentJson.Options)!;
    var output = ContentJson.Serialize(deck);
    var readback = JsonSerializer.Deserialize<DeckExportData>(output, ContentJson.Options)!;
    Assert.Equal(output, ContentJson.Serialize(readback));
    Assert.Equal(Sample("legacy-card.bytes.json"), ContentJson.Serialize(deck.Cards[0]));
    var card = readback.Cards[1];
    Assert.Equal("fixture-base", card.Teaching!.Value.GetProperty("prerequisites")[0].GetString());
    Assert.Equal("选择 A。", card.Teaching.Value.GetProperty("zh-CN").GetProperty("answer").GetString());
    Assert.Equal("1.2", card.Tags!.Value.GetProperty("examTask").GetString());
    var english = new TranslationValidation.EnglishCard(card.Question, card.Explanation, card.RealWorldUsage, null);
    var translation = TranslationValidation.Canonicalize(card.Translations!.Value, english, "en-US");
    Assert.Equal(translation, TranslationValidation.Canonicalize(Json(translation!), english, "en-US"));
    var row = Json(Sample("deck.json")).GetProperty("cards")[1].EnumerateObject().ToDictionary(p => p.Name, p => p.Value.ValueKind == JsonValueKind.Number ? (object?)p.Value.GetInt32() : p.Value.Clone());
    var hash = CardContentHash.Compute(row);
    var snapshot = PublishSnapshot.FromRow(row);
    var digest = PublishSnapshot.Digest(new[] { snapshot });
    var changed = JsonNode.Parse(card.Teaching.Value.GetRawText())!;
    changed["prerequisites"] = new JsonArray("fixture-other");
    row["teaching"] = changed.ToJsonString();
    Assert.NotEqual(hash, CardContentHash.Compute(row));
    Assert.NotEqual(digest, PublishSnapshot.Digest(new[] { PublishSnapshot.FromRow(row) }));
    var tagsChanged = new Dictionary<string, object?>(row) { ["teaching"] = card.Teaching, ["tags"] = "{\"domain\":\"1\",\"examTask\":\"1.3\"}" };
    Assert.NotEqual(hash, CardContentHash.Compute(tagsChanged));
    Assert.NotEqual(digest, PublishSnapshot.Digest(new[] { PublishSnapshot.FromRow(tagsChanged) }));
    // Pre-051 payload formula: no teaching/tags slot is appended for a legacy card.
    var legacy = deck.Cards[0];
    var legacyRow = Json(Sample("legacy-card.bytes.json")).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.ValueKind == JsonValueKind.Number ? (object?)p.Value.GetInt32() : p.Value.Clone());
    legacyRow["difficulty"] = 1; // Database integer cells are CLR integers.
    legacyRow["orderInDeck"] = 1;
    legacyRow["revision"] = 1;
    var oldPayload = new object?[] { legacy.Question, legacy.Explanation, "", "", "", 1, "", null, null };
    var oldHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(oldPayload)))).ToLowerInvariant();
    Assert.Equal(oldHash, CardContentHash.Compute(legacyRow));
    legacyRow["tags"] = Json("{\"domain\":\"1\"}");
    Assert.NotEqual(oldHash, CardContentHash.Compute(legacyRow));
    Assert.Equal("tags-only-v1", CardContentHash.Schema(legacyRow));
    var beforeTags = PublishSnapshot.FromRow(legacyRow) with { TagsJson = null };
    Assert.NotEqual(PublishSnapshot.Digest(new[] { beforeTags }), PublishSnapshot.Digest(new[] { PublishSnapshot.FromRow(legacyRow) }));
  }

  [Fact]
  public void Graph_ReportsStableSpecificErrors_AndAllowsSharedDag()
  {
    Assert.True(DeckReferenceValidation.Validate("custom", new[] { Card("a", "c"), Card("b", "c"), Card("c") }).IsValid);
    var cards = new[] { Card("a", "a", "gone", "missing"), new DeckReferenceCard("gone", Deleted: true), Card("a"), Card("x", "y"), Card("y", "x") };
    var result = DeckReferenceValidation.Validate("custom", cards);
    Assert.Equal(new[] { "DUPLICATE_UID", "SELF_REFERENCE", "DELETED_PREREQUISITE", "MISSING_PREREQUISITE", "PREREQUISITE_CYCLE" }, result.Errors.Select(e => e.Code));
    Assert.Equal(result.Errors, DeckReferenceValidation.Validate("custom", cards).Errors);
    Assert.False(result.Truncated);
    Assert.Equal("x", result.Errors[^1].ReferenceUid);
  }

  [Fact]
  public void Graph_IsIterativeAndLinearOnLongChain_AndBoundsDiagnostics()
  {
    var cards = Enumerable.Range(0, 20000).Select(i => i == 19999 ? Card($"u{i}") : Card($"u{i}", $"u{i + 1}")).ToArray();
    Assert.True(DeckReferenceValidation.Validate("custom", cards).IsValid);
    cards[^1] = Card("u19999", "u0");
    Assert.Equal("PREREQUISITE_CYCLE", Assert.Single(DeckReferenceValidation.Validate("custom", cards).Errors).Code);
    var result = DeckReferenceValidation.Validate("custom", Enumerable.Range(0, 200).Select(i => Card($"a{i}", "missing")).ToArray());
    Assert.Equal(DeckReferenceValidation.MaxErrors, result.Errors.Count);
    Assert.True(result.Truncated);
    Assert.False(result.IsValid);
  }

  [Fact]
  public void Graph_ReportsMalformedPayloads_WithoutThrowing_AndSkipsDeletedSources()
  {
    var cards = new[] { new DeckReferenceCard("a", Json("{\"schema\":\"teaching-v2\",\"answer\":\"A\",\"keyPoint\":\"K\",\"mustAnswer\":[\"A\"]}"), Json("{\"future\":true}")), new DeckReferenceCard("deleted", Json("[]"), Deleted: true) };
    var result = DeckReferenceValidation.Validate("custom", cards);
    Assert.Equal(new[] { "TAGS_BAD_SHAPE", "TEACHING_BAD_SHAPE" }, result.Errors.Select(e => e.Code));
  }

  [Theory]
  [InlineData("aws-saa-c03")]
  [InlineData("aws-saa-fundamentals")]
  public void OfficialTags_UseOnlyMappedDecks_AndCurrentTaskEnumeration(string slug)
  {
    var format = File.ReadAllText(Path.Combine(Root, "content", "decks", "FORMAT.md")).Split("### 5.1 AWS SAA-C03")[1].Split("### 5.2")[0];
    var tasks = System.Text.RegularExpressions.Regex.Matches(format, @"(?m)^\| ([1-4]\.[1-5]) ").Select(m => m.Groups[1].Value).ToArray();
    Assert.Equal(14, tasks.Length);
    foreach (var task in tasks)
    {
      var tags = JsonSerializer.SerializeToElement(new { domain = task[..1], examTask = task });
      Assert.True(DeckReferenceValidation.Validate(slug, new[] { new DeckReferenceCard("a", Tags: tags) }).IsValid);
    }
    Assert.True(DeckReferenceValidation.Validate(slug, new[] { Card("legacy") }).IsValid);
    Assert.Equal("DOMAIN_TASK_MISMATCH", Assert.Single(DeckReferenceValidation.Validate(slug, new[] { new DeckReferenceCard("a", Tags: Json("{\"domain\":\"2\",\"examTask\":\"1.1\"}")) }).Errors).Code);
    var custom = new DeckReferenceCard("a", Tags: Json("{\"examTask\":\"custom\"}"));
    Assert.True(DeckReferenceValidation.Validate("custom", new[] { custom }).IsValid);
    Assert.Contains(DeckReferenceValidation.Validate(slug, new[] { custom }).Errors, e => e.Code == "UNKNOWN_EXAM_TASK");
    Assert.Equal("DOMAIN_TASK_MISMATCH", Assert.Single(DeckReferenceValidation.Validate(slug, new[] { new DeckReferenceCard("a", Tags: Json("{\"domain\":\"1\"}")) }).Errors).Code);
  }
}
