#!/usr/bin/env bash
# Runs ON the EC2 host (triggered remotely via `aws ssm send-command` from
# GitHub Actions, or manually via SSM Session Manager for a manual redeploy).
#
# Pulls docker-compose.prod.yml from the repo, builds a .env file from AWS
# SSM Parameter Store, logs in to ECR, and brings the stack up.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_DIR="/opt/repath"
REPO_RAW="https://raw.githubusercontent.com/repathhq/repath/main"

mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "Fetching docker-compose.prod.yml..."
curl -fsSL "$REPO_RAW/docker-compose.prod.yml" -o docker-compose.prod.yml

echo "Building .env from SSM Parameter Store..."
{
  echo "ECR_REGISTRY=${ECR_REGISTRY}"
  echo "IMAGE_TAG=${IMAGE_TAG}"
  echo "REPATH_CLOUD_DOMAIN=api.tryrepath.com"
  aws ssm get-parameters-by-path \
    --path "/repath/prod" \
    --with-decryption \
    --query "Parameters[*].[Name,Value]" \
    --output text \
    --region "$REGION" \
  | while IFS=$'\t' read -r name value; do
      key="${name##*/}"
      printf '%s=%s\n' "$key" "$value"
    done
} > .env

echo "Logging in to ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "Pulling images and starting stack..."
docker compose --env-file .env -f docker-compose.prod.yml pull
docker compose --env-file .env -f docker-compose.prod.yml up -d

echo "Pruning old images..."
docker image prune -af --filter "until=72h" || true

echo "Deploy complete."
