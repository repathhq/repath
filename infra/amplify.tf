# Amplify app is created here without a `repository` block — connecting the
# GitHub repo requires an interactive OAuth authorization that only an org
# owner can grant, so that one click happens in the Amplify console (see the
# final setup checklist). Everything else (build settings, domain, env vars)
# is managed here.

resource "aws_amplify_app" "dashboard" {
  name     = "${var.project_name}-dashboard"
  platform = "WEB_COMPUTE" # SSR/middleware support for Next.js

  # The GitHub connection, its SSR logging role, and the default SPA redirect
  # rule are all set by the console's own connect-repo flow (see the note
  # above — that flow is the only one that can attach a repository at all).
  # Terraform doesn't try to assert values for them; doing so would force a
  # destroy/recreate that strips the very thing the console flow just set up.
  lifecycle {
    ignore_changes = [
      repository,
      iam_service_role_arn,
      custom_rule,
      cache_config,
      tags,
    ]
  }

  # Amplify's console/Terraform-configured environment_variables are only
  # ever exposed during the build phase — by design, not a bug, per
  # https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html.
  # They never reach the deployed SSR compute function's process.env at
  # request time, for any app on this platform. The documented workaround is
  # to write the runtime-needed ones into .env.production during preBuild:
  # Next.js's standalone server (what WEB_COMPUTE actually deploys) loads
  # that file into process.env on every cold start, which is what actually
  # gets them to the route handlers.
  build_spec = <<-YAML
    version: 1
    applications:
      - appRoot: dashboard
        frontend:
          phases:
            preBuild:
              commands:
                - npm ci
                - env | grep -e REPATH_API_TOKEN -e JWT_SECRET -e RAZORPAY_KEY_ID -e RAZORPAY_KEY_SECRET -e REPATH_TEST_COUPON >> .env.production
            build:
              commands:
                - npm run build
          artifacts:
            baseDirectory: .next
            files:
              - '**/*'
          cache:
            paths:
              - node_modules/**/*
  YAML

  environment_variables = {
    NEXT_PUBLIC_API_URL       = "https://api.${var.domain_name}"
    NEXT_PUBLIC_GATEWAY_URL   = "https://api.${var.domain_name}"
    NEXT_PUBLIC_APP_URL       = "https://${var.domain_name}"
    REPATH_API_TOKEN          = random_password.api_token.result
    JWT_SECRET                = random_password.jwt_secret.result
    # Billing runs in the dashboard's own server routes, not on EC2, so these
    # have to reach Amplify. They were only ever written to SSM, which the
    # dashboard cannot read — create-order returned 503 "Razorpay not
    # configured" for every checkout, so no customer could pay at all.
    # Live credentials, deliberately. The test key pair stored here was
    # revoked upstream and returns 401 from Razorpay directly, so test mode is
    # simply not available. The internal REPATH_TEST_COUPON exists to exercise
    # this real payment path for ₹1 rather than a full plan price.
    RAZORPAY_KEY_ID           = var.razorpay_live_key
    RAZORPAY_KEY_SECRET       = var.razorpay_live_secret
    REPATH_TEST_COUPON        = var.repath_test_coupon
    AMPLIFY_MONOREPO_APP_ROOT = "dashboard"
    AMPLIFY_DIFF_DEPLOY       = "false"
  }

  auto_branch_creation_config {
    enable_auto_build = false
  }
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.dashboard.id
  branch_name = "main"
  stage       = "PRODUCTION"

  enable_auto_build = true
}

resource "aws_amplify_domain_association" "dashboard" {
  app_id      = aws_amplify_app.dashboard.id
  domain_name = var.domain_name

  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = ""
  }

  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = "www"
  }

  wait_for_verification = false
}
