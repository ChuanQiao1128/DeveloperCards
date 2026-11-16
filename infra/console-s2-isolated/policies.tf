locals {
  log_statement = { for key in keys(local.functions) : key => {
    Sid      = "OwnLogStreams", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
    Resource = ["${aws_cloudwatch_log_group.test[key].arn}:*"]
  } }
  eni_statements = [
    { Sid = "VpcDescribe", Effect = "Allow", Action = ["ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets"], Resource = ["*"], Condition = { StringEquals = { "aws:RequestedRegion" = local.region } } },
    { Sid = "CreateInExactSubnets", Effect = "Allow", Action = ["ec2:CreateNetworkInterface"], Resource = ["*"], Condition = { ArnEquals = { "ec2:Subnet" = [for id in var.subnet_ids : "arn:aws:ec2:${local.region}:${local.account}:subnet/${id}"], "ec2:SecurityGroup" = aws_security_group.test.arn } } },
    { Sid = "ManageVpcInterfaces", Effect = "Allow", Action = ["ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"], Resource = ["arn:aws:ec2:${local.region}:${local.account}:network-interface/*"], Condition = { ArnEquals = { "ec2:Vpc" = "arn:aws:ec2:${local.region}:${local.account}:vpc/${var.vpc_id}" } } },
  ]
  content_statements = [
    { Sid = "OwnBucketList", Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.test.arn] },
    { Sid = "OwnContent", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.test.arn}/content/*", "${aws_s3_bucket.test.arn}/premium/*"] },
  ]
  app_statements = {
    core = concat(local.content_statements, [
      { Sid = "ReadSnapshot", Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.test.arn}/${local.snapshot}"] },
      { Sid = "PublishOnlyOwnQueue", Effect = "Allow", Action = ["sqs:SendMessage", "sqs:GetQueueAttributes"], Resource = [aws_sqs_queue.test.arn] },
    ])
    worker = concat(local.content_statements, [
      { Sid = "ConsumeOnlyOwnQueue", Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"], Resource = [aws_sqs_queue.test.arn] },
    ])
    observer = []
    collector = [
      { Sid = "ReadOwnSnapshot", Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.test.arn}/${local.snapshot}"] },
      { Sid = "WriteOwnEncryptedSnapshot", Effect = "Allow", Action = ["s3:PutObject"], Resource = ["${aws_s3_bucket.test.arn}/${local.snapshot}"], Condition = { StringEquals = { "s3:x-amz-server-side-encryption" = "AES256" } } },
      { Sid = "InvokeOnlyObserver", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = ["arn:aws:lambda:${local.region}:${local.account}:function:${local.name}-observer:test"] },
      { Sid = "ReadOnlyOwnMetricAlarms", Effect = "Allow", Action = ["cloudwatch:DescribeAlarms"], Resource = [for name in local.alarm_names : "arn:aws:cloudwatch:${local.region}:${local.account}:alarm:${name}"] },
    ]
  }
}
resource "aws_iam_role_policy" "test" {
  for_each = local.functions
  name     = "isolated-only"
  role     = aws_iam_role.test[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [local.log_statement[each.key]],
      each.key == "collector" ? [] : local.eni_statements,
      local.app_statements[each.key],
      [{ Sid = "DenyProductionResources", Effect = "Deny", Action = ["s3:*", "sqs:*", "execute-api:*", "secretsmanager:*", "ssm:*", "lambda:InvokeFunction"], Resource = var.production_deny_arns }],
      each.key == "collector" ? [] : [{
        Sid       = "NoEniCallsFromHandler", Effect = "Deny"
        Action    = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
        Resource  = ["*"]
        Condition = { ArnEquals = { "lambda:SourceFunctionArn" = "arn:aws:lambda:${local.region}:${local.account}:function:${local.name}-${each.key}" } }
      }],
    )
  })
}
