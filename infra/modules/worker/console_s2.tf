# Artifact/config supplied explicitly after DB grants, EXPLAIN and independent review.
variable "console_s2_observer" {
  type = object({
    role_arn            = string
    artifact_path       = string
    artifact_sha256_b64 = string
    subnet_ids          = list(string)
    security_group_ids  = list(string)
  })
  default = null
}

variable "console_s2_observer_environment" {
  type        = map(string)
  default     = {}
  description = "Public create-time PG/TLS config only. Root injects password in memory outside Terraform, publishes final version and moves alias."
  validation {
    condition     = alltrue([for key in keys(var.console_s2_observer_environment) : contains(["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSSLMODE", "PGSSLROOTCERT", "PG_MAX", "PG_CONNECTION_TIMEOUT", "PG_IDLE_TIMEOUT", "API_ENV", "METRICS_NAMESPACE"], key)])
    error_message = "Only public observer PG/TLS keys permitted; credentials/tokens never enter Terraform state."
  }
}

resource "aws_cloudwatch_log_group" "console_s2_observer" {
  count             = var.console_s2_observer == null ? 0 : 1
  name              = "/aws/lambda/developercards-operations-observer"
  retention_in_days = 30
  tags              = var.tags
}

# Lambda API deployments are owner-SDK only. Terraform refresh of a managed
# function reads its full environment even with ignore_changes; that would leak
# SDK-injected PGPASSWORD into state. Never import these functions/aliases here.
output "console_s2_observer_alias_arn" {
  value = var.console_s2_observer == null ? null : "arn:aws:lambda:ap-southeast-2:622994489535:function:developercards-operations-observer:prod"
}

output "console_s2_observer_deployment_contract" {
  value = var.console_s2_observer == null ? null : {
    function_name        = "developercards-operations-observer"
    alias                = "prod"
    role_arn             = var.console_s2_observer.role_arn
    artifact_path        = var.console_s2_observer.artifact_path
    artifact_sha256_b64  = var.console_s2_observer.artifact_sha256_b64
    handler              = "RecallSmith.Lambda.OperationsObserver::RecallSmith.Lambda.OperationsObserver.Function::Handler"
    runtime              = "dotnet10"
    architectures        = ["arm64"]
    memory_size          = 256
    timeout              = 8
    reserved_concurrency = 1
    subnet_ids           = var.console_s2_observer.subnet_ids
    security_group_ids   = var.console_s2_observer.security_group_ids
    public_environment   = var.console_s2_observer_environment
    log_group            = aws_cloudwatch_log_group.console_s2_observer[0].name
    prerequisite         = "Root must verify DB ACL/EXPLAIN/artifact hashes, inject dedicated credential in memory, publish final numeric version and verify alias target."
  }
}
