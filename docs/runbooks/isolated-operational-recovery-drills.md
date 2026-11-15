# Isolated operational recovery drills

These two tests exercise real PostgreSQL migrations and handlers. Notification delivery is an ordinary HTTP POST to a receiver bound to `127.0.0.1`; no CloudWatch alarm evaluation, SNS routing, Sentry ingestion, production delivery, API Gateway/Cognito authentication or native mobile queue is established by these results.

Run only with the exclusive .NET integration-test slot, the existing local Docker Unix socket, restored .NET dependencies and no production routing environment. The tests create and dispose their own PostgreSQL container; they accept no database or business API target. Do not provide a remote `DOCKER_HOST`. Clear provider routing before invoking the runner:

```sh
env -u WEBHOOK_QUEUE_URL -u AI_QA_QUEUE_URL -u PUBLISH_QUEUE_URL \
  AUTOMATION_MODE=off AI_QA_ENABLED=0 \
  python3 scripts/ops/operational_recovery_drills.py \
  --evidence-dir /absolute/path/to/current-run/evidence --attempt 1
```

The runner is finite: exactly two selected integration tests, 180 seconds for build/startup/tests combined, each drill at most 60 seconds, at most 15 handler invocations per drill, no business HTTP requests, two local notification receipts per drill, and at most 32 KiB of JSON event evidence per drill (64 KiB combined). Each notification is at most 4 KiB and has a five-second timeout. Synthetic deck objects are at most 64 KiB each. The sink and container are disposed when the tests finish. Build/test console logs are separate from event evidence. Evidence stays in the explicitly selected current-run directory; no remote storage, schedule, retention setting or paid resource is added. Review and archive/delete that directory through the normal run retention process. At most three implementation attempts are allowed; logs are created exclusively so a failed attempt cannot be overwritten.

## Persisted states and transitions

| Entity | From | Event | To / persisted proof |
| --- | --- | --- | --- |
| Progress event | absent / locally pending | Injected PG constraint rejects write | HTTP 500; zero stored event rows |
| Progress event | absent / pending | Remove only injected constraint; retry same event | HTTP 200; accepted=1; one event and one review |
| Progress event | stored | Replay same event | HTTP 200; duplicate ID; accepted=0; review count remains one |
| Publish | no job | Publish handler commits intent; injected queue timeout | HTTP 503; durable PENDING job and dispatch row |
| Dispatch | leased / unconfirmed | Simulate lease expiry, call real dispatch | Captured original job message; real worker processor runs |
| Publish | PENDING | Real processor uploads immutable artifacts and commits | SUCCESS; live build and persisted content hash |
| Manifest intent | pending | Injected local transport failure | Job remains SUCCESS; intent remains pending |
| Manifest intent | pending | Simulate retry time; actual conditional rebuild | delivered; current build/path/hash agree with downloaded bytes |

Invariants: unaccepted progress is preserved for retry; the replay must not add a review; an unconfirmed enqueue must not lose its durable intent; manifest failure must not downgrade SUCCESS; a manifest cannot claim the bytes of another build. The tests reject inflated counters, missing final state, mismatched hashes, unconditional object writes, non-loopback sink addresses and unexpected notification order. The local lease/time adjustment changes only test rows; it does not bypass production eligibility predicates.

For each drill the first local receipt is `ALARM`, after the failure has been observed, and the second is `OK`, after final-state assertions. These receipts are explicitly sent by the drill controller, not by a cloud provider. The sync failure is a backend 500. An offline client that has not sent a request is pending work and supplies no API-service failure observation.

## Evidence and monitoring interpretation

The runner records the starting Git commit plus SHA-256 of the exact handler, delivery, processor, uploader, fixture, dashboard and runner sources. It stores the exact command and exit code, elapsed time, notification receipts, restored path and final data. A failed command writes no successful receipt manifest. Preserve its raw log alongside any later successful attempt; do not hand-write a PASS.

The dashboard's 28-day budgets now have no false-value fallback. Below the existing sample floor the value is unknown (no datum), including no traffic. Budget values summarize historical measurements; they do not establish current health when telemetry is stale. Use the existing synthetic heartbeat to assess freshness: it still runs every 15 minutes and deliberately alarms on two missing periods. Paging suppression thresholds, metric dimensions, infrastructure schedules and retention stay unchanged. The budget counts remain visible so operators can distinguish unknown from measured budget consumption.

Verification checklist: both selected tests pass; four local HTTP receipts exist; sync's event/review counts remain one; the published job and manifest are delivered; deck version equals the current build; downloaded SHA-256 equals the manifest; the source snapshot still matches the tested files. Separately verify CloudWatch/SNS/Sentry provider routing and delivery, real production recovery and native mobile recovery only in an explicitly authorized environment. Those gates remain UNKNOWN here.
