# The existing MFA owner is already AdministratorAccess and remains the sole
# maintenance configurator/invoker. No new admin policy or broad PassRole grant.
# Ordinary deploy/CD roles cannot pass or assume the dedicated execution role.
# Runtime denies live in identity/maintenance.tf; owner recovery permissions remain.
resource "aws_iam_role_policy" "deploy_no_maintenance" {
  for_each = { local = aws_iam_role.deployer.name, cd = aws_iam_role.gha_prod.name }
  name     = "deny-maintenance-execution-role"
  role     = each.value
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Deny", Action = ["iam:PassRole", "sts:AssumeRole"], Resource = "arn:aws:iam::${var.account_id}:role/developercards-db-maintenance-role" },

    ]
  })
}
