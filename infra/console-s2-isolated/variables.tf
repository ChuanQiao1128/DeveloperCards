variable "run_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{8}t[0-9]{6}z-[a-f0-9]{8}$", var.run_id))
    error_message = "Use UTC timestamp plus random 8 hex; lowercase only."
  }
}
variable "expires_at" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "rds_security_group_id" { type = string }
variable "sqs_endpoint_security_group_id" { type = string }
variable "s3_prefix_list_id" { type = string }
variable "sns_topic_arn" { type = string }
variable "production_deny_arns" {
  type = list(string)
  validation {
    condition     = length(var.production_deny_arns) >= 4 && alltrue([for arn in var.production_deny_arns : startswith(arn, "arn:aws:") && !strcontains(arn, "?") && !endswith(arn, ":*")])
    error_message = "Freeze exact production bucket/object, queue, API and secret deny resources. No account-wide patterns."
  }
}
variable "prerequisites" {
  description = "Root's measured capabilities; every item blocks apply until actually verified."
  type = object({
    independent_review      = bool
    db_owner_channel        = bool
    production_acl_safe     = bool
    migrations_through_61   = bool
    isolated_roles_acl_safe = bool
    explain_bounded         = bool
    s3_endpoint             = bool
    sqs_endpoint            = bool
    artifact_hashes_bound   = bool
    cleanup_registered      = bool
  })
}
variable "artifacts" {
  type = map(object({ path = string, sha256_b64 = string }))
  validation {
    condition     = toset(keys(var.artifacts)) == toset(["core", "worker", "observer", "collector"])
    error_message = "Exactly four reviewed packages required."
  }
}
variable "database" {
  type = object({ host = string, ssl_root_cert = string, legacy_mode = string })
}
variable "synthetic_targets" {
  description = "All existing probes explicit. No production DEFAULTS. Private/unavailable probes remain failed/unknown."
  type        = object({ cdn_base = string, console_base = string, remote_config_url = string })
  validation {
    condition     = alltrue([for target in values(var.synthetic_targets) : startswith(target, "https://") && !strcontains(target, "developercards.app") && !strcontains(target, "recallsmith-mobile-config")])
    error_message = "Explicit isolated HTTPS targets required; production targets prohibited."
  }
}

variable "runtime_deployed" {
  type        = bool
  default     = false
  description = "Root verified exact SDK-deployed numeric versions/aliases. Enables only mapping/permission/invoke-config resources; no Lambda GetFunction refresh."
}
