terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.67.0" }
  }
}
provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = ["622994489535"]
  default_tags { tags = local.tags }
}
