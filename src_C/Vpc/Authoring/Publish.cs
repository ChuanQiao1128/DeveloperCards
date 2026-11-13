using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.SQS;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static partial class Publish
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string? PremiumBucket = Environment.GetEnvironmentVariable("PREMIUM_BUCKET");
  private static readonly string? PublishJobQueueUrl = Environment.GetEnvironmentVariable("PUBLISH_JOB_QUEUE_URL");

  /// <summary>Test seam (InternalsVisibleTo). When non-null the publish path uses these values instead of the
  /// PUBLISH_JOB_QUEUE_URL / CONTENT_BUCKET captured at type init, and Send instead of the SQS client.
  /// Always null in production.</summary>
  internal sealed record EnqueueSeam(string QueueUrl, string ContentBucket, Func<SendMessageRequest, Task> Send);
  internal static EnqueueSeam? TestEnqueueSeam;

  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
  }

  private static readonly string ContentPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
  private static readonly string PremiumPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");
  private static readonly string ManifestKey = $"{ContentPrefix}/manifest.json";

  private static AmazonS3Client? _s3;
  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS()
  {
    if (_sqs is not null) return _sqs;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _sqs = new AmazonSQSClient(RegionEndpoint.GetBySystemName(region));
    return _sqs;
  }

  // Warmup hooks. These deliberately expose the existing lazy factory instead of replacing
  // it: the client must still be creatable on demand so that a skipped or failed warmup
  // leaves the request path working exactly as before.
  internal static AmazonSQSClient SqsForWarmup() => SQS();

  // Warmup reads the same captured value the handler reads, so a missing env var is seen
  // identically in both places.
  internal static string? WarmupQueueUrl => PublishJobQueueUrl;

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    var s3Client = _s3;
    _s3 = null;
    if (s3Client is not null) try { s3Client.Dispose(); } catch { /* best-effort */ }

    var sqsClient = _sqs;
    _sqs = null;
    if (sqsClient is not null) try { sqsClient.Dispose(); } catch { /* best-effort */ }
  }

  private static string MakeBuildId()
  {
    // 20251214T094955Z-a1b2c3d4
    var utc = DateTime.UtcNow;
    var rand = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
    return $"{utc:yyyyMMdd'T'HHmmss'Z'}-{rand}";
  }

  private static string InferTier(long deckType, object? tierValue)
  {
    var t = (Convert.ToString(tierValue, CultureInfo.InvariantCulture) ?? string.Empty).Trim().ToLowerInvariant();
    if (t is "free" or "premium") return t;
    return deckType == 1 ? "free" : "premium";
  }

  /// <summary>
  /// First card whose stored MCQ blob fails the publish rules, or null when every row passes.
  /// Pure (no IO). Rows arrive in order_in_deck order, so the first failure is deterministic.
  /// Order of checks per row (C00 §2.9.4): Canonicalize against the stem, then explanation
  /// non-blank (MCQ_EXPLANATION_REQUIRED), then difficulty 1..3 (MCQ_DIFFICULTY_RANGE).
  /// </summary>
  internal static (string StableUid, string Code)? FirstMcqGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows)
  {
    foreach (var c in cardRows)
    {
      var mcq = Helpers.JsonbElement(c, "mcq");
      if (mcq is null) continue;

      var stableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty;
      var question = Convert.ToString(c["question"], CultureInfo.InvariantCulture);
      var explanation = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture);
      var difficulty = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture);

      try
      {
        McqValidation.Canonicalize(mcq.Value, question);
      }
      catch (McqValidationError mex)
      {
        return (stableUid, mex.Code);
      }

      if (string.IsNullOrWhiteSpace(explanation)) return (stableUid, "MCQ_EXPLANATION_REQUIRED");
      if (!McqValidation.IsMcqDifficulty(difficulty)) return (stableUid, "MCQ_DIFFICULTY_RANGE");
    }

    return null;
  }

  /// <summary>
  /// The <c>publish_gate</c> ledger event of an MCQ gate refusal (R18 J08, contract §9.3): one defect per
  /// defective card version. The dedupe key carries a fingerprint of the refused card's content, so the same
  /// unchanged card refused again is the same defect and an edited card is a new one. Best-effort on the
  /// handler's connection (no transaction is open); the refusal's response never depends on it.
  /// </summary>
  private static async Task RecordGateDefectAsync(NpgsqlConnection conn, long deckId, string stableUid, string code, IReadOnlyList<Dictionary<string, object?>> cardRows)
  {
    try
    {
      var row = cardRows.First(c => string.Equals(Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture), stableUid, StringComparison.Ordinal));
      var fingerprint = GateFingerprint(row);
      await AutomationLedger.RecordAsync(conn, new AutomationEvent("publish_gate", 0, "success",
        DefectsCaught: 1, DeckId: deckId, Ref: stableUid,
        DedupeKey: $"publish-gate:{deckId}:{stableUid}:{fingerprint}",
        Details: new { code }));
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "ledger", reason = "record_failed", automation = "publish_gate", error = ex.Message });
    }
  }

  /// <summary>
  /// First 16 lowercase hex chars of SHA-256 over question, explanation, difficulty and the mcq jsonb text, plus the
  /// translations and translation_basis jsonb text when the card has translations (so an untranslated card keeps its
  /// fingerprint, and a fixed or restamped translation is a new defect).
  /// </summary>
  internal static string GateFingerprint(IReadOnlyDictionary<string, object?> row)
  {
    static string Cell(IReadOnlyDictionary<string, object?> r, string key) =>
      Convert.ToString(r.TryGetValue(key, out var v) ? v : null, CultureInfo.InvariantCulture) ?? string.Empty;

    var text = Cell(row, "question") + "\n" + Cell(row, "explanation") + "\n" + Cell(row, "difficulty") + "\n" + Cell(row, "mcq");
    if (Cell(row, "translations").Length > 0) text += "\n" + Cell(row, "translations") + "\n" + Cell(row, "translationBasis");
    if (Helpers.JsonbElement(row, "frontHelp") is { } help && FrontHelpValidation.Canonicalize(help) is { } canonical) text += "\nfront-help-v1\n" + canonical;
    var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text));
    return Convert.ToHexString(hash).ToLowerInvariant()[..16];
  }

  /// <summary>
  /// First card that is not publishable in one of the deck's declared translation locales, or null when every row
  /// passes (or the deck declares none). Pure (no IO), rows in order_in_deck order. Per row: every declared locale is
  /// present (TRANSLATION_MISSING), the stored translations still mirror the card's English (the specific
  /// TranslationValidation code), and the stored basis is the current English (TRANSLATION_STALE).
  /// </summary>
  internal static (string StableUid, string Code)? FirstTranslationGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows,
    IReadOnlyList<string> translationLocales, string? deckLocale)
  {
    if (translationLocales.Count == 0) return null;

    foreach (var c in cardRows)
    {
      var stableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty;
      var translations = Helpers.JsonbElement(c, "translations");
      if (translations is not { ValueKind: JsonValueKind.Object } stored ||
          translationLocales.Any(locale => !stored.TryGetProperty(locale, out _)))
      {
        return (stableUid, "TRANSLATION_MISSING");
      }

      var english = TranslationValidation.EnglishFromRow(c);
      try
      {
        TranslationValidation.Canonicalize(stored, english, deckLocale);
      }
      catch (TranslationValidationError tex)
      {
        return (stableUid, tex.Code);
      }

      var status = TranslationValidation.Status(stored.GetRawText(),
        Convert.ToString(c.TryGetValue("translationBasis", out var b) ? b : null, CultureInfo.InvariantCulture), english);
      if (status is null || translationLocales.Any(locale => !status.TryGetValue(locale, out var s) || s != "ok"))
      {
        return (stableUid, "TRANSLATION_STALE");
      }
    }

    return null;
  }

  /// <summary>
  /// <c>decks.translation_locales</c> read as <c>coalesce(to_jsonb(decks) -&gt; 'translation_locales', '[]')</c>: the jsonb
  /// array text (or a string[] read from the column itself); anything else → empty.
  /// </summary>
  internal static IReadOnlyList<string> TranslationLocales(object? value)
  {
    switch (value)
    {
      case string[] locales:
        return locales;
      case string json when !string.IsNullOrWhiteSpace(json):
        using (var doc = JsonDocument.Parse(json))
        {
          return doc.RootElement.ValueKind == JsonValueKind.Array
            ? doc.RootElement.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).ToList()
            : [];
        }
      default:
        return [];
    }
  }

  /// <summary>
  /// <see cref="FirstTranslationGateFailure"/> for <paramref name="deckId"/>, reading the deck's declared locales and
  /// own locale. For callers that hold the export rows but not the deck row (the automation's dry run).
  /// </summary>
  internal static async Task<(string StableUid, string Code)?> TranslationGateFailureAsync(NpgsqlConnection conn, long deckId,
    IReadOnlyList<Dictionary<string, object?>> cardRows)
  {
    var deck = await DbUtil.QueryAsync(conn, null,
      """select locale, coalesce(to_jsonb(decks) -> 'translation_locales', '[]'::jsonb) as "translationLocales" from decks where id = $1""", [deckId]);
    if (deck.Count == 0) return null;
    return FirstTranslationGateFailure(cardRows, TranslationLocales(deck[0]["translationLocales"]), deck[0]["locale"] as string);
  }

  /// <summary>
  /// The cards a publish exports, in export order. Internal so the gate test reads rows with
  /// the exact production text (jsonb comes back as PG text, and that is what the gate parses).
  /// The migration-047 columns are read through the row's jsonb image (null before 047 runs), so the
  /// console publish and the automation keep working in the window between a code deploy and Migrate.
  /// </summary>
  internal const string CardsSql = """
    select
      stable_uid as "stableUid",
      order_in_deck as "orderInDeck",
      difficulty,
      question,
      explanation,
      code_language as "codeLanguage",
      code_snippet as "codeSnippet",
      real_world_usage as "realWorldUsage",
      revision,
      topic,
      mcq,
      source,
      nullif(to_jsonb(cards) -> 'front_help', 'null'::jsonb) as "frontHelp",
      nullif(to_jsonb(cards) -> 'translations', 'null'::jsonb) as translations,
      nullif(to_jsonb(cards) -> 'translation_basis', 'null'::jsonb) as "translationBasis",
      nullif(to_jsonb(cards) -> 'teaching', 'null'::jsonb) as teaching,
      nullif(to_jsonb(cards) -> 'tags', 'null'::jsonb) as tags
    from cards
    where deck_id = $1 and is_deleted = 0
    order by order_in_deck asc, id asc
    """;

  internal static async Task<PublishStart?> ReferenceGateAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long deckId, string slug,
    IReadOnlyList<Dictionary<string, object?>> rows)
  {
    var cards = rows.Select(row => new DeckReferenceCard(Convert.ToString(row["stableUid"], CultureInfo.InvariantCulture) ?? "",
      Helpers.JsonbElement(row, "teaching"), Helpers.JsonbElement(row, "tags"))).ToList();
    foreach (var row in await DbUtil.QueryAsync(conn, tx, "select stable_uid from cards where deck_id=$1 and is_deleted<>0 order by id", [deckId]))
      cards.Add(new(Convert.ToString(row["stable_uid"], CultureInfo.InvariantCulture) ?? "", Deleted: true));
    var result = DeckReferenceValidation.Validate(slug, cards);
    return result.IsValid ? null : Refuse(400, "CONTENT_REFERENCE_GATE", string.Join("; ", result.Errors.Select(e => $"{e.StableUid}: {e.Code}" + (e.ReferenceUid is null ? "" : $" ({e.ReferenceUid})"))) + (result.Truncated ? "; additional errors omitted" : ""));
  }

  public static async Task<APIGatewayProxyResponse> HandleAuthoringPublish(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var mode = (req.Query.TryGetValue("mode", out var m) ? m : string.Empty).Trim().ToLowerInvariant() == "preview"
      ? "preview"
      : "publish";

    var queueUrl = TestEnqueueSeam?.QueueUrl ?? PublishJobQueueUrl;

    if (mode == "publish" && string.IsNullOrEmpty(queueUrl)) return Helpers.ConfigError(res, "Missing env PUBLISH_JOB_QUEUE_URL");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var body = doc.RootElement;
      if (!body.TryGetProperty("deckId", out var deckIdEl)) return res.BadRequest("VALIDATION_ERROR", "deckId is required");
      var deckIdInt = Validation.RequireInteger(deckIdEl.ToString(), "deckId");
      var note = body.TryGetProperty("note", out var noteEl) && noteEl.ValueKind != JsonValueKind.Null ? noteEl.ToString().Trim() : null;

      var isSuperAdmin = auth.IsSuperAdmin;
      var adminSub = auth.UserSub;

      var denyDeck = await Helpers.RequireDeckWrite(conn, adminSub, deckIdInt, isSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      if (mode == "publish")
      {
        // The publish path is shared with the automation (A00 §6.4); the console binds the snapshot only when the
        // AI QA gate is enforced and resumes a recent active job instead of refusing it.
        if (await ContentRelease.Applies(conn, deckIdInt))
          return await StartControlledAsync(conn, deckIdInt, body, auth, note, res);
        var start = await StartPublishAsync(conn, deckIdInt, adminSub!, note, bindSnapshot: Qa.QaGate.IsEnforced(), expectedSnapshot: null,
          allowResume: true, actionId: OptionalAction(body), requestHash: ContentRelease.PayloadHash(body), actorSuperadmin: auth.IsSuperAdmin);
        return StartResponse(start, res);
      }

      var loaded = await LoadDeckAsync(conn, deckIdInt);
      if (loaded.Refusal is not null) return StartResponse(loaded.Refusal, res);
      var (deck, deckSlug, cardRows, deckType, tier) = (loaded.Deck!, loaded.DeckSlug!, loaded.CardRows!, loaded.DeckType, loaded.Tier!);

      var referenceGate = await ReferenceGateAsync(conn, null, deckIdInt, deckSlug, cardRows);
      if (referenceGate is not null) return StartResponse(referenceGate, res);

      var baseCards = cardRows.Select(c =>
      {
        var fields = new Dictionary<string, object?>
        {
          ["stableUid"] = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture),
          ["orderInDeck"] = Convert.ToInt32(c["orderInDeck"], CultureInfo.InvariantCulture),
          ["difficulty"] = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture),
          ["question"] = Convert.ToString(c["question"], CultureInfo.InvariantCulture),
          ["explanation"] = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture) ?? string.Empty,
          ["codeLanguage"] = c.TryGetValue("codeLanguage", out var cl) ? cl : null,
          ["codeSnippet"] = Convert.ToString(c.TryGetValue("codeSnippet", out var cs) ? cs : null, CultureInfo.InvariantCulture) ?? string.Empty,
          ["realWorldUsage"] = Convert.ToString(c.TryGetValue("realWorldUsage", out var rw) ? rw : null, CultureInfo.InvariantCulture) ?? string.Empty,
          ["revision"] = Convert.ToInt32(c.TryGetValue("revision", out var rv) ? (rv ?? 1) : 1, CultureInfo.InvariantCulture),
          ["topic"] = c.TryGetValue("topic", out var tp) ? tp as string : null,
          ["mcq"] = Helpers.JsonbElement(c, "mcq"),
          ["source"] = Helpers.JsonbElement(c, "source"),
          ["translations"] = Helpers.JsonbElement(c, "translations"),
        };
        if (Helpers.JsonbElement(c, "frontHelp") is { } help && FrontHelpValidation.Canonicalize(help) is { } canonical)
          fields["frontHelp"] = JsonSerializer.Deserialize<JsonElement>(canonical);
        if (Helpers.JsonbElement(c, "teaching") is { } teaching && TeachingValidation.Canonicalize(teaching) is { } teachingCanonical)
          fields["teaching"] = JsonSerializer.Deserialize<JsonElement>(teachingCanonical);
        if (Helpers.JsonbElement(c, "tags") is { } tags && TagsValidation.Canonicalize(tags) is { } tagsCanonical)
          fields["tags"] = JsonSerializer.Deserialize<JsonElement>(tagsCanonical);
        return fields;
      }).ToList();

      var baseDeckJson = new
      {
        slug = deckSlug,
        title = Convert.ToString(deck["title"], CultureInfo.InvariantCulture),
        locale = Convert.ToString(deck.TryGetValue("locale", out var lo) ? lo : null, CultureInfo.InvariantCulture) ?? "en-US",
        deckType = (int)deckType,
        version = Convert.ToString(deck.TryGetValue("version", out var ver) ? ver : null, CultureInfo.InvariantCulture) ?? "1",
        totalCards = ToInt(deck.TryGetValue("totalCards", out var tc) ? tc : null, baseCards.Count),
        cards = baseCards,
      };

      return res.Ok(new
      {
        mode = "preview",
        deckId = deckIdInt,
        deckSlug,
        tier,
        cardCount = baseCards.Count,
        export = baseDeckJson,
      });
    }
    catch (PostgresException pg) when (pg.SqlState == "P0001")
    {
      return Helpers.ErrorEnvelope(res, 409, "RELEASE_CONFLICT", pg.MessageText);
    }
    catch (PostgresException pg) when (pg.SqlState == "23505")
    {
      return Helpers.MapUniqueViolation409(pg, res) ?? res.Error500(pg);
    }
    catch (TranslationValidationError ex)
    {
      return res.BadRequest(ex.Code,ex.Message);
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return Helpers.ErrorEnvelope(res, ex.Message.StartsWith("IDEMPOTENCY_CONFLICT") ? 409 : 400, "VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      Log.Error("Publish handler error:", ex);
      return res.Error500(ex);
    }
  }

  /// <summary>
  /// What <see cref="StartPublishAsync"/> did: <c>queued</c> (a new job was inserted and sent), <c>resumed</c> (a
  /// recent active job was returned, redelivering it when still PENDING), <c>dispatch_unconfirmed</c> (the job
  /// remains committed but the send result is unknown), or <c>refused</c> (<see cref="HttpStatus"/>/<see cref="Code"/>/<see cref="Message"/>
  /// as the console answers them). <see cref="ErrorExtras"/> is the chained QA run (<see cref="Qa.QaRuns.ChainedRun"/>)
  /// of an <c>AI_QA_REQUIRED</c> refusal, which the console answers as <c>error.runId</c>/<c>error.qaRun</c>.
  /// </summary>
  public sealed record PublishStart(string Outcome /* queued | resumed | dispatch_unconfirmed | refused */, int HttpStatus, string? Code, string? Message,
    string? JobId, string? BuildId, string? SnapshotSha256, object? ErrorExtras);

  public const string Queued = "queued", Resumed = "resumed", DispatchUnconfirmed = "dispatch_unconfirmed", Refused = "refused";

  private const string PublishInProgressMessage =
    "A publish for this deck is still PENDING or PROCESSING. Wait for the worker, or run POST /api/v1/admin/publish/reap and retry.";

  private const string StaleMessage = "Cards changed while the publish was being checked; publish again so the AI QA gate sees the current cards";

  private static PublishStart Refuse(int status, string code, string message, object? extras = null) =>
    new(Refused, status, code, message, null, null, null, extras);

  /// <summary>
  /// The publish-mode path of <see cref="HandleAuthoringPublish"/> after the auth and deck-permission checks (R18A A04,
  /// contract A00 §6.4), shared by the console and the automation: deck read, cards, premium config, the MCQ gate (and
  /// its ledger defect), the AI QA gate evaluated for <paramref name="actorSub"/>, the snapshot, the resume, the
  /// <c>deck_publishes</c> insert and the SQS send. <paramref name="bindSnapshot"/> stores the gated-vs-current digest
  /// in <c>qa_snapshot_sha256</c>; a non-null <paramref name="expectedSnapshot"/> that differs from the digest of the
  /// cards read here is refused <c>AI_QA_STALE</c>; <paramref name="allowResume"/> = false refuses any active job of
  /// the deck with <c>PUBLISH_IN_PROGRESS</c> instead of returning it. A non-null <paramref name="expectedDeckUpdatedAt"/>
  /// (the automation's check 5 value) that is no longer the deck's <c>updated_at</c> is refused <c>AI_QA_STALE</c> too,
  /// and is stored on the job so the Worker refuses to build after a later settings edit (R18C, backend-design-11). Every
  /// job records the ids of the deck's live cards at its insert in <c>card_ids</c> (backend-design-12). Validation
  /// errors and a <c>23505</c> on <c>uq_deck_publishes_active</c> propagate as exceptions. An ambiguous SQS
  /// result returns <c>dispatch_unconfirmed</c> with the committed identity and never changes the worker status.
  /// </summary>
  internal static async Task<PublishStart> StartPublishAsync(NpgsqlConnection conn, long deckId, string actorSub, string? note,
    bool bindSnapshot, string? expectedSnapshot, bool allowResume, DateTime? expectedDeckUpdatedAt = null, CancellationToken ct = default,
    string? actionId = null, string? requestHash = null, bool actorSuperadmin = false)
  {
    ct.ThrowIfCancellationRequested();
    var queueUrl = TestEnqueueSeam?.QueueUrl ?? PublishJobQueueUrl;
    var contentBucket = TestEnqueueSeam?.ContentBucket ?? ContentBucket;
    if (string.IsNullOrEmpty(queueUrl)) return Refuse(503, "CONFIG_ERROR", "Missing env PUBLISH_JOB_QUEUE_URL");

    if (await ContentRelease.Applies(conn, deckId)) return Refuse(409, "CODEX_REVIEW_REQUIRED", "Use the controlled Codex release publish with receipt, snapshot and expectedLive");
    var durable = await PublishDelivery.Ready(conn);
    if (actionId is not null && !durable) return Refuse(503, "PUBLISH_RECOVERY_NOT_READY", "actionId requires migration 053; legacy publication remains available");
    if (actionId is not null)
    {
      var replay = await ReplayOrdinary(conn, null, deckId, actionId, requestHash);
      if (replay is not null) return replay.Outcome == Resumed
        ? await DispatchPublishAsync(conn, replay, deckId, "", actorSub, note, queueUrl, ct) : replay;
    }
    var editingSnapshot = durable ? (string?)await DbUtil.ExecuteScalarAsync(conn, null, "select content_editing_snapshot($1)", [deckId]) : null;
    var loaded = await LoadDeckAsync(conn, deckId);
    if (loaded.Refusal is not null) return loaded.Refusal;
    bindSnapshot |= durable;
    var (deckSlug, cardRows, tier) = (loaded.DeckSlug!, loaded.CardRows!, loaded.Tier!);

    // The automation checked exactly these cards; anything else changed since (A00 §6.3).
    if (expectedSnapshot is not null &&
        !string.Equals(expectedSnapshot, PublishSnapshot.Digest(cardRows.Select(PublishSnapshot.FromRow)), StringComparison.Ordinal))
    {
      return StaleRefusal(deckId);
    }
    // The automation checked exactly these deck settings; a human edit since then is shipped only by a human.
    if (expectedDeckUpdatedAt is { } checkedAt &&
        await DbUtil.ExecuteScalarAsync(conn, null, "select updated_at is distinct from $2 from decks where id = $1", [deckId, checkedAt]) is not false)
    {
      return StaleRefusal(deckId);
    }

    var referenceGate = await ReferenceGateAsync(conn, null, deckId, deckSlug, cardRows);
    if (referenceGate is not null) return referenceGate;

    // Optional teaching/help/tag structure is checked even when cloud QA is disabled.
    foreach (var card in cardRows)
    {
      if (Helpers.JsonbElement(card,"frontHelp") is { } help) FrontHelpValidation.Canonicalize(help);
      if (Helpers.JsonbElement(card,"teaching") is { } teaching) TeachingValidation.Canonicalize(teaching);
      if (Helpers.JsonbElement(card,"tags") is { } tags) TagsValidation.Canonicalize(tags);
    }

    // Pre-enqueue gate (publish only — the preview above has already returned). A stored MCQ
    // blob that no longer satisfies the API rules must not reach the Worker, which serialises
    // it verbatim into deck.json / chunks / patches.
    var gate = FirstMcqGateFailure(cardRows);
    if (gate is not null)
    {
      await RecordGateDefectAsync(conn, deckId, gate.Value.StableUid, gate.Value.Code, cardRows);
      return Refuse(400, "MCQ_PUBLISH_GATE", $"{gate.Value.StableUid}: {gate.Value.Code}");
    }

    // Translation gate: a deck that declares translation locales ships only cards whose translations are complete and
    // were written against the current English. A deck that declares none is not checked.
    var translationGate = FirstTranslationGateFailure(cardRows, TranslationLocales(loaded.Deck!["translationLocales"]),
      loaded.Deck!["locale"] as string);
    if (translationGate is not null)
    {
      await RecordGateDefectAsync(conn, deckId, translationGate.Value.StableUid, translationGate.Value.Code, cardRows);
      return Refuse(400, "TRANSLATION_PUBLISH_GATE", $"{translationGate.Value.StableUid}: {translationGate.Value.Code}");
    }

    // AI QA gate (contract §7.10): refuses only when AI_QA_ENABLED and AI_QA_REQUIRED are both truthy. A refusal
    // for unreviewed cards also starts (or reuses) the QA run that would clear it (automation-17).
    var qaGate = await Qa.QaGate.EvaluatePublishRefusalAsync(conn, deckId, actorSub, ct);
    if (qaGate is not null) return Refuse(qaGate.HttpStatus, qaGate.Code, qaGate.Message, qaGate.Chained);

    // Bind the build to what the gate passed (backend-design-16): the cards read before the gate must still be
    // the cards after it, and the Worker refuses to build from anything else (AI_QA_STALE).
    string? qaSnapshot = null;
    if (bindSnapshot)
    {
      var gated = PublishSnapshot.Digest(cardRows.Select(PublishSnapshot.FromRow));
      var current = PublishSnapshot.Digest((await DbUtil.QueryAsync(conn, null, CardsSql, [deckId])).Select(PublishSnapshot.FromRow));
      if (!string.Equals(gated, current, StringComparison.Ordinal)) return StaleRefusal(deckId);
      qaSnapshot = current;
    }

    // --- ASYNC PUBLISH LOGIC ---

    // 💡 核心防御：防重复并发提交（幂等性）。
    // A recent PENDING job is redelivered with the same identity; PROCESSING only resumes polling.
    // The automation (allowResume = false) never takes over a job: any active job of the deck refuses it.
    const string checkDuplicateSql = """
      select job_id as "jobId", status, build_id as "buildId",
        to_jsonb(deck_publishes) ->> 'qa_snapshot_sha256' as "snapshotSha256",
        published_by_admin_sub as "adminSub", note
      from deck_publishes 
      where deck_id = $1 
        and status in ('PENDING', 'PROCESSING') 
        and updated_at > now() - interval '15 minutes'
      limit 1
      """;
    const string checkActiveSql = """
      select job_id as "jobId"
      from deck_publishes
      where deck_id = $1 and status in ('PENDING', 'PROCESSING')
      limit 1
      """;
    var existingRows = await DbUtil.QueryAsync(conn, null, allowResume ? checkDuplicateSql : checkActiveSql, [deckId]);
    if (existingRows.Count > 0)
    {
      var existingJobId = Convert.ToString(existingRows[0]["jobId"], CultureInfo.InvariantCulture);
      if (actionId is not null)
      {
        var replay=await ReplayOrdinary(conn,null,deckId,actionId,requestHash);
        if (replay is not null) return replay.Outcome==Resumed
          ? await DispatchPublishAsync(conn,replay,deckId,deckSlug,actorSub,note,queueUrl,ct) : replay;
      }
      if (!allowResume || actionId is not null)
      {
        Log.Event("info", new { tag = "publish", outcome = "refused", code = "PUBLISH_IN_PROGRESS", jobId = existingJobId, deckId, deckSlug });
        return Refuse(409, "PUBLISH_IN_PROGRESS", PublishInProgressMessage);
      }
      Log.Event("info", new { tag = "publish", outcome = "resumed", jobId = existingJobId, deckId, deckSlug });
      if (existingRows[0]["status"] as string == "PENDING")
      {
        var resumed = new PublishStart(Resumed, 200, null, null, existingJobId,
          existingRows[0]["buildId"] as string, existingRows[0]["snapshotSha256"] as string, null);
        return await DispatchPublishAsync(conn, resumed, deckId, deckSlug, existingRows[0]["adminSub"] as string,
          existingRows[0]["note"] as string, queueUrl, ct);
      }
      return new PublishStart(Resumed, 200, null, null, existingJobId, null, null, null);
    }

    // 1. Generate Job ID
    var jobId = Guid.NewGuid().ToString();
    // 💡 修复：为 PENDING 任务预先生成一个 buildId 以满足数据库非空约束
    var buildId = MakeBuildId();

    // 💡 修复：预先计算出 s3_key 以满足数据库非空约束
    // 这个路径格式必须和 ManifestRebuild.cs 中的逻辑保持一致
    string s3Key;
    if (tier == "premium")
    {
      if (string.IsNullOrEmpty(PremiumBucket)) throw new InvalidOperationException("Missing env PREMIUM_BUCKET for premium deck");
      s3Key = $"{PremiumPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
    }
    else
    {
      if (string.IsNullOrEmpty(contentBucket)) throw new InvalidOperationException("Missing env CONTENT_BUCKET for free deck");
      s3Key = $"{ContentPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
    }

    // 2. Insert PENDING job record into the database
    const string insertJobSql = """
      insert into deck_publishes (job_id, build_id, s3_key, deck_id, deck_slug, status, published_by_admin_sub, note)
      values ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
      """;
    const string insertGatedJobSql = """
      insert into deck_publishes (job_id, build_id, s3_key, deck_id, deck_slug, status, published_by_admin_sub, note, qa_snapshot_sha256)
      values ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8)
      """;
    // 035+: the job also records the deck's live card ids and the checked deck settings (R18C, backend-design-11/-12).
    const string insertRecordedJobSql = """
      insert into deck_publishes (job_id, build_id, s3_key, deck_id, deck_slug, status, published_by_admin_sub, note, qa_snapshot_sha256,
        deck_updated_at, card_ids)
      values ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8::text, $9::timestamptz,
        (select coalesce(array_agg(c.id order by c.id), '{}'::bigint[]) from cards c where c.deck_id = $4 and c.is_deleted = 0))
      """;
    await using var tx = durable ? await conn.BeginTransactionAsync(RecallSmith.Lambda.Common.RequestBudget.Combine(ct)) : null;
    if (tx is not null)
    {
      await DbUtil.QueryAsync(conn, tx, "select id from decks where id=$1 for update", [deckId]);
      if (actionId is not null)
      {
        var replay = await ReplayOrdinary(conn, tx, deckId, actionId, requestHash);
        if (replay is not null)
        {
          await tx.CommitAsync(RecallSmith.Lambda.Common.RequestBudget.Combine(ct));
          return replay.Outcome == Resumed ? await DispatchPublishAsync(conn, replay, deckId, deckSlug, actorSub, note, queueUrl, ct) : replay;
        }
      }
      if (!Equals(editingSnapshot, await DbUtil.ExecuteScalarAsync(conn, tx, "select content_editing_snapshot($1)", [deckId])))
        return StaleRefusal(deckId);
    }
    try
    {
      await DbUtil.ExecuteAsync(conn, tx, insertRecordedJobSql,
        [jobId, buildId, s3Key, deckId, deckSlug, actorSub, note, qaSnapshot, expectedDeckUpdatedAt]);
    }
    catch (PostgresException pg) when (pg.SqlState == "42703" && expectedDeckUpdatedAt is null)
    {
      // Pre-035 window (code shipped, console Migrate not yet clicked): a console publish records nothing extra. An
      // automation publish never runs unbound, so it keeps the error.
      if (qaSnapshot is null) await DbUtil.ExecuteAsync(conn, null, insertJobSql, [jobId, buildId, s3Key, deckId, deckSlug, actorSub, note]);
      else await DbUtil.ExecuteAsync(conn, null, insertGatedJobSql, [jobId, buildId, s3Key, deckId, deckSlug, actorSub, note, qaSnapshot]);
    }

    if (tx is not null)
    {
      await DbUtil.ExecuteAsync(conn, tx, "update deck_publishes set publish_editing_snapshot=$2 where job_id=$1", [jobId, editingSnapshot]);
      await PublishDelivery.Stage(conn, tx, jobId, actorSuperadmin, actionId, requestHash);
      await tx.CommitAsync(RecallSmith.Lambda.Common.RequestBudget.Combine(ct));
    }
    return await DispatchPublishAsync(conn, new PublishStart(Queued, 200, null, null, jobId, buildId, qaSnapshot, null),
      deckId, deckSlug, actorSub, note, queueUrl, ct);
  }

  private static string? OptionalAction(JsonElement body)
  {
    if (!body.TryGetProperty("actionId", out var value) || value.ValueKind == JsonValueKind.Null) return null;
    if (value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: > 0 and <= 100 } action)
      throw new ValidationError("actionId must be a string of 1..100 characters", "actionId");
    return action;
  }

  private static async Task<PublishStart?> ReplayOrdinary(NpgsqlConnection conn, NpgsqlTransaction? tx, long deckId, string action, string? hash)
  {
    var rows = await PublishDelivery.Replay(conn, tx, deckId, action);
    if (rows.Count == 0) return null;
    var row = rows[0];
    if (!Equals(hash, row["request_hash"])) return Refuse(409, "IDEMPOTENCY_CONFLICT", "actionId already identifies a different publish payload");
    return new PublishStart(Resumed, 200, null, null, (string)row["job_id"]!, row["build_id"] as string, row["qa_snapshot_sha256"] as string, null);
  }

  private static async Task<PublishStart> DispatchPublishAsync(NpgsqlConnection conn, PublishStart start, long deckId, string deckSlug,
    string? actorSub, string? note, string queueUrl, CancellationToken ct)
  {
    var metadata = await DbUtil.QueryAsync(conn,null,"select status,published_by_admin_sub,note from deck_publishes where job_id=$1",[start.JobId]);
    if (metadata.Count == 0 || metadata[0]["status"] as string != "PENDING") return start;
    actorSub = metadata[0]["published_by_admin_sub"] as string;
    note = metadata[0]["note"] as string;
    var sendMessageRequest = new SendMessageRequest
    {
      QueueUrl = queueUrl,
      MessageBody = JsonSerializer.Serialize(new { jobId = start.JobId, deckId, adminSub = actorSub, note })
    };

    try
    {
      async Task Send(string body)
      {
        sendMessageRequest.MessageBody = body;
        if (TestEnqueueSeam is not null) await TestEnqueueSeam.Send(sendMessageRequest);
        else await SQS().SendMessageAsync(sendMessageRequest, RecallSmith.Lambda.Common.RequestBudget.Combine(ct));
      }
      var durable = await PublishDelivery.Ready(conn) && await DbUtil.ExecuteScalarAsync(conn, null,
        "select exists(select 1 from publish_dispatch where job_id=$1)", [start.JobId]) is true;
      if (durable)
      {
        var sent = await PublishDelivery.Dispatch(conn, start.JobId!, Send);
        if (sent is false) throw new TimeoutException("SQS delivery is unconfirmed; short dispatch lease retained");
      }
      else await Send(sendMessageRequest.MessageBody);
      Log.Event("info", new { tag = "publish", outcome = "enqueued", jobId = start.JobId, deckId, deckSlug, buildId = start.BuildId });
      return start;
    }
    catch (Exception ex)
    {
      // SQS may have accepted the message; the worker owns status after the committed insert.
      Log.Event("warn", new { tag = "publish", outcome = DispatchUnconfirmed, jobId = start.JobId, deckId, error = ex.Message });
      return start with { Outcome = DispatchUnconfirmed, HttpStatus = 503, Code = "PUBLISH_DISPATCH_UNCONFIRMED",
        Message = "Publish job committed; delivery is unconfirmed. Poll this job or retry publish to deliver the same pending job." };
    }
  }

  private static PublishStart StaleRefusal(long deckId)
  {
    Log.Event("info", new { tag = "publish", outcome = "refused", code = PublishSnapshot.StaleErrorCode, deckId });
    RouteMetrics.EmitGauge(PublishSnapshot.StaleMetric, 1);
    return Refuse(409, PublishSnapshot.StaleErrorCode, StaleMessage);
  }

  /// <summary>The console response of a <see cref="PublishStart"/>: exactly what the handler answered before the extraction.</summary>
  private static APIGatewayProxyResponse StartResponse(PublishStart start, Res res)
  {
    if (start.Outcome == DispatchUnconfirmed)
      return res.Raw(start.HttpStatus, new
      {
        success = false,
        data = new { mode = "async", outcome = start.Outcome, jobId = start.JobId, buildId = start.BuildId },
        error = new { code = start.Code, message = start.Message }, traceId = res.TraceId, version = "v1"
      }, new Dictionary<string, string> { ["retry-after"] = "1" });
    if (start.Outcome == Queued) return res.Ok(new { mode = "async", jobId = start.JobId });
    if (start.Outcome == Resumed) return res.Ok(new { mode = "async", jobId = start.JobId, note = "Resumed existing job" });
    if (start.ErrorExtras is Qa.QaRuns.ChainedRun chained)
    {
      return Qa.QaGate.RefusalResponse(new Qa.QaGate.PublishRefusal(start.HttpStatus, start.Code!, start.Message!, chained), res);
    }
    return start.HttpStatus switch
    {
      404 => res.NotFound(start.Message),
      400 => res.BadRequest(start.Code!, start.Message),
      _ => Helpers.ErrorEnvelope(res, start.HttpStatus, start.Code!, start.Message!),
    };
  }

  private sealed record LoadedDeck(PublishStart? Refusal, Dictionary<string, object?>? Deck, string? DeckSlug,
    List<Dictionary<string, object?>>? CardRows, long DeckType, string? Tier);

  /// <summary>The deck, its slug, its export rows and tier, or the refusal (404, <c>DECK_DELETED</c>, premium config).</summary>
  private static async Task<LoadedDeck> LoadDeckAsync(NpgsqlConnection conn, long deckId)
  {
    const string deckSql = """
      select
        id,
        slug,
        title,
        author,
        description,
        locale,
        deck_type as "deckType",
        version,
        tier,
        total_cards as "totalCards",
        preview_cards as "previewCards",
        coalesce(to_jsonb(decks) -> 'translation_locales', '[]'::jsonb) as "translationLocales",
        is_deleted as "isDeleted",
        updated_at as "updatedAt"
      from decks
      where id = $1
      limit 1
      """;

    var deckRows = await DbUtil.QueryAsync(conn, null, deckSql, [deckId]);
    if (deckRows.Count == 0) return new LoadedDeck(Refuse(404, "NOT_FOUND", "Deck not found"), null, null, null, 0, null);

    var deck = deckRows[0];
    if (Convert.ToInt32(deck["isDeleted"], CultureInfo.InvariantCulture) == 1)
    {
      return new LoadedDeck(Refuse(400, "DECK_DELETED", "Deck is deleted (cannot publish)"), null, null, null, 0, null);
    }

    var deckSlug = Validation.RequireSlug(Convert.ToString(deck["slug"], CultureInfo.InvariantCulture), "deckSlug");

    var cardRows = await DbUtil.QueryAsync(conn, null, CardsSql, [deckId]);

    var deckType = Convert.ToInt64(deck["deckType"], CultureInfo.InvariantCulture);
    var tier = InferTier(deckType, deck.TryGetValue("tier", out var tv) ? tv : null);

    if (tier == "premium" && string.IsNullOrEmpty(PremiumBucket))
    {
      return new LoadedDeck(Refuse(503, "CONFIG_ERROR", "Missing env PREMIUM_BUCKET"), null, null, null, 0, null);
    }

    return new LoadedDeck(null, deck, deckSlug, cardRows, deckType, tier);
  }

  private static int ToInt(object? v, int fallback)
  {
    if (v is null) return fallback;
    if (v is int i) return i;
    if (v is long l) return (int)l;
    if (int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n;
    return fallback;
  }
}
