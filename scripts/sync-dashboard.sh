#!/usr/bin/env bash
# Syncs dashboard/ to avinasha18/repath-dashboard after every push.
# Run this from the repo root: ./scripts/sync-dashboard.sh
set -euo pipefail

PERSONAL_REPO="https://github.com/avinasha18/repath-dashboard.git"
BRANCH="dashboard-deploy"

echo "Syncing dashboard/ → avinasha18/repath-dashboard..."

# Clean up any previous branch
git branch -D "$BRANCH" 2>/dev/null || true

# Split the dashboard/ subtree into a standalone branch
git subtree split --prefix=dashboard -b "$BRANCH"

# Push to personal repo (will prompt for credentials if needed)
git push --force "$PERSONAL_REPO" "$BRANCH:main"

# Clean up the temporary branch
git branch -D "$BRANCH"

echo "✅ Dashboard synced to https://github.com/avinasha18/repath-dashboard"
