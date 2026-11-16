locals {
  name      = "dc-console-s2-${var.run_id}"
  database  = "dc_console_s2_${replace(var.run_id, "-", "_")}"
  namespace = "DeveloperCardsConsoleS2_${var.run_id}"
  tags      = { ManagedBy = "console-acceptance-s2", RunId = var.run_id, ExpiresAt = var.expires_at }
  account   = "622994489535"
  region    = "ap-southeast-2"
  snapshot  = "ops/console-monitor/v1/current.json"
  issuer    = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.test.id}"
  functions = {
    core      = { runtime = "dotnet10", handler = "RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler", memory = 512, timeout = 90, concurrency = 2 }
    worker    = { runtime = "dotnet10", handler = "RecallSmith.Lambda.Worker::RecallSmith.Lambda.Worker.WorkerFunction::FunctionHandler", memory = 512, timeout = 615, concurrency = 2 }
    observer  = { runtime = "dotnet10", handler = "RecallSmith.Lambda.OperationsObserver::RecallSmith.Lambda.OperationsObserver.Function::Handler", memory = 256, timeout = 8, concurrency = 1 }
    collector = { runtime = "python3.12", handler = "synthetic_check.handler.lambda_handler", memory = 256, timeout = 60, concurrency = 1 }
  }
  aliases = { for key in keys(local.functions) : key => "arn:aws:lambda:${local.region}:${local.account}:function:${local.name}-${key}:test" }
  db_environment = {
    PGHOST            = var.database.host, PGPORT = "5432", PGDATABASE = local.database
    PGSSLMODE         = "verify-full", PGSSLROOTCERT = var.database.ssl_root_cert, PG_MAX = "1"
    API_ENV           = "production", DB_ACCESS_MODE = var.database.legacy_mode, AUTOMATION_MODE = "off"
    METRICS_NAMESPACE = local.namespace
  }
  app_environment = merge(local.db_environment, {
    PGUSER                  = "${local.database}_runtime"
    CONTENT_BUCKET          = aws_s3_bucket.test.id, PREMIUM_BUCKET = aws_s3_bucket.test.id
    PUBLISH_JOB_QUEUE_URL   = aws_sqs_queue.test.url
    AUTH_ISSUERS            = local.issuer, AUTH_CONSOLE_ISSUER = local.issuer
    AUTH_CONSOLE_CLIENT_IDS = aws_cognito_user_pool_client.console.id
    AUTH_AGENT_CLIENT_IDS   = "isolated-no-agent-client", AUTH_ALLOW_UNVERIFIED = "0"
    CORS_ORIGIN             = "http://localhost:5188"
  })
  environments = {
    core     = local.app_environment
    worker   = local.app_environment
    observer = merge(local.db_environment, { PGUSER = "${local.database}_observer" })
    collector = {
      API_BASE                  = aws_apigatewayv2_api.test.api_endpoint
      CDN_BASE                  = var.synthetic_targets.cdn_base, CONSOLE_BASE = var.synthetic_targets.console_base
      REMOTE_CONFIG_URL         = var.synthetic_targets.remote_config_url
      COGNITO_CONSOLE_ISSUER    = local.issuer, COGNITO_MOBILE_ISSUER = local.issuer
      CHECK_TIMEOUT_SECONDS     = "10", LOG_LEVEL = "info"
      CHECK_USER_AGENT          = "DeveloperCards-Console-S2/1.0"
      METRICS_NAMESPACE         = local.namespace
      OPS_SNAPSHOT_BUCKET       = aws_s3_bucket.test.id, OPS_SNAPSHOT_KEY = local.snapshot
      OPS_ALARM_NAMES           = jsonencode(local.alarm_names)
      OPS_OBSERVER_FUNCTION_ARN = "arn:aws:lambda:${local.region}:${local.account}:function:${local.name}-observer:test"
    }
  }
}
resource "terraform_data" "prerequisites" {
  lifecycle {
    precondition {
      condition     = alltrue([var.prerequisites.independent_review, var.prerequisites.db_owner_channel, var.prerequisites.s3_endpoint, var.prerequisites.sqs_endpoint, var.prerequisites.artifact_hashes_bound, var.prerequisites.cleanup_registered])
      error_message = "Foundation blocked until independent review, owner channel, network/artifact evidence and cleanup registration are complete."
    }
    precondition {
      condition     = !var.runtime_deployed || alltrue(values(var.prerequisites))
      error_message = "Runtime bindings require all DB ACL, migration and EXPLAIN evidence. Ordinary owner-SDK deployment must enforce runtime_ready before credentials/aliases. S2 setup helper alone may precede this gate."
    }
    precondition {
      condition     = length(var.subnet_ids) > 0 && can(timecmp(var.expires_at, timestamp()))
      error_message = "Existing private subnets and UTC expiry required."
    }
  }
}
resource "aws_s3_bucket" "test" {
  bucket        = local.name
  force_destroy = false
  depends_on    = [terraform_data.prerequisites]
}
resource "aws_s3_bucket_public_access_block" "test" {
  bucket                  = aws_s3_bucket.test.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "test" {
  bucket = aws_s3_bucket.test.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
resource "aws_sqs_queue" "dlq" {
  name                      = "${local.name}-dlq"
  message_retention_seconds = 86400
  sqs_managed_sse_enabled   = true
  depends_on                = [terraform_data.prerequisites]
}
resource "aws_sqs_queue" "test" {
  name                       = local.name
  visibility_timeout_seconds = 3700
  message_retention_seconds  = 86400
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 3 })
}
resource "aws_security_group" "test" {
  name        = local.name
  description = "Isolated S2 DB and existing endpoints only"
  vpc_id      = var.vpc_id
  depends_on  = [terraform_data.prerequisites]
}
resource "aws_vpc_security_group_egress_rule" "database" {
  security_group_id            = aws_security_group.test.id
  referenced_security_group_id = var.rds_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = var.rds_security_group_id
  referenced_security_group_id = aws_security_group.test.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  tags                         = local.tags
}
resource "aws_vpc_security_group_egress_rule" "sqs" {
  security_group_id            = aws_security_group.test.id
  referenced_security_group_id = var.sqs_endpoint_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}
