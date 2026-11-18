# Daily card-pack updates

Each batch remains five cards. The user reads the frozen independently reviewed draft, then says “发布”. The content path reuses the validated application/backend version and publishes that exact card data through Console. Code changes retain merge/CI gates. No recurring automation or new card batch is started here.

## Settings states and acceptance

Settings shows the active pack's installed version/download time, latest available version and check status. It uses the existing installer; learning records, ownership and selected pack are not changed. Local metadata is displayed only while the card file exists. “Up to date” requires a successful remote manifest response (including a valid304) and matching file-backed version after installation. A cached-only/offline response cannot produce that state.

| State | Event | Result |
| --- | --- | --- |
| loading | Local metadata read | idle or error; no network request |
| idle/current/error | Check pressed | checking; duplicate presses ignored |
| checking | New version or missing file | updating through existing installer |
| checking | Remote and installed versions match | current |
| updating | Accepted download and matching readback | current |
| checking/updating | Network/download/readback/account failure | error; retain known version and allow retry |
| any | Account/active pack changes | New keyed section; discard old UI result |

The existing per-account file/metadata publication mechanism persists installed content. Last-check UI state is transient. Account generation is checked around asynchronous update work. The same-version installer fast path now also verifies the file exists, allowing recovery after file loss. Tests cover offline fallback,304, failed/mismatched installs, missing files, duplicate clicks, account switches and retry. Initial independent findings and failed test evidence are preserved in the local delivery artifacts.

## Runtime boundary

Main is2.1.1/build26 with progress ownership format1 and must not be relabeled for the connected2.1.0/build25 phone. The compatible UI patch is based on the current production source `b344cb630fcd69d3d4ffa9c545d9b7cbaed472de` (EAS group `c81d12d9-7f03-44c5-8e44-64da2c3b132a`). The initial reconstruction from older published `82f246db778a8942bee41c0f2086f3c2788a4c83` is retained as a superseded artifact; it omits later auth, prerequisite and compact-card updates and must not be published. The feature changes four product JS files and five test files. Native config, runtime dependencies and legacy queue stay on the current production baseline. A fresh audit also requires the existing main build-tool fix node-forge1.4.0→1.4.3; that single lock record and the unchanged main expiring audit policy are checked against both platform source maps. Main's ownership gates stay intact. Publication and physical-device evidence are recorded separately; a connected phone or379-card count does not prove its installed version.

## Fixed release preparation

`tools/aws_cards/repair_release.py prepare REQUEST.json OUTPUT` binds actual frozen model receipts/responses, official snapshots, deterministic rendering and the exact prior published bundle/receipt. PostgreSQL16 and the existing.NET adapter compute actual backend hashes; unchanged cards retain prior evidence and revisions. This command does not invoke models, generate authorization or publish.

`verify-baseline OUTPUT BACKUP.json` checks the same prepared release, deck, current editing snapshot metadata and live pointer, recording the bundle/backup SHA. Console retains authenticated import/review/publish and durable same-action recovery. Final acceptance still requires job success, live pointer, manifest delivery, actual CDN SHA and all bilingual fields/revisions. No key/snapshot rebasing bypass is added.
