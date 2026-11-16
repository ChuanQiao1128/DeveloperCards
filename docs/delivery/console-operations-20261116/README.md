# Console operations: first read-only release

This release adds `/overview`, `/operations`, `/learners` and `/learners/:sub`.
The existing deck landing page and all existing deep links stay available.
The new pages and three `/api/v1/admin/` read endpoints require a normal Console
`super_admin` session. App identities, editor sessions and agent clients cannot
read them. Existing handler and gateway authentication semantics are preserved.

## Data meaning and access

- The directory contains backend-observed `users`, not every Cognito registration.
  First observed time is not registration time; last server activity is not login
  or successful complete sync. Event receipts and projected review counts remain
  separate. Device queues and the OTA running on a device are unknown.
- RevenueCat mirror, legacy entitlements, environment and expiration are shown
  separately. Effective entitlement projection and production download eligibility
  follow the existing two runtime paths; they are not payment statements.
- New reads append a minimal required audit row without username, email, search,
  cursor, response payload or before/after data. Audit failure returns 503 without
  sensitive data. New handler responses use `Cache-Control: private, no-store`.
- Search stays in session memory. Requests and query caches are bound to session
  generation; logout, identity/role changes and authoritative 403 responses clear
  the session state. This does not revoke an already issued JWT upstream: the
  actual expiry and verifier skew still apply.

## Monitoring path

The existing external synthetic function keeps its existing checks and schedule.
It can write one bounded observation to the existing private premium bucket:
`ops/console-monitor/v1/current.json`. This is outside content download/CDN paths.
The API reads that fixed object through its existing S3 network path, with a
64 KiB body bound and a two-second deadline. It never calls CloudWatch or Sentry
from the VPC request path.

The producer records the run start before probing. It reads the existing ETag,
rejects equal/older observations, and conditionally writes using `IfMatch` or
`IfNoneMatch`. A conflicting write is re-read, with at most three attempts.
Corrupt existing state is not overwritten automatically. Failures expose only
bounded reason codes, not provider error text.

The snapshot lasts 30 minutes. Missing, denied, invalid, future or expired
observations cannot establish current health. `/health` proves liveness only;
the anonymous auth/sync probes prove rejection behavior, not authenticated sync.
Metric-alarm `OK` means not firing, not sufficient service traffic or SLO health.
The UI links to the existing CloudWatch dashboard and Sentry organization.

Configuration is non-secret `OPS_SNAPSHOT_BUCKET`, fixed `OPS_SNAPSHOT_KEY`,
bounded `OPS_ALARM_NAMES`, `OPS_CLOUDWATCH_URL` and `OPS_SENTRY_URL`. Production
bucket identity, encryption, endpoint access and privacy must be read back before
activation. There is no new bucket, public policy, VPC egress or schedule.

## Release order

1. Pass source-bound tests, build, browser checks and independent code/data review.
2. Generate and check a saved Terraform plan permitting only the new synthetic
   role inline policy in `OPS.plan-allow.json`. Verify its exact object and five
   existing metric-alarm ARNs. Never apply unrelated IAM drift.
   Before first activation, initialize the absent snapshot once with the reviewed
   producer and actual production probes under the owner's existing MFA session.
   Confirm `NoSuchKey` using that existing owner access, then use conditional
   creation; never seed fixture data or overwrite an existing/corrupt object.
   This is one bounded deployment probe. The collector has no `ListBucket`, so
   S3 can return 403 for a missing key; it must keep treating denied reads as
   failures rather than guessing that the object is absent. Subsequent scheduled
   runs use the existing object's ETag without any broader permission.
3. Apply migration 061 before serving the new APIs. It adds the index matching
   the directory's C-collated cursor and rejects a conflicting existing definition.
   Read back the index and migration receipt, then confirm an idempotent repeat.
4. Deploy the reviewed immutable backend, synthetic and Console artifacts through
   existing CD. Preserve legacy DB role mode, TLS verification, automation mode
   and any disabled/paused schedule. No native build or mobile update is included.
5. Read back actual versions, private snapshot and cache headers. Confirm anonymous
   S3/CDN access cannot fetch the observation. Use real Console and dedicated App
   test identities for the authenticated source-to-page chain. Keep mock browser,
   local database, provider and actual notification evidence separate.

Deployment eligibility is not final acceptance. Final release evidence must also
cover actual identity/provider behavior, bounded isolated recovery drills and
notification receipt. Unavailable evidence remains unknown; this document does
not attest that those checks ran.

## Verification notes

Use the existing PostgreSQL Testcontainers suite, frontend Vitest/build/lint,
mock-browser smoke under production CSP, and synthetic pytest suite. The shared
`operations-snapshot-v1.json` fixture is generated by the actual Python producer
and consumed by a C# contract test; it is deterministic fixture evidence, not a
live cloud result.

The directory index decision used an isolated 10,000-row PostgreSQL experiment;
those timings are not production performance claims. The existing measured eager
bundle rounding policy allows 493,000 raw bytes for W1 (baseline 489,979, measured
492,565). First-load and lazy-import safety assertions remain unchanged.
