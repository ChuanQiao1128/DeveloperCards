# Read-only Console observations use the existing private premium bucket, outside
# every content/download prefix. No public access, new schedule or VPC egress.
locals {
  console_operations_snapshot_arn = "arn:aws:s3:::${var.premium_bucket_name}/ops/console-monitor/v1/current.json"
  console_operations_alarm_names = [
    "developercards-prod-core-vpc-errors",
    "developercards-prod-worker-errors",
    "developercards-prod-synthetic-check-failing",
    "developercards-prod-sqs-oldest-age",
    "developercards-prod-dlq-nonempty",
  ]
}

resource "aws_iam_role_policy" "console_operations_snapshot" {
  name = "developercards-console-observation-snapshot"
  role = aws_iam_role.synthetic_check.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadSnapshotForConditionalWrite"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [local.console_operations_snapshot_arn]
      },
      {
        Sid      = "WriteEncryptedSnapshot"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = [local.console_operations_snapshot_arn]
        Condition = {
          StringEquals = { "s3:x-amz-server-side-encryption" = "AES256" }
        }
      },
      {
        # Only metric alarms: composite DescribeAlarms would require Resource *.
        Sid      = "ReadExistingMetricAlarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = [for name in local.console_operations_alarm_names : "arn:aws:cloudwatch:${var.region}:${var.account_id}:alarm:${name}"]
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.region }
        }
      },
    ]
  })
}
