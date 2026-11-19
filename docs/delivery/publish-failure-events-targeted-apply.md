# Worker publication failure event permission

The full apply for PR #875 was refused before changes because its production plan included unrelated `module.operators` drift. Those resources remain untouched.

Run the existing Terraform workflow on main with only `content_publish_notify_only=true`. It selects the fixed `docs/delivery/publish-failure-events.plan-allow.json` and the single literal target `module.identity.aws_iam_role_policy.worker_notify_send`. The approved policy grants the existing Worker role only `sqs:SendMessage` on the existing notification queue.

Both the saved first plan and the residual plan use that same target. The main-only, stale-commit, preflight, infra-prod owner approval, break-glass guard, exact allowlist, saved-plan apply and empty residual-plan checks remain required. Mode combinations are rejected before credentials. A no-op retry must still pass the empty-plan check. This targeted result does not verify full production drift.

After successful application, PR #876 may deploy the producer. The notifier consumer was already deployed by PR #875.
