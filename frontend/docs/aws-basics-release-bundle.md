# AWS Basics Console release bundle v2

For the five-card editing, review and publication order, see [五卡内容发布 workflow](../../docs/delivery/card-content-release-workflow.md). The v1 field name `mainSHA` is retained for compatibility and identifies the actual validated publishing-code commit on main; it is not evidence that this content batch is in that commit. The v2 exporter separately binds the full content artifact, actual archived review/source proofs, and independent Git archival status. Verify the selected code commit and successful CI before use; unchanged code can reuse that record. Code/rule/contract changes still pass normal merge gates before use. Ordinary content uses canonical JSON; Markdown is a reading output, not a lossy publication intermediate.

The authenticated Console route is `/decks/release?deckId=15`, linked from that deck's card list. It is limited to ordinary signed-in `editor` / `super_admin` sessions; backend deck permissions and normal Console token authorization remain authoritative. It does not run a model or perform human per-card review. No credentials belong in a bundle or journal.

`src/types/contentRelease.ts` is the typed contract. `parseReleaseBundle` in `src/lib/contentRelease.ts` accepts 1–500 cards, matching the server import limit. Review coverage and current readback must match the frozen bundle's actual count exactly. It rejects missing or extra top-level, card, evidence and per-card review fields, wrong scope, duplicate UIDs/order, absent Chinese/help fields, invalid MCQ/translation shapes, and expired evidence. `tests/support/contentReleaseFixtures.ts` provides a synthetic sample generator with a configurable count (337 by default); regressions include 379 cards and the count boundaries. Its synthetic hashes are test placeholders, never production review evidence.

New captures require v2 and its exact `expectedBaseline`. The parser retains v1 for previously frozen journals; it cannot start a new capture from v1. Restore revalidates v2 baseline bindings.

The v2 JSON object has exactly:

```typescript
{
  schema: 'aws-basics-release-bundle-v2',
  deckId: 15,
  deckSlug: 'aws-saa-fundamentals',
  releaseId: string, // nonempty, at most 160 characters; immutable release identity
  expectedBaseline: {
    liveBuildId: string | null,
    cards: [{stableUid: string, cardContentHash: string,
      schema: 'legacy-v1' | 'front-help-v1' | 'tags-only-v1', revision: number, orderInDeck: number}]
  }, // exact prior live pointer and full active editing inventory
  cards: ImportCardInput[], // 1–500, all fields below explicit
  review: {
    runId: string,
    batchAuthorizationRef: string, // existing user authorization reference, not a new claim of human content review
    authorizationScope: 'aws-saa-fundamentals:full-deck-bilingual-release',
    model: string,
    mainSHA: string, // exact 40-hex validated publishing-code commit on main; content is bound separately
    evidenceRef: string, evidenceHash: string, evidenceVersion: string,
    reportRef: string, reportHash: string, reportVersion: string,
    promptHash: string, promptVersion: string,
    corpusHash: string, corpusVersion: string,
    expiresAt: string, // ISO timestamp strictly in the future, at most 24h
    cards: [{
      stableUid: string,
      verdict: 'PASS',
      cardContentHash: string, // actual backend CardContentHash, not a JSON.stringify hash
      schema: 'legacy-v1' | 'front-help-v1' | 'tags-only-v1',
      revision: number, // expected actual post-import server revision
      orderInDeck: number,
      blockers: [], unknowns: []
    }] // exactly one for every candidate UID
  }
}
```

Every hash field is a lowercase 64-hex SHA-256. `evidenceRef` / `reportRef` and batch authorization reference permit 2000 characters; model and version strings permit 200; other identifiers permit 160. The authorization scope is fixed. Policy, policyHash, reviewSchema and schemaHash are **not bundle fields**: the page reads them from the current server snapshot when constructing `/release/review`.

