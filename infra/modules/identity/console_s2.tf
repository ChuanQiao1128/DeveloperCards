# New observer role: no content, queues, secrets, metric API, HTTP route or core invocation.
variable "console_s2_observer" {
  type = object({
    function_name      = string
    subnet_arns        = list(string)
    security_group_arn = string
    vpc_arn            = string
  })
  default = null
  validation {
    condition = var.console_s2_observer == null ? true : (
      var.console_s2_observer.function_name == "developercards-operations-observer" &&
      length(var.console_s2_observer.subnet_arns) > 0 &&
      alltrue([for arn in concat(var.console_s2_observer.subnet_arns, [var.console_s2_observer.security_group_arn, var.console_s2_observer.vpc_arn]) : startswith(arn, "arn:aws:ec2:") && !strcontains(arn, "*")])
    )
    error_message = "Observer requires its fixed production name and exact existing network ARNs."
  }
}

resource "aws_iam_role" "console_s2_observer" {
  count = var.console_s2_observer == null ? 0 : 1
  name  = "developercards-operations-observer-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "console_s2_observer" {
  count = var.console_s2_observer == null ? 0 : 1
  name  = "developercards-operations-observer-scoped"
  role  = aws_iam_role.console_s2_observer[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "OwnLogStreams", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.console_s2_observer.function_name}:*"
      },
      {
        # Describe APIs have no resource scope; Lambda ENI provisioning needs these.
        Sid       = "VpcDescribe", Effect = "Allow"
        Action    = ["ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = var.region } }
      },
      {
        # EC2 authorizes the new ENI, subnet and SG separately; scope each resource ARN.
        Sid      = "CreateInExactNetwork", Effect = "Allow", Action = ["ec2:CreateNetworkInterface"]
        Resource = concat(["arn:aws:ec2:${var.region}:${var.account_id}:network-interface/*", var.console_s2_observer.security_group_arn], var.console_s2_observer.subnet_arns)
      },
      {
        Sid       = "ManageVpcInterfaces", Effect = "Allow"
        Action    = ["ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
        Resource  = "arn:aws:ec2:${var.region}:${var.account_id}:network-interface/*"
        Condition = { ArnEquals = { "ec2:Vpc" = var.console_s2_observer.vpc_arn } }
      },
      {
        # Deny ENI calls from function code; Lambda service provisioning remains allowed.
        Sid       = "NoEniCallsFromHandler", Effect = "Deny"
        Action    = ["ec2:CreateNetworkInterface", "ec2:DeleteNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
        Resource  = "*"
        Condition = { ArnEquals = { "lambda:SourceFunctionArn" = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.console_s2_observer.function_name}" } }
      },
    ]
  })
}

resource "aws_iam_role_policy" "console_s2_collector_invoke" {
  count = var.console_s2_observer == null ? 0 : 1
  name  = "developercards-synthetic-observer-invoke"
  role  = aws_iam_role.synthetic_check.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = ["lambda:InvokeFunction"]
      Resource = "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.console_s2_observer.function_name}:prod"
    }]
  })
}

output "console_s2_observer_role_arn" {
  value = try(aws_iam_role.console_s2_observer[0].arn, null)
}
