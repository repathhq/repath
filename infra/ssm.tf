# Secrets consumed by the app containers on EC2. The deploy script fetches
# these by path at deploy time and writes them into a local .env file — they
# are never baked into the Docker images or committed to git.

resource "random_password" "api_token" {
  length  = 64
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

locals {
  ssm_prefix = "/${var.project_name}/prod"
  ssm_values = {
    "REPATH_API_TOKEN"     = random_password.api_token.result
    "JWT_SECRET"           = random_password.jwt_secret.result
    "OPENAI_API_KEY"       = var.openai_api_key
    "REPATH_DATABASE_URL"  = "postgresql://repath:${random_password.db.result}@${aws_db_instance.postgres.endpoint}/repath?sslmode=require"
    "REPATH_REDIS_URL"     = "redis://redis:6379"
    "RAZORPAY_KEY_ID"      = var.razorpay_key_id
    "RAZORPAY_KEY_SECRET"  = var.razorpay_key_secret
    "RAZORPAY_LIVE_KEY"    = var.razorpay_live_key
    "RAZORPAY_LIVE_SECRET" = var.razorpay_live_secret
  }
}

resource "aws_ssm_parameter" "app" {
  for_each = local.ssm_values

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "SecureString"
  value = each.value
}
