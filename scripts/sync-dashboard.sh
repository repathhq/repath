#!/usr/bin/env bash
# Syncs dashboard/ to avinasha18/repath-dashboard.
# Run from repo root: ./scripts/sync-dashboard.sh
set -euo pipefail

PERSONAL_REPO="https://github.com/avinasha18/repath-dashboard.git"
BRANCH="dashboard-deploy"
PERSONAL_EMAIL="tejassriavinasha@gmail.com"
PERSONAL_NAME="Avinash"

echo "Syncing dashboard/ → avinasha18/repath-dashboard..."

# Clean up any previous branch
git branch -D "$BRANCH" 2>/dev/null || true

# Split the dashboard/ subtree into a standalone branch
git subtree split --prefix=dashboard -b "$BRANCH"

# Clone the split branch into a temp dir
TMPDIR=$(mktemp -d)
git clone --local --branch "$BRANCH" . "$TMPDIR" --quiet
cd "$TMPDIR"

# Rewrite author to match avinasha18's GitHub account
git config user.email "$PERSONAL_EMAIL"
git config user.name "$PERSONAL_NAME"

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --env-filter "
  export GIT_AUTHOR_EMAIL='$PERSONAL_EMAIL'
  export GIT_AUTHOR_NAME='$PERSONAL_NAME'
  export GIT_COMMITTER_EMAIL='$PERSONAL_EMAIL'
  export GIT_COMMITTER_NAME='$PERSONAL_NAME'
" -- --all 2>/dev/null

# Push the current HEAD (it's the split branch, not named main locally)
git push --force "$PERSONAL_REPO" "HEAD:main"

# Cleanup
cd - > /dev/null
rm -rf "$TMPDIR"
git branch -D "$BRANCH"

echo "✅ Dashboard synced to https://github.com/avinasha18/repath-dashboard"
