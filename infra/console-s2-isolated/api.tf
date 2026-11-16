locals {
  routes = {
    "ANY /api/v1/admin/{proxy+}"         = "console"
    "ANY /api/v1/authoring/{proxy+}"     = "console"
    "GET /api/v1/authoring/publish/jobs" = "console"
    "ANY /api/v1/sync/{proxy+}"          = "app"
    "ANY /api/v1/draw-state/{proxy+}"    = "app"
    "ANY /api/v1/user/{proxy+}"          = "app"
    "GET /api/v1/me"                     = "app"
    "GET /health"                        = "none"
    "OPTIONS /{proxy+}"                  = "none"
    "OPTIONS /api/v1/admin/{proxy+}"     = "none"
    "OPTIONS /api/v1/authoring/{proxy+}" = "none"
  }
}
resource "aws_apigatewayv2_api" "test" {
  name          = local.name
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins     = ["http://localhost:5188"]
    allow_credentials = false
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers     = ["accept", "authorization", "content-type"]
    max_age           = 600
  }
  depends_on = [terraform_data.prerequisites]
}
resource "aws_apigatewayv2_authorizer" "test" {
  for_each         = { console = aws_cognito_user_pool_client.console.id, app = aws_cognito_user_pool_client.app.id }
  api_id           = aws_apigatewayv2_api.test.id
  name             = each.key
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    issuer   = local.issuer
    audience = [each.value]
  }
}
resource "aws_apigatewayv2_integration" "test" {
  api_id                 = aws_apigatewayv2_api.test.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = local.aliases["core"]
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}
resource "aws_apigatewayv2_route" "test" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.test.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.test.id}"
  authorization_type = each.value == "none" ? "NONE" : "JWT"
  authorizer_id      = each.value == "none" ? null : aws_apigatewayv2_authorizer.test[each.value].id
}
resource "aws_apigatewayv2_stage" "test" {
  api_id      = aws_apigatewayv2_api.test.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit   = 10
    throttling_rate_limit    = 5
    detailed_metrics_enabled = true
  }
}
resource "aws_lambda_permission" "api" {
  count          = var.runtime_deployed ? 1 : 0
  statement_id   = "isolated-api-only"
  action         = "lambda:InvokeFunction"
  function_name  = "${local.name}-core"
  qualifier      = "test"
  principal      = "apigateway.amazonaws.com"
  source_account = local.account
  source_arn     = "${aws_apigatewayv2_api.test.execution_arn}/*/*"
}
