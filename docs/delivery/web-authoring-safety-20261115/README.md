# Web authoring safety delivery

15 November 2026, Pacific/Auckland. This is the first commercial-hardening milestone: console editing, ordinary Markdown import, session isolation, and local integration evidence. Production deployment and the remaining offline/publishing/feedback milestones are separate.

## Behavior

- The editor preserves the draft on a version conflict and shows saved fields that differ from the attempted save. The form retains its original version across background reads; explicit conflict recovery adopts the version actually presented for comparison. A subsequent competing edit still conflicts.
- Ordinary import sends `operationId` once per batch and `expectedVersion` for every card: `0` requires an absent UID; a positive value requires that exact current live version. A stale member rejects the whole current batch. Earlier committed batches remain committed.
- A repeated operation with the identical payload returns its stored result without writing again, even after another edit. Reusing an operation for a different payload conflicts. Permissions and actor scope apply to replay too.
- Console requests, token refresh, OAuth completion, and card mutations retain their originating session. Replacing an account discards its cached and local component state; stale work cannot adopt the new account's credentials or update its cache/navigation.
- A lost response or cancellation is reported as unconfirmed, with the operation ID. Bounded retries keep that ID; exhausted uncertain work stops later batches. This does not claim the database rolled back merely because the browser lost contact.

## Design and compatibility

No new table, migration, AWS service, scheduler, or paid API is required. Ordinary imports reuse migration 050's `content_release_actions` in an actor-scoped `console-import-v1:` namespace. Existing receipts and content are retained. Runtime already has SELECT/INSERT access to that table; its privilege tests are included in validation.

The protected `aws-saa-fundamentals` release path keeps its release ID, review evidence, expected snapshot, and idempotency contract. It does not accept the ordinary import contract as a bypass. No card contents, UIDs, published builds, or learner records are changed by this delivery.

Ordinary imports require schema 050 or newer; a missing receipt table fails with `503 MIGRATION_REQUIRED`. Existing tests also exercise the supported pre-053 concurrency path and the fully migrated schema. Old ordinary-import callers without the new preconditions fail safely instead of overwriting content. Card reads and published mobile content contracts retain their existing shapes.

Deploy the fixed API before the new console in a coordinated window; an older cached console may temporarily have its import rejected and should reload to obtain the compatible console. Keep the guarded API if reverting the console. Reverting the API to an unguarded import implementation reopens data-loss risk; prefer a forward fix, or suspend authoring writes while recovering. This document authorizes no deployment.

## Verification boundary

The local suite uses real Chromium, the built console, the production `VpcFunction` dispatcher/handlers, and disposable PostgreSQL through the existing fixture. A non-shipping loopback host maps fixed synthetic tokens to fixed identities. It does not test Cognito, JWT signatures, API Gateway authorization, deployed IAM/RDS, or CDN distribution. It never uses production data or credentials. Its seed/state/fault routes exist only in the test executable.

Four browser cases cover competing editors including a second conflict, stale import atomicity, a response dropped after a committed import followed by another real API edit, and forbidden direct API writes. Database-state JSON and desktop/mobile conflict captures are attached to the browser result. Existing mocked browser/CSP smoke tests remain a separate suite. The local suite is added to the same CI browser job, without a new runner/job.

Initial failing reproductions and isolated guard-removal controls are retained outside the repository. The initial independent review identified two additional boundaries in mutation scheduling and atomic card authorization; both were reproduced and closed in the bounded repair and independent re-review. Exact source/check/review bindings are recorded in [validation.json](validation.json), with retained synthetic [database outcomes](browser-final-states.json). The source-reviewed commit is `7267253d913fd4362f3af74d064efee3192b2337`. Backend 3,296, console 1,857, existing browser smoke 17, and real API/PostgreSQL browser 4 checks passed, along with build and lint. Initial failure and repaired reviews are retained beside the validation manifest. No test total is substituted for the final-state and guard-removal evidence.

## Running the checks

Use the repository's Node and .NET versions. Docker must be available for PostgreSQL. No cloud test credentials are needed.

```sh
cd frontend
npm ci
npm run build
npm test
npm run lint
npx playwright install chromium
npx playwright test
npx playwright test --config playwright.local.config.ts
```

```sh
cd src_C
dotnet test Tests/RecallSmith.Lambda.IntegrationTests
```

The local suite binds only `127.0.0.1:5187`, refuses to reuse a server, and stops its disposable database when the host exits. Its artifacts go to `frontend/test-results/local/`; smoke results keep their existing directory.

## Costs and remaining work

### Console login policy follow-up, 15 November 2026

The owner requested Console MFA removal before merging PR #840. The existing Console Cognito pool is configured with MFA `OFF` and software-token MFA disabled. Password login, PKCE, administrator-created accounts, token revocation, API permissions, the mobile pool and operator IAM MFA retain their existing configuration. The accompanying `CONSOLE-MFA.plan-allow.json` permits only those two settings on the existing Console pool. This follow-up changes the desired Terraform configuration; the live login policy changes only after the approved infrastructure apply succeeds. No live MFA change is claimed by the source merge.

The session checks add client code, and operation receipts consume existing database storage. The raw eager-bundle budget increase is recorded alongside its measured result; it is a deliberate trade for correctness. The extra local suite adds bounded work to the existing CI job. Current production bills, storage headroom, and CI quota were not queried, so no zero-increment invoice claim is made.

Not executed: production migration/deployment, OTA or store release, production fault injection, real-user trials, and changes to offline ratings, balances, publishing recovery, or report delivery status. Those remain the next milestones. Personal and AI contributions should be stated according to the owner's actual review/acceptance decisions; the implementation and independent source review here were Codex-assisted.
