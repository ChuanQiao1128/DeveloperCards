# Release scripts (iOS binary → App Store review, unattended)

Written 2026-09-20 for the 1.6.0 train (`docs/release-1.6-ship-runbook-2026-09-20.md`). Every script
has a dry-run mode and prints the evidence the runbook asks for (build id, submission id, ASC states).

| script | does | auth it uses |
|---|---|---|
| `ios-build.sh [profile]` | `eas build --platform ios --non-interactive --json --wait`; prints build id + artifact URL. For `production` it exits 5 (also under `DRY_RUN=1`) while `eas.json` `build.production.ios.env.SENTRY_ORG`/`SENTRY_PROJECT` is empty or still a `REPLACE_ME_*` placeholder, and exits 3 (names only, also under `DRY_RUN=1`) when `eas env:list --environment production` lacks `EXPO_PUBLIC_SENTRY_DSN` or `SENTRY_AUTH_TOKEN` | EAS login (`eas whoami`) + EAS-managed signing |
| `ios-submit.sh [profile]` | `eas submit --platform ios --latest --non-interactive --wait`; uploads the newest finished build to App Store Connect | the App Store Connect API key stored on EAS (`[Expo] EAS Submit`) |
| `asc-release.cjs` | with the local Apple session (`~/.app-store/auth`, refreshed by `eas credentials`): wait for processing, ensure the App Store version, set What's New, attach the build, set the release type (default `MANUAL` since 1.9.0; pass `--release-type AFTER_APPROVAL` to release on approval), and with `--submit` create + submit the review submission. Exits 4 with `BLOCKED <version> is <state>: <reason>` (plan mode included, before any mutation) when the editable, in-review or pending-release version is held by App Review | `@expo/apple-utils` from the global `eas-cli` install |
| `ascGuard.cjs` | pure checks `asc-release.cjs` runs on the editable, in-review and pending-release versions (`firstHeldVersion`; the edit read alone never returns `IN_REVIEW` or `PENDING_*_RELEASE`): `WAITING_FOR_REVIEW`, `IN_REVIEW` or `PENDING_DEVELOPER_RELEASE` in `appVersionState` or `appStoreState` refuses a rename or re-attach (exit 4) | — |
| `whats-new-<v>.txt` | the en-US What's New text `asc-release.cjs` pushes | — |
| `description-<v>.txt`, `review-notes-<v>.txt` | the en-US description (`--description`) and the App Review Information notes (`--review-notes`) | — |
| `keywords-<v>.txt`, `promo-<v>.txt`, `subtitle-<v>.txt` | keywords (≤ 100, comma-separated), promotional text (≤ 170) and subtitle (≤ 30); `tests/unit/whatsNew200.test.ts` checks the 2.0.0 set (limits, plain words, disclaimers) | — |
| `ota.sh "<message>"` | `eas update --channel production --environment production`; first verifies every required `EXPO_PUBLIC_*` name exists in the EAS production environment (names only, never values), then publishes. `DRY_RUN=1` checks the names and prints the command without publishing | EAS login (`eas whoami`) |
| `ota.sh` runtime guard | exits 6 before any `eas` call when the runtime (`app.json` version) is below 1.9.0 but `package.json` depends on `@sentry/react-native` (that runtime has no RNSentry native module): publish runtime-1.8.0 OTAs from `release/1.8.x`, runtime-1.9.0 OTAs from `release/1.9.x`, runtime-2.0.0 OTAs from `main` | — |
| `ota.sh` DSN name rule | for runtime ≥ 1.9.0 `EXPO_PUBLIC_SENTRY_DSN` joins the required names (missing ⇒ exit 3); a runtime-1.8.0 OTA does not need it | — |
| `ota.sh` source maps | after a successful publish prints one line `SENTRY_UPLOAD=<value>`: `ok` (`npx sentry-expo-upload-sourcemaps dist` succeeded), `failed` (stderr shows the re-run command; still exit 0, the update is live), `skipped-runtime` (runtime < 1.9.0), `skipped-no-project` (`SENTRY_ORG`/`SENTRY_PROJECT` empty or `REPLACE_ME_*`, checked before any token lookup), `skipped-no-token`. `DRY_RUN=1` prints `DRY: SENTRY_UPLOAD=ok-planned` or the skipped reason | `SENTRY_AUTH_TOKEN` from the environment, else the macOS Keychain item `developercards-sentry-auth-token` (only on a terminal or with `OTA_KEYCHAIN=1`; `OTA_KEYCHAIN=0` disables it); `SENTRY_TOKEN_SOURCE=env\|keychain` is printed, never the value |

