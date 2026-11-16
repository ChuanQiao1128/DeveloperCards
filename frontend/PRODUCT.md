# DeveloperCards Console

The existing web console serves content editors and super administrators. Deck authoring remains the default `/` route. Existing deck, review, QA, reports, usage, automation, ledger and administrator workflows retain their destinations.

The authorized operations extension adds four read-only super-administrator routes: `/overview`, `/operations`, `/learners` and `/learners/:sub`. Operators inspect source evidence and the backend-observed learner directory. It is not a complete registration directory. Sources, freshness and unknown states must remain explicit. The API is the authorization authority.

Learner search and responses stay in memory, scoped to the active identity and permission generation. RevenueCat raw evidence, legacy entitlements, evaluated tier and premium download permission have distinct meanings. Server progress is separate from device telemetry; queue, complete sync and running device OTA remain unknown.

Source: the approved W1 contract `console-w1-contract-v1` (2026-11-16), and the existing ConsoleShell and routes. This documents the agreed extension; it introduces no account mutations or new product claims.

The user management refinement (2026-11-17) presents the existing observed directory as a Chinese table and profiles with account, membership and learning tabs. Search and cursor position survive profile drilldown only in a mounted, identity-scoped workspace; leaving that workspace or changing identity clears them. Existing source semantics and authorization stay authoritative. This batch adds no account mutations, membership filters, or registration-directory claims.
