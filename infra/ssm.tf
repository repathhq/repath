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
    "RAZORPAY_LIVE_SECRET"    = var.razorpay_live_secret
    "RAZORPAY_WEBHOOK_SECRET" = var.razorpay_webhook_secret
  }
}

# Which secrets are actually configured.
#
# Empty values are skipped rather than written: SSM rejects a zero-length
# SecureString outright, and a parameter that exists but is blank is worse than
# one that is absent — code reading it cannot tell "not configured yet" from
# "configured to nothing". Anything genuinely optional, such as the Razorpay
# webhook secret before a webhook exists, simply has no parameter.
#
# `nonsensitive` is applied only to the emptiness *test*, which yields a
# boolean. The values themselves stay sensitive and are read back out of
# `local.ssm_values` below, so nothing secret ever becomes a resource key.
locals {
  ssm_configured_keys = toset([
    for k, v in local.ssm_values : k if nonsensitive(v) != ""
  ])
}

resource "aws_ssm_parameter" "app" {
  for_each = local.ssm_configured_keys

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "SecureString"
  value = local.ssm_values[each.key]
}