Nothing here reads or prints a secret: EAS holds the signing assets and the ASC API key; the Apple session
cookie is read by `@expo/apple-utils` itself. If `asc-release.cjs` exits 3 the Apple session expired —
run `eas credentials --platform ios` once (password from Keychain + 2FA) and re-run.

Subscription metadata rule (App Review rejected 1.8.0 (22) on 2026-09-29 under Guideline 3.1.2(c)): every
description must link the Terms of Use (EULA) and the Privacy Policy, the review notes say where the paywall is,
and `tests/unit/storeSubscriptionMetadata.test.ts` checks both for every `description-*.txt` from 1.8.0 on.

Review-notes checklist (from the version after 2.0.0 on, R25 G02): every `review-notes-<v>.txt` names the Delete account
path, "Me > Settings > Account > Delete account", and says that following it permanently deletes the demo account (server
data and sign-in), so the owner must re-create it after review before it is used again. `tests/unit/reviewNotesChecklist.test.ts`
fails for any review-notes file after 2.0.0 that does not contain the full path "Me > Settings > Account > Delete account".

Always publish OTAs through `ota.sh`; a bare `eas update` without `--environment production` ships empty `EXPO_PUBLIC_*` values.

Exit codes: `ota.sh` 0 ok · 2 usage / eas-cli missing or not logged in · 3 missing `EXPO_PUBLIC_*` name(s) · 6 runtime guard;
`ios-build.sh` 0 ok · 1 build failed · 2 eas-cli missing or not logged in · 3 production is missing `EXPO_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` in the EAS production environment (names only, DRY_RUN included) · 5 Sentry org/project placeholders; `asc-release.cjs` 0 ok · 1 error · 3 Apple session expired · 4 version held by App Review.

Typical run for 2.1.0 (25) (from `mobile/`; the Sentry org/project slugs in `eas.json` were filled in 9c3dd9d, and `EXPO_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` must exist in the EAS production environment):

```bash
DRY_RUN=1 scripts/release/ios-build.sh production
scripts/release/ios-build.sh production
scripts/release/ios-submit.sh production
node scripts/release/asc-release.cjs --version 2.1.0 --build 25 --wait-build \
  --whats-new scripts/release/whats-new-2.1.0.txt --description scripts/release/description-2.1.0.txt \
  --keywords scripts/release/keywords-2.1.0.txt --promo scripts/release/promo-2.1.0.txt \
  --subtitle scripts/release/subtitle-2.1.0.txt --review-notes scripts/release/review-notes-2.1.0.txt
```

The last command is the plan (prints `releaseType=MANUAL`); the owner adds `--apply`, then `--submit`, and releases the
approved version by hand.

2.0.0 is a new OTA runtime (`runtimeVersion.policy: "appVersion"`): once it is built, OTAs from `main` reach only
2.0.0 binaries, and a runtime-1.9.0 hotfix goes out through `ota.sh` from a `release/1.9.x` checkout (the dual-runtime
pattern above). That branch does not exist yet: before the 2.0.0 version bump merges into `main`, the owner must
cut `release/1.9.x` from the last 1.9.0 commit (the parent of the 2.0.0 version-bump commit, where `app.json` still
says 1.9.0) and push it. `ota.sh` reads the runtime from `app.json`, so running it from `main` after the merge
publishes for runtime 2.0.0 only.

Add `DRY_RUN=1` (shell scripts) or omit `--apply` (node script) to see the plan without touching anything.

