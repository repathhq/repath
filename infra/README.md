# Repath AWS infra

Terraform for the production stack in `ap-south-1`:

- **EC2** (`t3.micro`) runs gateway + controller + evaluator + redis via
  `docker-compose.prod.yml`, fronted by Caddy for automatic HTTPS
  (`api.tryrepath.com`). No SSH — access via `aws ssm start-session --target <id>`.
- **RDS** (`db.t3.micro` Postgres 16) — private, only reachable from the EC2 host.
- **ECR** — one repo per service (`repath/gateway`, `repath/controller`, `repath/evaluator`).
- **Amplify** — hosts the Next.js dashboard at `tryrepath.com`.
- **SSM Parameter Store** (`/repath/prod/*`, SecureString) — all app secrets.
- **IAM OIDC role** for GitHub Actions — no long-lived AWS keys stored in GitHub.

## Usage

```bash
cd infra
AWS_PROFILE=repath terraform init
AWS_PROFILE=repath terraform plan   # review before applying
AWS_PROFILE=repath terraform apply
```

Sensitive inputs (`openai_api_key`, `razorpay_*`) come from `terraform.tfvars`,
which is gitignored and never committed — see `terraform.tfvars.example` for
the shape, or pass them as `TF_VAR_*` env vars instead.

State is local (`terraform.tfstate`, gitignored). For a team of more than one
person touching infra, move this to an S3 backend with state locking before
relying on it further.

## Rotating a secret

```bash
aws ssm put-parameter --name /repath/prod/OPENAI_API_KEY --type SecureString --value '<new-value>' --overwrite
```
Then redeploy (push to `main`, or run `scripts/deploy-aws.sh` on the host) so
the containers pick up the new value.
