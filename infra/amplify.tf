# Amplify app is created here without a `repository` block — connecting the
# GitHub repo requires an interactive OAuth authorization that only an org
# owner can grant, so that one click happens in the Amplify console (see the
# final setup checklist). Everything else (build settings, domain, env vars)
# is managed here.

resource "aws_amplify_app" "dashboard" {
  name     = "${var.project_name}-dashboard"
  platform = "WEB_COMPUTE" # SSR/middleware support for Next.js

  build_spec = <<-YAML
    version: 1
    applications:
      - appRoot: dashboard
        frontend:
          phases:
            preBuild:
              commands:
                - npm ci
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
