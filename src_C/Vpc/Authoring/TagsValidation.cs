using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>Small navigation tags (migration 051): {"domain"?: "1".."4", "examTask"?: "1.1".."4.9"}. Absent or empty means untagged.</summary>
public static class TagsValidation
{
  private const int MaxValue = 40;

  public static string? Read(JsonElement body, out bool sent)
  {
    var fields = body.EnumerateObject().Where(p => p.NameEquals("tags")).ToList();
    if (fields.Count > 1) throw Bad("duplicate tags key");
    sent = fields.Count == 1;
    return sent ? Canonicalize(fields[0].Value) : null;
  }

  public static string? Canonicalize(JsonElement raw)
  {
    if (raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
    if (raw.ValueKind != JsonValueKind.Object) throw Bad("tags must be an object");
    if (!raw.EnumerateObject().Any()) return null;
    string? domain = null, examTask = null;
    foreach (var prop in raw.EnumerateObject())
    {
      switch (prop.Name)
      {
        case "domain":
          domain = Value(prop.Value, "domain");
          if (domain is not ("1" or "2" or "3" or "4")) throw Bad("tags.domain must be one of 1, 2, 3, 4");
          break;
        case "examTask":
          examTask = Value(prop.Value, "examTask");
          break;
        default:
          throw Bad($"tags.{prop.Name} is not a supported tag");
      }
    }
    if (domain is null && examTask is null) return null;
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
      writer.WriteStartObject();
      if (domain is not null) writer.WriteString("domain", domain);
      if (examTask is not null) writer.WriteString("examTask", examTask);
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }

  public static string? Normalize(string? json) => string.IsNullOrWhiteSpace(json) ? null : Canonicalize(JsonSerializer.Deserialize<JsonElement>(json));

  private static string Value(JsonElement value, string key)
  {
    var text = value.ValueKind == JsonValueKind.String ? value.GetString()!.Trim() : throw Bad($"tags.{key} must be a string");
    if (text.Length < 1 || text.Length > MaxValue) throw Bad($"tags.{key} must contain 1..{MaxValue} characters");
    return text;
  }

  private static TranslationValidationError Bad(string message) => new("TAGS_BAD_SHAPE", message);
}