resource "aws_vpc_security_group_ingress_rule" "sqs" {
  security_group_id            = var.sqs_endpoint_security_group_id
  referenced_security_group_id = aws_security_group.test.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  tags                         = local.tags
}
resource "aws_vpc_security_group_egress_rule" "s3" {
  security_group_id = aws_security_group.test.id
  prefix_list_id    = var.s3_prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
resource "aws_cognito_user_pool" "test" {
  name                = local.name
  deletion_protection = "INACTIVE"
  admin_create_user_config { allow_admin_create_user_only = true }
  password_policy { minimum_length = 16 }
  depends_on = [terraform_data.prerequisites]
}
resource "aws_cognito_user_pool_domain" "test" {
  domain       = local.name
  user_pool_id = aws_cognito_user_pool.test.id
}
resource "aws_cognito_user_group" "test" {
  for_each     = toset(["super_admin", "editor"])
  name         = each.value
  user_pool_id = aws_cognito_user_pool.test.id
}
resource "aws_cognito_user_pool_client" "console" {
  name                                 = "${local.name}-console"
  user_pool_id                         = aws_cognito_user_pool.test.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["http://localhost:5188/auth/callback"]
  logout_urls                          = ["http://localhost:5188/login"]
  access_token_validity                = 5
  id_token_validity                    = 5
  refresh_token_validity               = 60
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "minutes"
  }
  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
}
resource "aws_cognito_user_pool_client" "app" {
  name                   = "${local.name}-app"
  user_pool_id           = aws_cognito_user_pool.test.id
  generate_secret        = false
  access_token_validity  = 5
  id_token_validity      = 5
  refresh_token_validity = 60
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "minutes"
  }
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
}
resource "aws_cloudwatch_log_group" "test" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 3
  depends_on        = [terraform_data.prerequisites]
}
resource "aws_iam_role" "test" {
  for_each           = local.functions
  name               = "${local.name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  depends_on         = [terraform_data.prerequisites]
}
# Function/alias create/config/publish are root SDK operations. No Terraform
# managed Lambda function/alias: refresh would persist secret environment values.
resource "aws_lambda_event_source_mapping" "test" {
  count                   = var.runtime_deployed ? 1 : 0
  event_source_arn        = aws_sqs_queue.test.arn
  function_name           = local.aliases["worker"]
  enabled                 = false
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = 2 }
}
resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-schedule"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = local.account }, ArnEquals = { "aws:SourceArn" = "arn:aws:scheduler:${local.region}:${local.account}:schedule-group/default" } } }] })
  depends_on         = [terraform_data.prerequisites]
}
resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-isolated-collector"
  role   = aws_iam_role.scheduler.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = [local.aliases["collector"]] }] })
}
resource "aws_scheduler_schedule" "test" {
  name                = local.name
  state               = "DISABLED"
  schedule_expression = "rate(15 minutes)"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = local.aliases["collector"]
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "synthetic-check" })
    retry_policy { maximum_retry_attempts = 0 }
  }
}
resource "aws_lambda_function_event_invoke_config" "collector" {
  count                        = var.runtime_deployed ? 1 : 0
  function_name                = "${local.name}-collector"
  qualifier                    = "test"
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 900
}
output "resolved" {
  value = {
    runId           = var.run_id, namespace = local.namespace, tags = local.tags
    database        = local.database, bucket = aws_s3_bucket.test.id, queue = aws_sqs_queue.test.url
    queueArn        = aws_sqs_queue.test.arn, dlqArn = aws_sqs_queue.dlq.arn
    mappingId       = try(aws_lambda_event_source_mapping.test[0].uuid, null)
    api             = aws_apigatewayv2_api.test.api_endpoint
    poolId          = aws_cognito_user_pool.test.id, issuer = local.issuer
    consoleClientId = aws_cognito_user_pool_client.console.id, appClientId = aws_cognito_user_pool_client.app.id
    domain          = "https://${aws_cognito_user_pool_domain.test.domain}.auth.${local.region}.amazoncognito.com"
    aliases         = local.aliases
    alarmNames      = local.alarm_names
  }
}

output "sdk_deployment_contract" {
  value = { for key, spec in local.functions : key => {
    function_name      = "${local.name}-${key}"
    alias_arn          = local.aliases[key]
    role_arn           = aws_iam_role.test[key].arn
    public_environment = local.environments[key]
    runtime            = spec.runtime, handler = spec.handler
    memory_size        = spec.memory, timeout = spec.timeout, concurrency = spec.concurrency
    artifact           = var.artifacts[key]
    private_subnet_ids = key == "collector" ? [] : var.subnet_ids
    security_group_ids = key == "collector" ? [] : [aws_security_group.test.id]
    log_group          = aws_cloudwatch_log_group.test[key].name
  } }
}

output "runtime_ready" {
  value = alltrue(values(var.prerequisites))
}
