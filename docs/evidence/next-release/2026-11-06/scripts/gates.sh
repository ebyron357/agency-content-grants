#!/usr/bin/env bash
# Runs the CI "validate" job steps (.github/workflows/ci.yml) on the combined tree, plus the audit.
# Usage: gates.sh <repo-dir> <out-dir>. Each step's output goes to <out-dir>/NN-name.txt; a summary to <out-dir>/summary.txt.
set -uo pipefail
REPO="$1"; OUT="$2"; mkdir -p "$OUT"; cd "$REPO"
export NODE_ENV=test ALLOW_TEST_DATABASE_RESET=true
export DATABASE_URL=postgresql://content_machine_test:content_machine_test@localhost:5434/content_machine_test
export MIGRATIONS_DIR="$REPO/lib/db/drizzle"
export SESSION_SECRET=test-session-secret-not-for-production
export ADMIN_PASSWORD=test-admin-password-not-for-production
export TEST_ADMIN_PASSWORD=test-admin-password-not-for-production
export PORT=8080
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
: > "$OUT/summary.txt"
step() { local n="$1"; shift; local start=$(date +%s); "$@" > "$OUT/$n.txt" 2>&1; local rc=$?; echo "$n exit=$rc $(( $(date +%s)-start ))s" | tee -a "$OUT/summary.txt"; return $rc; }
step 02-format-check pnpm run format:check
step 03-typecheck pnpm run typecheck
step 04-api-unit pnpm --filter @workspace/api-server test:unit
step 05-db-prepare pnpm --filter @workspace/api-server test:db:prepare
step 06-api-tests pnpm --filter @workspace/api-server test
step 07-content-os-tests pnpm --filter @workspace/content-os test
step 08-build-api pnpm --filter @workspace/api-server build
step 09-build-frontend pnpm --filter @workspace/content-os build
pnpm --filter @workspace/api-server start > "$OUT/10-api-server.log" 2>&1 &
API_PID=$!
ok=0; for i in $(seq 1 30); do curl --fail --silent http://localhost:8080/api/healthz >/dev/null && ok=1 && break; sleep 1; done
echo "10-start-api ok=$ok" | tee -a "$OUT/summary.txt"
step 11-integration bash tests/integration-tests.sh
step 12-a11y pnpm --filter @workspace/content-os test:a11y
kill "$API_PID" 2>/dev/null; P=$(ss -ltnpH 'sport = :8080' | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1); [[ -n "$P" ]] && kill "$P"; sleep 2
step 13-production-build pnpm run build
step 14-audit pnpm audit --audit-level=high
echo DONE | tee -a "$OUT/summary.txt"
