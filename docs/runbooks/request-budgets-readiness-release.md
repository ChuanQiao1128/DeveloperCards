# Online budgets and local release evidence

`VpcFunction.Handler` mounts one 25-second cooperative deadline, shortened to Lambda remaining time minus 500 ms. Both `Pg` pools pass the token to connection opening and dispose failed opens. Both `DbUtil` implementations bound command timeout by the remaining budget and pass the token to execution, reader iteration and null reads. Direct online transactions, direct commands, Cognito JWKS fetches, S3 reads/body reads and SQS sends also receive that scope. Cancellation awaits the driver/SDK; it does not abandon a running database task. Transaction disposal rolls back before the handler returns. Network cancellation acknowledgement can add driver cleanup time; the scope is not a hard process-kill timer.

A timeout does not establish that a previously committed write or accepted SQS send failed. Publish keeps its existing `PUBLISH_DISPATCH_UNCONFIRMED` response and durable job identity; poll that job or retry with the same action identity. The existing dispatch lease remains the recovery fence. Do not create a replacement publish or downgrade a processing/terminal job after a timeout. `request_deadline` is a structured log tag on uncaught budget expiry, without new metric dimensions or alarms. Some existing route-specific catches retain their existing response codes.

Worker and maintenance entry points do not mount the online scope. The existing migrate/create/recreate/bootstrap admin paths remain exempt until runtime isolation is enabled; their authorization and migrate-secret guards remain in place. Worker timeout 615 s, SQS visibility 3700 s and batch 1 remain unchanged. `3700 >= 6 * 615`. The existing maintenance timeouts and transaction-local migration overrides stay independent.

## On-demand readiness

Use the existing authenticated `GET /api/v1/db/ping` administration route with the normal console admin token; agent clients and app tokens retain existing policy restrictions. It reads `schema_migrations` and probes `decks`; it never creates a table, runs a migration or repairs anything. The hardening wave's recorded minimum schema is 55. An absent/older ledger returns 503. Schema and environment diagnostics are not public. `GET /health` remains a cheap in-process response even while readiness is waiting for a migration lock. A 200 is a point-in-time read, not proof of every route's health or current production deployment.

## Connection and execution capacity

The unchanged online reserved concurrency is 40 with 512 MB; each configured pool defaults to `PG_MAX=1`. Worker concurrency is 2 with 512 MB. `40*1 + 2*1` counts only an illustrative set of active invocation pools. It is **not a database connection cap**: idle Lambda environments retain connections, both shared and VPC helpers can create separate pools, and maintenance/migration sessions consume additional connections. Preserve database connection headroom and inspect existing logs when needed. No new instance, larger pool, recurring probe or background job is introduced. This work does not establish production latency, CPU/GB-s or billing savings.

## Local release record

Build/package with the existing offline `src_C/package_lambda_zip.sh linux-arm64` (requires .NET on PATH), then stage with the CD tool `scripts/cd/artifact.sh stage LOCAL_DIRECTORY backend`. Keep its printed manifest SHA-256 from the build step. The artifact manifest and every referenced file are validated locally:

```sh
python3 scripts/cd/release-record.py --repo . \
  --manifest LOCAL_DIRECTORY/SHA256SUMS --manifest-sha256 BUILD_STEP_MANIFEST_HASH \
  --commit FULL_GIT_COMMIT --content-build INTENDED_CONTENT_BUILD \
  --ota-runtime INTENDED_OTA_RUNTIME --out NEW_LOCAL_RECORD.json
```

The record includes source commit, dirty-tree flag, artifact hashes, supported minimum database schema and intended content/OTA identifiers. A dirty tree is explicitly an uncommitted local build, not an exact commit release. Files already at `--out` are never overwritten. All live alias/commit/artifact/schema/content/OTA/billing fields remain `UNKNOWN`; this command does not query AWS, publish, or infer online state from local settings. Match any later deployment to its actual CD build artifact and authorized readback separately. Production schema compatibility and device/runtime adoption remain unverified by this record.

## Offline cost guard

For an already-produced Terraform JSON plan, run both the ordinary existing allow-list checker and the wave-specific cost gate:

```sh
python3 infra/scripts/check-plan.py --plan LOCAL_PLAN.json --allow REVIEWED_ALLOW_LIST.json
python3 infra/scripts/check-wave-cost.py --plan LOCAL_PLAN.json
python3 -m unittest discover -s scripts/cd/tests -p test_release_governance.py -v
```

The cost gate permits only effective IAM changes and no-op infrastructure; it rejects compute, database, schedules, queues, metric alarms/filters and all other effective resource changes. IAM acceptance here concerns recurring resource cost only; IAM security review and existing plan approvals still apply. The source regression checks preserve API/Worker/queue resource numbers. Synthetic positive/negative plans verify the gate; they do not establish a live Terraform diff or actual charges. No Cost Explorer or GetMetricData queries are performed; billing is unverified. New background work stays off.

## Recovery evidence and limits

For `request_deadline`, inspect the existing trace ID and route log. Verify the relevant transaction is no longer active before replaying a non-idempotent request; use existing action/job identities wherever present. For dispatch-unconfirmed and manifest pending states use the existing protected job-status/retry/reconcile routes and the durable job ID. An incomplete identity deletion retains its barrier and must not resume normal user sync. Runtime schema/isolation maintenance follows `database-maintenance-isolation.md`; this runbook does not authorize production maintenance. Keep the 2026-10-04 RDS recovery drill as historical evidence; current RTO/RPO and production PITR have not been remeasured here.
