# Console MFA provider contract correction

Run [43709478919](https://github.com/ChuanQiao1128/DeveloperCards/actions/runs/43709478919), main
`f3ea56f33072802091649c524de8231e9f82a8aa`, passed guard, the MFA value check and the allow-list gate. Apply then
failed at Cognito `SetUserPoolMfaConfig`, HTTP 400. The public diagnostic did not preserve the exact AWS exception
or message. Apply was attempted; the live setting remains unverified.

The fixed [AWS provider 6.66.0 documentation](https://github.com/hashicorp/terraform-provider-aws/blob/v6.66.0/website/docs/r/cognito_user_pool.html.markdown#L236-L240)
requires MFA OFF and removal of the entire software token block when SMS is absent. Console has no SMS block.
The previous `enabled=false` block violated this contract: the provider still sends a configuration object for it.
Removing it [produces nil](https://github.com/hashicorp/terraform-provider-aws/blob/v6.66.0/internal/service/cognitoidp/user_pool.go#L1406-L1418).
The [upstream acceptance test](https://github.com/hashicorp/terraform-provider-aws/blob/v6.66.0/internal/service/cognitoidp/user_pool_test.go#L610-L658)
specifically transitions ON/TOTP to OFF with zero software token blocks. These are source evidence, not a claim
that the upstream test was executed here or that the precise private AWS error was recovered.

The correction removes that block and changes the recovery check to require OFF plus an empty list. It rejects
both explicit false and true blocks. The allow-list still permits only the original two MFA fields on the existing
Console pool. Fixed targeting, approvals, OIDC, guard, saved-plan apply, locks, recovery, cleanup, stale checks and
the empty second targeted plan remain unchanged.

Validation: regression checks rejected the old configuration and false-block gate; 304 infrastructure script tests
passed. The actual Cognito HCL passes the offline mocked-provider policy check. Terraform root validation, fmt,
actionlint and PR allow-list checks are also required before merge. Mocking does not establish AWS API acceptance.
The approved recovery must freshly read the pool, apply its saved plan, then confirm OFF/empty TOTP through provider
readback and an empty second targeted plan before calling the production change complete.

Merging changes this allow-file's note, so the ordinary full-plan push run starts too. Cancel that run before its
approval and dispatch only the existing explicit Console recovery from corrected main. Do not approve either old
failed run or apply the unrelated operator IAM changes.
