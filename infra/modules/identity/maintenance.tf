# No Lambda or schedule is created. The owner attaches this role only to an immutable
# maintenance version of the EXISTING VPC function; normal runtime never receives it.
resource "aws_iam_role" "maintenance" {
  name = "developercards-db-maintenance-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}
resource "aws_iam_role_policy" "maintenance" {
  name = "existing-vpc-function-maintenance-only"
  role = aws_iam_role.maintenance.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.core_vpc_function_name}:*" },
      { Effect = "Allow", Action = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces"], Resource = "*" },
      { Effect = "Deny", Action = ["lambda:*", "sts:AssumeRole", "iam:PassRole", "ssm:GetParameter*", "secretsmanager:GetSecretValue"], Resource = "*" }
    ]
  })
}
# Defense in depth, including future runtime policy additions. Version environments
# contain distinct credentials, so runtime cannot inspect ANY Lambda configuration.
resource "aws_iam_role_policy" "runtime_no_maintenance" {
  for_each = { api = aws_iam_role.core_vpc.name, worker = aws_iam_role.worker.name }
  name     = "deny-maintenance-capabilities"
  role     = each.value
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Deny", Action = ["lambda:GetFunction*", "lambda:ListFunctions", "lambda:ListVersionsByFunction", "lambda:InvokeFunction", "lambda:UpdateFunction*", "lambda:PublishVersion", "lambda:UpdateAlias", "iam:PassRole", "sts:AssumeRole"], Resource = "*" },
      { Effect = "Deny", Action = ["ssm:GetParameter*", "secretsmanager:GetSecretValue"], Resource = "*" }
    ]
  })
}
output "maintenance_role_arn" { value = aws_iam_role.maintenance.arn }
