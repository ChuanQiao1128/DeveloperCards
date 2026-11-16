# S2: additive operational detectors. Existing SLO formulas and sample guards stay intact.
variable "console_s2_enabled" {
  type    = bool
  default = false
}

locals {
  console_s2_sync_routes = [
    { route = "/api/v1/sync/progress/events", method = "POST" },
    { route = "/api/v1/sync/push", method = "POST" },
    { route = "/api/v1/sync/progress", method = "GET" },
    { route = "/api/v1/sync/pull", method = "GET" },
    { route = "/api/v1/draw-state/sync", method = "POST" },
  ]
}

resource "aws_cloudwatch_metric_alarm" "console_s2_sync_http_errors" {
  count               = var.console_s2_enabled ? 1 : 0
  alarm_name          = "developercards-${var.env}-sync-http-errors"
  alarm_description   = "Returned sync HTTP 5xx in 5 minutes; operational detector, not a new SLO."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  metric_query {
    id          = "errors"
    expression  = "SUM([${join(",", [for i in range(5) : "FILL(e${i},0)"])}])"
    label       = "Sync HTTP 5xx"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = { for i, route in local.console_s2_sync_routes : "e${i}" => route }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = "Errors"
        stat        = "Sum"
        period      = 300
        dimensions = {
          Service = "core-vpc"
          Route   = metric_query.value.route
          Method  = metric_query.value.method
        }
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "console_s2_publish_stalled" {
  count               = var.console_s2_enabled ? 1 : 0
  alarm_name          = "developercards-${var.env}-publish-stalled"
  alarm_description   = "Bounded observer found durable publishing backlog; missing is unknown, not healthy."
  namespace           = var.metrics_namespace
  metric_name         = "PublishStalled"
  dimensions          = { Service = "operations-observer" }
  statistic           = "Maximum"
  period              = 900
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "console_s2_observer_unavailable" {
  count               = var.console_s2_enabled ? 1 : 0
  alarm_name          = "developercards-${var.env}-operations-observer-unavailable"
  alarm_description   = "Observer or collector missing/unavailable for two 15 minute periods."
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  metric_query {
    id          = "available"
    expression  = "MIN([FILL(observer,0),FILL(invoke,0)])"
    return_data = true
  }
  dynamic "metric_query" {
    for_each = {
      observer = { name = "ObserverSuccess", service = "operations-observer" }
      invoke   = { name = "ObserverInvokeSuccess", service = "synthetic-check" }
    }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = var.metrics_namespace
        metric_name = metric_query.value.name
        dimensions  = { Service = metric_query.value.service }
        stat        = "Maximum"
        period      = 900
      }
    }
  }
}

output "console_s2_alarm_arns" {
  value = concat(
    aws_cloudwatch_metric_alarm.console_s2_sync_http_errors[*].arn,
    aws_cloudwatch_metric_alarm.console_s2_publish_stalled[*].arn,
    aws_cloudwatch_metric_alarm.console_s2_observer_unavailable[*].arn,
  )
}