Every card has exactly `stableUid`, `question`, `explanation`, `codeSnippet`, `codeLanguage`, `realWorldUsage`, `topic`, `difficulty`, `orderInDeck`, `mcq`, `source`, `frontHelp`, `translations`. The six text fields are strings (empty string for absent optional text), already trimmed except codeSnippet, whose whitespace is preserved. `source` is `{url: httpsUrl, quote: string | null}`. `frontHelp` is an explicit array of up to two `{term,definition}` entries or null. `translations` includes a complete `zh-CN` v1 translation and matching Chinese help entry count. MCQ and translation shapes are the existing Console types, validated with the shared MCQ/translation validators. All existing active UIDs must remain in the candidate. Nothing soft-deletes omitted cards.

An exporter must bind local model PASS records to the **post-import** server hash/schema/revision/order. `src_C/Vpc/Qa/CardContentHash.cs` defines the backend hash, including PostgreSQL JSON object order, .NET serialization, translations and front-help schema. It is not the pipeline's sorted-key candidate hash. Do not copy a server hash onto an unrelated PASS record, invent a PASS, or label deterministic UI checks as model review. A mismatch blocks review registration. If an exporter cannot establish those expected values from immutable candidate/review/baseline evidence, it must stop; the Console does not guess them.

The page freezes the entire initial `/release/snapshot` response before any write, including all backup rows (deleted rows included), original editingSnapshot and original `deck.live_build_id`. The complete backup and recovery journal are durably retained in IndexedDB. Select an automatic save folder once to retain files outside browser storage, or download the recovery journal. Recovery validates required deck and card row fields, including explicit nullable source, translations, translation basis and front-help columns on both active and deleted rows. It checks unique row IDs/UIDs and unique order values across active and deleted rows, plus exact active metadata coverage, versions, revisions, order and help schema. First capture also freezes `baselineInventory`, containing the original editingSnapshot and every raw row’s ID, stable UID, order, version, revision and deletion flag. Restore requires that original inventory and compares it with the supplied complete baseline; an omitted deleted row, changed binding or missing inventory is rejected. Recovery never manufactures an inventory for an existing journal. This detects truncation/inconsistency while the captured inventory and baseline identifier are retained. A deliberately rewritten entire file, including both the inventory and its binding, requires separate provenance/authenticity verification; this is not a reproduction of PostgreSQL’s editing-v1 digest or a claim that a downloaded journal is authentic. Complete raw rows and any additional backend columns are preserved without projection. That journal also retains the immutable bundle and exact serialized payloads. All three action bodies must structurally match the frozen bundle/baseline/verified snapshot and the review receipt; different JSON property order/spacing is accepted while original bytes are retained. Altered fields, extra fields, arbitrary logical IDs and inconsistent stored success results are rejected. A later queried review receipt must match the already-frozen publish body before replay; the adapter never rewrites a mismatched body. It is stored in IndexedDB under the signed-in subject; a storage failure blocks dispatch. Existing sessionStorage journals migrate only after a successful durable write. Each write checks its revision, so another tab cannot overwrite a newer frozen action. A downloaded journal can be restored through the recovery file input after closing a tab. The page checks its owner against the current signed-in subject before and after awaited file reads, capture, query, full readback, write and journal save. A subject switch stops further requests/saves; a request already sent may still commit and must be queried by the owning account. Release requests also check the current subject immediately before transport, after the shared asynchronous authentication interceptor. The final guard requires the actual Authorization bearer JWT subject to match the journal owner as well as the current stored identity; missing, malformed or foreign bearer claims block transport. It inspects only the transient attached header, does not print or persist tokens, and leaves signature verification and permission checks to the server. Full card readback uses the same fixed paged route with checks before and after every page and rejects incomplete/repeating cursors; it does not join the shared deck-only request deduplication cache. The journal includes `ownerSubject`; restores reject missing or foreign ownership. Ownerless or inventory-less journals from earlier adapters are rejected rather than assigned to the current account. Restoring resets every saved action to unreconciled and forces actual queries before any dependent write or replay. Stored outcomes/results remain historical until reconciliation; `ACTION_NOT_FOUND` clears the old result, query and confirmation while retaining the exact request bytes and fixed key.

