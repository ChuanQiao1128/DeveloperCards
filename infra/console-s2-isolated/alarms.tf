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
  depends_on          = [terraform_data.prerequisites]
  alarm_name          = "${local.name}-sync-http-errors"
  alarm_description   = "Returned sync HTTP 5xx in 5 minutes; operational detector, not a new SLO."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.sns_topic_arn]
  ok_actions          = [var.sns_topic_arn]
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
        namespace   = local.namespace
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
  depends_on          = [terraform_data.prerequisites]
  alarm_name          = "${local.name}-publish-stalled"
  alarm_description   = "Bounded observer found durable publishing backlog; missing is unknown, not healthy."
  namespace           = local.namespace
  metric_name         = "PublishStalled"
  dimensions          = { Service = "operations-observer" }
  statistic           = "Maximum"
  period              = 900
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "missing"
  actions_enabled     = false
  alarm_actions       = [var.sns_topic_arn]
  ok_actions          = [var.sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "console_s2_observer_unavailable" {
  depends_on          = [terraform_data.prerequisites]
  alarm_name          = "${local.name}-operations-observer-unavailable"
  alarm_description   = "Observer or collector missing/unavailable for two 15 minute periods."
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "breaching"
  actions_enabled     = false
  alarm_actions       = [var.sns_topic_arn]
  ok_actions          = [var.sns_topic_arn]
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
        namespace   = local.namespace
        metric_name = metric_query.value.name
        dimensions  = { Service = metric_query.value.service }
        stat        = "Maximum"
        period      = 900
      }
    }
  }
}


locals {
  alarm_names = [for suffix in ["core-vpc-errors", "worker-errors", "synthetic-check-failing", "sqs-oldest-age", "dlq-nonempty", "sync-http-errors", "publish-stalled", "operations-observer-unavailable"] : "${local.name}-${suffix}"]
  basic_alarms = {
    core      = { suffix = "core-vpc-errors", namespace = "AWS/Lambda", metric = "Errors", statistic = "Sum", period = 300, threshold = 1, comparison = "GreaterThanOrEqualToThreshold", periods = 1, missing = "notBreaching", dimensions = { FunctionName = "${local.name}-core" }, actions = false }
    worker    = { suffix = "worker-errors", namespace = "AWS/Lambda", metric = "Errors", statistic = "Sum", period = 300, threshold = 1, comparison = "GreaterThanOrEqualToThreshold", periods = 1, missing = "notBreaching", dimensions = { FunctionName = "${local.name}-worker" }, actions = false }
    synthetic = { suffix = "synthetic-check-failing", namespace = local.namespace, metric = "SyntheticCheckSuccess", statistic = "Maximum", period = 900, threshold = 1, comparison = "LessThanThreshold", periods = 2, missing = "breaching", dimensions = { Service = "synthetic-check" }, actions = false }
    queue     = { suffix = "sqs-oldest-age", namespace = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", statistic = "Maximum", period = 300, threshold = 900, comparison = "GreaterThanThreshold", periods = 1, missing = "notBreaching", dimensions = { QueueName = local.name }, actions = true }
    dlq       = { suffix = "dlq-nonempty", namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", statistic = "Maximum", period = 300, threshold = 0, comparison = "GreaterThanThreshold", periods = 1, missing = "notBreaching", dimensions = { QueueName = "${local.name}-dlq" }, actions = false }
  }
}
resource "aws_cloudwatch_metric_alarm" "basic" {
  for_each            = local.basic_alarms
  alarm_name          = "${local.name}-${each.value.suffix}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  period              = each.value.period
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  evaluation_periods  = each.value.periods
  datapoints_to_alarm = each.value.periods
  treat_missing_data  = each.value.missing
  dimensions          = each.value.dimensions
  actions_enabled     = each.value.actions
  alarm_actions       = [var.sns_topic_arn]
  ok_actions          = [var.sns_topic_arn]
  depends_on          = [terraform_data.prerequisites]
}
