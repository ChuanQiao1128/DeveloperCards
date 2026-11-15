# Publish fencing and rollback recovery

A committed build is identified by its immutable path and SHA-256. `decks.live_build_id` selects delivery; a rollback reuses a previously successful build through a new immutable release action. It does not create a new content build.

## Lifecycle and invariants

| Entity/state | Event | Next state and persisted effect | Rejection/recovery |
| --- | --- | --- | --- |
| Publish PENDING | authorized claim | PROCESSING | stale generation/revoked evidence cannot acquire |
| Publish PROCESSING | fenced commit | SUCCESS + live pointer + pending manifest delivery atomically | stale expected live, generation or editing snapshot aborts |
| Delivery pending | due claim | pending with unique lease token, expiry and incremented attempts | active lease is not stolen |
| Claimed delivery | conditional S3 success | delivered, only for matching lease token | expired claimant cannot acknowledge replacement claim |
| Claimed delivery | S3 error | pending with retry time, or needs_attention at five attempts | durable intent survives process loss |
| Authorized rollback | new action | old build selected, generation fenced, immutable action and delivery wake-up persisted | wrong source/target/hash or later live generation rejects |
| Rollback replay | same action and payload | exact stored response; retry due pending manifest delivery | changed payload rejects; no extra build/action/generation |

The manifest builder reads HEAD before database pointers. A changed ETag produces 412/409 and causes a fresh HEAD and database rebuild, with at most three attempts. An absent object uses `If-None-Match: *`. Wall-clock metadata is diagnostic, never proof that a specific commit is present. Durable delivered state suppresses duplicate work.

The worker must never publish a job-specific historical manifest. Recovery always reads current database pointers. A rollback's manifest retry must therefore also respect any later successful publish.

## Verification checklist

- Pause A after reading old pointers; publish B; resume A and verify final manifest path/build/hash remains B, with both initial 404 and existing-object ETag cases.
- Repeat with A's clock ahead of B.
- Expire A's delivery lease and let B claim; A cannot acknowledge B's failed delivery.
- Fail S3 after rollback database commit; recover using the same action and verify exact stored response, one generation change, one ledger action, no fabricated build.
- Verify runtime/public permissions and immutable action/build data using isolated PostgreSQL roles.

Migration 059 adds rollback provenance and durable recovery for newly recorded actions. Historical ledger entries retain unknown provenance rather than an invented actor/reason. Callers without a reason remain supported and are recorded with the explicit legacy reason marker. Migration 056 remains unchanged.