Only three logical action IDs are used, scoped by deck/release: `import`, `review`, `publish`. The import uses `idempotencyKey=import`; review/publish use `actionId=review/publish`. No error generates another key. Before initial import, the original editing and live baselines must still match. After import, the page reads all paginated cards once and then a snapshot, matching the confirmed import editing snapshot, all canonical candidate fields, server version/revision, translations and local per-card review bindings. Review registration uses that verified snapshot. Publish reuses the same binding, with the backend transaction still checking current snapshot, live pointer, generation and receipt. The normal path uses three full snapshots (initial, before import, after readback); it does not repeat the full card readback before publish. Every action preserves the original expectedLive; it never silently rebases onto a concurrent live build.

After any unsuccessful write response, including a timeout or 503, query `/release/actions` before replay. A query showing `ACTION_NOT_FOUND` permits replay of the original bytes/key. A committed import/review is recovered from the stored API Gateway response. A committed publish with unconfirmed dispatch may replay the same publish request; the backend delivers the same job rather than replacing its generation. Query output shows the actual jobs, receipts and current live pointer. The page displays `manifestVerified=false` until its actual CDN verification succeeds; a successful job alone does not set it true.

This adapter does not restore editing rows, revoke evidence, roll back builds, launch a new model review, add a permission grant, or change CDN infrastructure. Its automatic runner verifies actual CDN publication as described below. It intentionally provides no generic API explorer or arbitrary endpoint input.


Recovery action states and persistence

The entity is one fixed logical action. States are absent; frozen/unknown; historical/unreconciled; confirmed in this mounted session; and queried/not-found. Events are prepare, write success/failure, reload/upload, committed query, not-found query and replay. `outcome`, `queried` and `reconciled` are persisted; restoration always resets the latter two authorization flags.

| From | Event | To | Side effect / rejection |
|---|---|---|---|
| Absent | Prepare | Frozen/unknown | Validate dependencies; persist exact key/body before sending |
| Frozen/unknown | Successful response | Confirmed in this session | Validate returned scope/snapshot/receipt/job before saving |
| Frozen/unknown | Failed response | Unknown, query required | Keep original key/body; never generate another action |
| Any saved action | Reload/upload | Historical/unreconciled | Retain evidence/bytes; block dependent writes and replay |
| Historical or unknown | Committed query | Confirmed in this session | Validate the authenticated committed result |
| Historical or unknown | ACTION_NOT_FOUND | Queried/not-found | Clear historical result/confirmation; allow only identical replay with dependencies reconciled |
| Queried/not-found or queried publish | Replay | Frozen/unknown | Revalidate original body against frozen evidence and the reconciled receipt; persist before send |

Invariants: every existing recovered action must be reconciled before any workflow write; review requires confirmed import; publish requires confirmed import and review. Original live/editing baselines, bundle, logical IDs and valid payload bytes stay fixed. A live or confirmed-import editing change cannot be adopted as a new baseline. Foreign stored identity or actual bearer, malformed/truncated backup, missing/mismatched all-row inventory, duplicate order values, changed payload, unqueried replay and conflicting receipts are illegal transitions and fail closed. No in-memory confirmation authorizes work after reload. A storage failure prevents dispatch.

The regression checklist covers reload and upload, negative/committed queries, exact-byte replay, changed review/publish evidence, fixed action IDs, inconsistent results, complete active/deleted rows, truncated fields, foreign/ownerless journals, identity changes before and during awaits and immediately before transport, storage failure, timeout and 503 publish/SQS uncertainty. These are synthetic local checks; actual model review, production backup authenticity and external CDN publication remain separate verification work.


## Automatic publication and recovery

After loading an already reviewed bundle, use **Run reviewed release**. It captures the complete editing backup, reconciles recovered actions, imports, verifies the full bilingual readback, registers the existing review and publishes. This button performs no model content review and creates no new approval evidence. Existing manual controls remain available.

