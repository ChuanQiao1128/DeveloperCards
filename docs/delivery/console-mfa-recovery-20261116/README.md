# Console MFA deployment recovery

Terraform run [43707294567](https://github.com/ChuanQiao1128/DeveloperCards/actions/runs/43707294567), for main
`32373721f63e0566069d357e660468497c7b113d`, stopped before apply. Its full plan included four unrelated
`module.operators` IAM changes, which the existing break-glass guard refused. The run did not disable live MFA.

This change adds an explicit `console_mfa_only=true` dispatch from main. Both plans target only
`module.identity.aws_cognito_user_pool.console[0]`, with the existing
`docs/delivery/web-authoring-safety-20261115/CONSOLE-MFA.plan-allow.json`. Default dispatch remains the full read-only
drift check. Existing environment approval, OIDC role, preflight, guard, allow-list gate, state locks, saved-plan
apply, state recovery and private-log cleanup remain in place.

The recovery also checks the existing pool identity, update/no-op actions, known MFA OFF and TOTP disabled values,
and absence of imports/moves/replacements. Extra resource, field or output changes still fail the existing gate.
An already OFF pool needs no apply. Dispatch applies are included when refusing stale older commits, including
partly failed applies. A targeted empty second plan does not establish that the rest of production is in sync.

Local checks:

- Regression checks failed against the original workflow/helper, then passed after the fix.
- `python3 -m unittest discover -s infra/scripts/tests`: 299 passed, offline synthetic plans and mocked Actions API.
- `actionlint .github/workflows/terraform.yml`: passed.
- `tf-pipeline.py preflight`, `pr-check --base origin/main`, Terraform fmt and `git diff --check`: passed.

Production result and the actual Cognito provider plan remain unverified until the approved recovery run completes.
Operator IAM changes require their separate break-glass process; this recovery does not apply them.