## Queue ownership rollout: 2.1.1 (26)

The ownership reader requires a **new native 2.1.1 / build 26 baseline**, retaining
`runtimeVersion.policy: appVersion`. This repository change is not a signed IPA or an App Store release.
Do not send it to 2.1.0: that embedded fallback can drop events or reassign ownership.
Use the existing Apple account and a reviewed full Git commit with the producer:

```sh
OWNERSHIP_APPLE_TEAM_ID=<existing-10-character-team-id> node scripts/release/queueOwnershipRollout.cjs produce --commit <full-reviewed-SHA> --output-dir /absolute/new-private-run
```

This is a fixed local Xcode Release/store build using the production profile, never a cloud build.
The commit must contain this producer/config/plugin version and the reviewed reader. Dirty and untracked
caller files are excluded by a retained full Git archive; submodules, symlinks, LFS placeholders,
archive filters and archived dotenv/generated native/dependency trees are refused. The run owns
its nonce, snapshot, build tree, temporary/cache/DerivedData paths and output. npm installs offline
from the integrity-checked lock into a fresh tree. Missing cached inputs fail rather than resolving new
versions. Native resolution also requires a reviewed `native-build-inputs/Podfile.lock`; **this
repository currently has no such lock, so an actual production build remains closed**. Existing
signing/provisioning must already be available locally; the producer never registers credentials or
uses `-allowProvisioningUpdates`. It requires the existing public production settings and Sentry
upload authorization, preserves the configured Sentry org/project checks, and never records the
upload token or a hash of it. EAS remote environment configuration cannot replace these inputs.

The dynamic Expo config preserves the resolved normal config when no producer context exists. During
production it merges reserved signed native provenance, the observer plugin and the explicit
`expo-channel-name: production` update request header, preserving other update settings.
The signed IPA inspector rejects a missing or different production channel; a locally built binary
therefore cannot pass only on runtime/URL while silently losing production OTA delivery. The Xcode plugin
accepts only its known RN bundling invocation. The observer runs Metro and Hermes in that same native
build, refuses a pre-existing/skipped bundle, and retains the final Hermes bytes before signing.
The producer requires their digest to match `main.jsbundle` in the newly signed IPA, and requires the
signed source commit/archive/nonce to match its in-memory expectations. Unsupported hooks/toolchains,
missing observations, stale IPA replay, source/overlay/receipt mutations and mismatched JS fail closed.

Only `completed.json` in the retained run is accepted (schema v2). Keep the **whole run directory** at
its original absolute path, including source archive/manifests, build inputs, staged bundle/observation,
native inputs and signed `baseline.ipa`. Do not move or edit it. `record` and schema-v1 proofs are
rejected; `inspect <absolute IPA>` is diagnostic only and cannot mint acceptance. On failure a run
remains incomplete; retry uses a new output directory. No dry-run operation creates proof.

After the separately authorized native rollout, use:

```sh
OWNERSHIP_BASELINE_PROOF=/absolute/new-private-run/completed.json OTA_RUNTIME_VERSION=2.1.1 bash scripts/release/ota.sh "message"
# Or read-only:
node scripts/release/queueOwnershipRollout.cjs check --proof /absolute/new-private-run/completed.json --runtime 2.1.1
```

The checker rehashes retained inputs, native-stage evidence and signed IPA and checks source ancestry
before any OTA EAS call. A valid completed baseline may support later compatible descendant OTAs;
its original commit/nonce is never relabelled as a new build. `ios-build.sh` rejects ownership builds,
even with `LOCAL_BUILD=1`, before any external call and points to the producer.

This is trusted local producer process provenance. It does not prove reproducible compilation or defend
against a privileged dishonest builder. Local tests use explicitly labelled fake build/signature tools
through internal dependency injection; no production flag or environment variable selects them.
A real authorized signed build must still demonstrate the hook timing, metadata signature coverage,
bundle equality and checker acceptance. Store/TestFlight availability, distribution, device fallback
and queue behavior remain separate unverified obligations. Until that evidence exists, do not claim
this source change has opened the live release gate.
