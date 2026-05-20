variable "aws_region" {
  type        = string
  description = "AWS region. Paris by default."
  default     = "eu-west-3"
}

variable "project_name" {
  type        = string
  description = "Used as prefix for every resource name."
  default     = "casino"
}

variable "environment" {
  type    = string
  default = "dev"
}

# --- EC2 -----------------------------------------------------------------

variable "instance_type" {
  type        = string
  description = "EC2 type. t4g.small is free until 2026-12-31 via the T4g Free Trial (750h/month)."
  default     = "t4g.small"
}

variable "ebs_size_gb" {
  type        = number
  description = "Root EBS volume size in GB. 30 GB is within Free Tier."
  default     = 30
}

variable "ssh_key_name" {
  type        = string
  description = <<-EOT
    Name of an existing EC2 key pair in this region. Create it first in the AWS
    console (EC2 → Key Pairs). Leave empty to skip SSH provisioning (you'd need
    SSM Session Manager to connect, not configured here).
  EOT
  default     = ""
}

variable "admin_cidr" {
  type        = string
  description = <<-EOT
    CIDR allowed to SSH to the EC2. Set to your public IP/32 (e.g. "1.2.3.4/32").
    Get it with: curl ifconfig.me
  EOT
  default     = "0.0.0.0/0"
}

# --- RDS -----------------------------------------------------------------

variable "rds_instance_class" {
  type        = string
  description = "RDS class. db.t3.micro is Free Tier eligible for 12 months on new accounts."
  default     = "db.t3.micro"
}

variable "rds_allocated_storage" {
  type        = number
  description = "RDS storage in GB. 20 GB is within Free Tier."
  default     = 20
}

# --- Secrets (never committed) ------------------------------------------

variable "pg_password" {
  type        = string
  sensitive   = true
  description = "Postgres master password. Generate with: openssl rand -base64 32"
}

variable "jwt_secret" {
  type        = string
  sensitive   = true
  description = "Secret used to sign JWT tokens. Generate with: openssl rand -base64 48"
}

variable "admin_api_key" {
  type        = string
  sensitive   = true
  description = "Admin API key for backoffice → microservices auth. Generate with: openssl rand -base64 32"
}

# --- Budget alerting ----------------------------------------------------

variable "monthly_budget_usd" {
  type        = string
  description = "Monthly cost budget in USD. Alerts trigger at 50%, 80%, and 100% (forecasted)."
  default     = "30"
}

variable "budget_alert_email" {
  type        = string
  description = "Email address that receives budget alerts."
}
