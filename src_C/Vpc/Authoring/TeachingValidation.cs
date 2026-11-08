using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// The structured teaching payload (migration 051): a card's back face split into answer, key point and
/// optional watch out, the self-check items the learner must be able to produce (mustAnswer), optional
/// prerequisite stableUids, and a zh-CN mirror of the prose fields. English is the source of truth.
/// Structural validation only: the agreement between these fields and the card's prose explanation is a
/// release-pipeline assertion, not a server concern.
/// </summary>
public static class TeachingValidation
{
  public const string Schema = "teaching-v1";
  private const int MaxText = 4000;
  private const int MaxMustAnswer = 8;
  private const int MaxItem = 500;
  private const int MaxPrerequisites = 16;
  private const int MaxUid = 120;

  /// <summary>True when the element carries a non-empty teaching payload; null/empty object/absent key are all "no teaching".</summary>
  public static string? Read(JsonElement body, out bool sent)
  {
    var fields = body.EnumerateObject().Where(p => p.NameEquals("teaching")).ToList();
    if (fields.Count > 1) throw Bad("duplicate teaching key");
    sent = fields.Count == 1;
    return sent ? Canonicalize(fields[0].Value) : null;
  }

  /// <summary>Canonical compact JSON for storage, or null when the payload is empty/absent.</summary>
  public static string? Canonicalize(JsonElement raw)
  {
    if (raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
    if (raw.ValueKind != JsonValueKind.Object) throw Bad("teaching must be an object");
    if (!raw.EnumerateObject().Any()) return null;
    if (raw.TryGetProperty("schema", out var schemaEl) &&
        (schemaEl.ValueKind != JsonValueKind.String || schemaEl.GetString() != Schema))
      throw Bad($"teaching.schema must be \"{Schema}\"");

    var answer = RequiredText(raw, "answer");
    var keyPoint = RequiredText(raw, "keyPoint");
    string? watchOut = null;
    if (raw.TryGetProperty("watchOut", out var watchEl) && watchEl.ValueKind != JsonValueKind.Null)
      watchOut = Text(watchEl, "watchOut");
    var mustAnswer = StringArray(raw, "mustAnswer", required: true, maxItems: MaxMustAnswer, maxItem: MaxItem)
      ?? throw Bad("teaching.mustAnswer must be an array of 1..8 strings");
    var prerequisites = StringArray(raw, "prerequisites", required: false, maxItems: MaxPrerequisites, maxItem: MaxUid);
    string? goal = null;
    if (raw.TryGetProperty("goal", out var goalEl) && goalEl.ValueKind != JsonValueKind.Null)
      goal = Text(goalEl, "goal");

    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
      writer.WriteStartObject();
      writer.WriteString("schema", Schema);
      writer.WriteString("answer", answer);
      writer.WriteString("keyPoint", keyPoint);
      if (watchOut is not null) writer.WriteString("watchOut", watchOut);
      writer.WritePropertyName("mustAnswer");
      WriteStrings(writer, mustAnswer);
      if (prerequisites is not null) { writer.WritePropertyName("prerequisites"); WriteStrings(writer, prerequisites); }
      if (goal is not null) writer.WriteString("goal", goal);
      if (raw.TryGetProperty("zh-CN", out var zhEl) && zhEl.ValueKind != JsonValueKind.Null)
      {
        if (zhEl.ValueKind != JsonValueKind.Object) throw Bad("teaching.zh-CN must be an object");
        writer.WritePropertyName("zh-CN");
        writer.WriteStartObject();
        var zhAnswer = ZhText(zhEl, "answer");
        var zhKeyPoint = ZhText(zhEl, "keyPoint");
        writer.WriteString("answer", zhAnswer);
        writer.WriteString("keyPoint", zhKeyPoint);
        if (zhEl.TryGetProperty("watchOut", out var zhWatchEl) && zhWatchEl.ValueKind != JsonValueKind.Null)
          writer.WriteString("watchOut", ZhText(zhEl, "watchOut"));
        if (zhEl.TryGetProperty("goal", out var zhGoalEl) && zhGoalEl.ValueKind != JsonValueKind.Null)
          writer.WriteString("goal", ZhText(zhEl, "goal"));
        writer.WriteEndObject();
      }
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }

  public static string? Normalize(string? json) => string.IsNullOrWhiteSpace(json) ? null : Canonicalize(JsonSerializer.Deserialize<JsonElement>(json));

  /// <summary>In place, for an authoring response row: null/absent teaching and tags keys are removed so the
  /// wire never carries "teaching": null for a card without a payload; present cells become JSON objects.</summary>
  public static void ShapeRow(Dictionary<string, object?> row)
  {
    if (Helpers.JsonbElement(row, "teaching") is { } teaching && Canonicalize(teaching) is { } canonical)
      row["teaching"] = JsonSerializer.Deserialize<JsonElement>(canonical);
    else
      row.Remove("teaching");
    if (Helpers.JsonbElement(row, "tags") is { } tags && TagsValidation.Canonicalize(tags) is { } tagsCanonical)
      row["tags"] = JsonSerializer.Deserialize<JsonElement>(tagsCanonical);
    else
      row.Remove("tags");
  }

  private static string RequiredText(JsonElement raw, string key)
  {
    if (!raw.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String) throw Bad($"teaching.{key} must be a string");
    var text = value.GetString()!.Trim();
    if (text.Length < 1 || text.Length > MaxText) throw Bad($"teaching.{key} must contain 1..{MaxText} characters");
    return text;
  }

  private static string Text(JsonElement value, string key)
  {
    var text = value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim() : throw Bad($"teaching.{key} must be a string");
    if (text.Length < 1 || text.Length > MaxText) throw Bad($"teaching.{key} must contain 1..{MaxText} characters");
    return text;
  }

  private static string ZhText(JsonElement zh, string key)
  {
    if (!zh.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String) throw Bad($"teaching.zh-CN.{key} must be a string");
    var text = value.GetString()!.Trim();
    if (text.Length < 1 || text.Length > MaxText) throw Bad($"teaching.zh-CN.{key} must contain 1..{MaxText} characters");
    return text;
  }

  private static IReadOnlyList<string>? StringArray(JsonElement raw, string key, bool required, int maxItems, int maxItem)
  {
    if (!raw.TryGetProperty(key, out var arr) || arr.ValueKind == JsonValueKind.Null)
    {
      if (required) throw Bad($"teaching.{key} must be an array of 1..{maxItems} strings");
      return null;
    }
    if (arr.ValueKind != JsonValueKind.Array) throw Bad($"teaching.{key} must be an array");
    if (arr.GetArrayLength() < (required ? 1 : 0) || arr.GetArrayLength() > maxItems) throw Bad($"teaching.{key} must contain {(required ? "1" : "0")}..{maxItems} items");
    if (!required && arr.GetArrayLength() == 0) return null;
    var list = new List<string>(arr.GetArrayLength());
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var item in arr.EnumerateArray())
    {
      if (item.ValueKind != JsonValueKind.String) throw Bad($"teaching.{key} items must be strings");
      var text = item.GetString()!.Trim();
      if (text.Length < 1 || text.Length > maxItem) throw Bad($"teaching.{key} items must contain 1..{maxItem} characters");
      if (!seen.Add(text)) throw Bad($"teaching.{key} items must be unique");
      list.Add(text);
    }
    return list;
  }

  private static void WriteStrings(Utf8JsonWriter writer, IReadOnlyList<string> values)
  {
    writer.WriteStartArray();
    foreach (var value in values) writer.WriteStringValue(value);
    writer.WriteEndArray();
  }

  private static TranslationValidationError Bad(string message) => new("TEACHING_BAD_SHAPE", message);
}
