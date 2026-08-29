variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Short name used as a prefix for tagging and naming resources"
  type        = string
  default     = "repath"
}

variable "domain_name" {
  description = "Root domain (bought on Namecheap) that the dashboard and API live under"
  type        = string
  default     = "tryrepath.com"
}

variable "github_repo" {
  description = "GitHub repo (org/name) allowed to assume the CI role via OIDC and trigger Amplify builds"
  type        = string
  default     = "repathhq/repath"
}

variable "instance_type" {
  description = "EC2 instance size running gateway+controller+evaluator+redis"
  type        = string
  default     = "t3.micro"
}

variable "db_instance_class" {
  description = "RDS instance size"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB"
  type        = number
  default     = 20
}

# ── Secrets — passed at apply time via TF_VAR_* env vars, never committed ────

variable "openai_api_key" {
  description = "OpenAI API key used by the evaluator (judge model)"
  type        = string
  sensitive   = true
}

variable "razorpay_key_id" {
  description = "Razorpay test key id"
  type        = string
  sensitive   = true
  default     = ""
}

variable "razorpay_key_secret" {
  description = "Razorpay test key secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "razorpay_live_key" {
  description = "Razorpay live key id"
  type        = string
  sensitive   = true
  default     = ""
}

variable "razorpay_live_secret" {
  description = "Razorpay live key secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "repath_test_coupon" {
  description = <<-DESC
    Internal testing coupon code. Charges a flat INR 1 for any plan, so it must
    never be published — a previous version hardcoded the code into
    dashboard/app/api/billing/.../create-order/route.ts, which put a working
    discount for the INR 12,499 plan into a public repository. Leave empty to
    disable coupons entirely; the route fails closed when this is unset.
    Set it in terraform.tfvars (gitignored), never here.
  DESC
  type        = string
  sensitive   = true
  default     = ""
}