A normal publish response can be `queued`, `processing`, `success` or `failed`; its saved action query returns the original `committed` result. These are job stages, not public delivery proof. The Console polls the same job, replays only the exact frozen publish request when dispatch or manifest delivery is due, and respects the server lease, backoff and five-attempt limit. A successful replay retries only the existing job's manifest delivery using current database pointers. It does not upload or create another build. Failed delivery is logged with the job ID and exposed in the action query.

Completion requires a successful job, delivered index, matching live pointer, public CDN manifest build/hash/card count, downloaded byte SHA-256, and exact reviewed bilingual card identities, order, revisions and content. Public downloads omit credentials. Release verification requests a fresh manifest URL and bypasses the browser deck cache, so cached responses from before a CORS change cannot remain stuck on a headerless 304. Monitoring stops after four minutes or page closure; running again reconciles and continues the same journal. `Start another release` archives the completed recovery backup before clearing the active journal.

After this actual CDN verification succeeds, retain its result, complete backup and final journal as the publication receipt. A second routine full download or manual replay of each successful step is unnecessary; investigate separately only when evidence is missing or inconsistent. Device installation is a separate observation, not implied by successful server publication. Ordinary content-only releases do not require a manual phone check unless the user requests one or a compatibility/runtime/UI change or concrete issue warrants it.

The production content CDN must be configured in `VITE_CONTENT_MANIFEST_URL`, listed in the Console CSP, and permit anonymous GET/HEAD reads. The content distribution uses its existing Free plan. S3 supplies CORS for the Console origin and GET/HEAD only; CloudFront always sends that fixed Origin to S3, making CORS metadata independent of viewer headers and the shared cache key. No origin-request or cache-policy change is needed. The scoped recovery workflow invalidates only `/content/*` to remove older responses without CORS metadata. Console CSP still names only the configured content CDN. Custom response-header policies are unsupported on this pricing plan; the managed SimpleCORS path was observed to omit ACAO when real browser requests include Priority. The Terraform allow-list for these narrow headers is `docs/delivery/content-release-recovery-20261118/CDN-VERIFY.plan-allow.json`. Ordinary card-only releases require no mobile code change or OTA.


## Durable completion and one closeout

The journal's optional `delivery` records the verified job/build/hash/count/time. Actual downloaded bytes are separately persisted in owner + releaseId + canonical bundle scoped IndexedDB. Reload resets action confirmations: the runner queries the original actions and checks the current successful job, delivered index and live pointer before verifying the saved bytes. An exact match reuses those bytes without another public manifest/deck GET. A missing byte cache requires actual verification again; stale proof cannot authorize another write.

On browsers supporting File System Access and Web Locks, **Choose automatic save folder** retains the selected DirectoryHandle in owner-scoped IndexedDB. Permission must still be granted; browsers may require choosing it again after restart. Files go into a hash-derived owner/release subdirectory: `release-bundle.json`, `console-journal.json`, then after verification `after-deck.json` and `publication-verification.json`. Changing the folder after completion writes all four. The journal's confirmation time is authoritative even when two tabs cache identical downloaded bytes at different times. The owner-scoped Web Lock spans journal compare-and-swap and all file writes; stale tabs cannot overwrite newer state. Each file uses a native writable commit; the four-file set is not one filesystem transaction, so closeout rejects an incomplete/mismatched set.

Unsupported browsers retain IndexedDB and **Download verified release artifacts**, a single `aws-basics-completed-artifacts-v1` packet with the full journal, proof and base64 original CDN bytes. Both forms are accepted by `repair_release.py finalize PREPARED ARTIFACT_DIRECTORY_OR_PACKET`. It freezes input bytes, validates through the real Console parser, checks all completion bindings and cards, and atomically archives each result without clobbering a different result. It makes no model or network calls and creates the next batch's reusable baseline.

Lifecycle transitions, illegal states and regression coverage: [state machine](../../docs/delivery/card-content-release-state-machine.md).
