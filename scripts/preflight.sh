#!/usr/bin/env bash
# Run everything CI runs, locally, before pushing.
#
# # Why this exists
#
# Five consecutive deploys failed on things that passed locally, each time
# because "it builds on my machine" was checking something adjacent to what CI
# checks:
#
#   * cargo build succeeded while `cargo fmt --check` had not been re-run after
#     a late edit;
#   * clippy passed under `--features repath-gateway/test-support` while CI uses
#     `--all-features`;
#   * the multi-stage `Dockerfile` built while CI builds Dockerfile.gateway,
#     Dockerfile.controller and Dockerfile.evaluator;
#   * `cargo build` used the local toolchain (1.96) while the Dockerfiles pinned
#     1.88, which the AWS SDK's MSRV rejects.
#
# Each failure skipped the deploy job, so fixes sat on main unshipped while
# appearing green in tests. The commands below are copied from
# .github/workflows/ci.yml — if that file changes, change this with it.
#
# Usage:  ./scripts/preflight.sh            # everything
#         ./scripts/preflight.sh --no-docker # skip image builds (slow)

set -uo pipefail

DOCKER=1
[[ "${1:-}" == "--no-docker" ]] && DOCKER=0

FAILED=()
step() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m   PASS\033[0m — %s\n' "$name"
  else
    printf '\033[31m   FAIL\033[0m — %s\n' "$name"
    FAILED+=("$name")
  fi
}

# ── Rust Check ───────────────────────────────────────────────────────────────
step "cargo fmt --check"  cargo fmt --all -- --check
step "clippy (all-features, deny warnings)" \
     cargo clippy --all-targets --all-features -- -D warnings
step "cargo check (all-features)" \
     cargo check --all-targets --all-features

# ── Rust Test ────────────────────────────────────────────────────────────────
# DATABASE_URL-dependent suites skip themselves when it is unset, so this is
# still worth running without a database — it just covers less.
if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '\n\033[33m   note: DATABASE_URL unset — integration suites will skip\033[0m\n'
fi
step "cargo test (all, test-support)" \
     cargo test --all --features repath-gateway/test-support -- --test-threads=4

# ── Dashboard Check ──────────────────────────────────────────────────────────
step "dashboard type-check" bash -c 'cd dashboard && npx tsc --noEmit'
step "dashboard build"      bash -c 'cd dashboard && npm run build >/dev/null'

# ── Docker Build ─────────────────────────────────────────────────────────────
# These are the files CI builds. Building the root `Dockerfile` instead is the
# mistake that let a bad Rust pin through twice.
if [[ $DOCKER -eq 1 ]]; then
  for svc in gateway controller evaluator; do
    step "docker build -f Dockerfile.$svc" \
         docker build -q -f "Dockerfile.$svc" -t "repath-preflight-$svc" .
  done
else
  printf '\n\033[33m   skipping docker builds (--no-docker)\033[0m\n'
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
printf '\n'
if [[ ${#FAILED[@]} -eq 0 ]]; then
  printf '\033[32m\033[1mAll checks passed — safe to push.\033[0m\n'
  exit 0
fi
printf '\033[31m\033[1m%d check(s) failed:\033[0m\n' "${#FAILED[@]}"
printf '  - %s\n' "${FAILED[@]}"
printf '\nFix these before pushing; CI will fail on them and skip the deploy.\n'
exit 1
