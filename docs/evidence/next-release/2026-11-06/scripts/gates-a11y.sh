#!/usr/bin/env bash
# Re-runs the server-backed CI steps with FRONTEND_DIST_PATH outside the worktree's ".claude/" path
# (express/send ignores dot-directories in sendFile paths, so index.html 404s there; CI's checkout has no dot dir).
set -uo pipefail
REPO=/home/user/agency-content-grants/.claude/worktrees/agent-ad61e3777038d29d2
OUT=/tmp/claude-0/-home-user-agency-content-grants/e22c0b2c-46ea-5f5f-8bd2-a9d68e47f66f/scratchpad/gates
FE=/tmp/claude-0/-home-user-agency-content-grants/e22c0b2c-46ea-5f5f-8bd2-a9d68e47f66f/scratchpad/frontend-public
cd "$REPO"
export NODE_ENV=test ALLOW_TEST_DATABASE_RESET=true
export DATABASE_URL=postgresql://content_machine_test:content_machine_test@localhost:5434/content_machine_test
export MIGRATIONS_DIR="$REPO/lib/db/drizzle"
export SESSION_SECRET=test-session-secret-not-for-production
export ADMIN_PASSWORD=test-admin-password-not-for-production
export TEST_ADMIN_PASSWORD=test-admin-password-not-for-production
export PORT=8080 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
rm -rf "$FE"; cp -r artifacts/content-os/dist/public "$FE"; export FRONTEND_DIST_PATH="$FE"
rm -rf artifacts/content-os/test-results
step() { local n="$1"; shift; local start=$(date +%s); "$@" > "$OUT/$n.txt" 2>&1; local rc=$?; echo "$n exit=$rc $(( $(date +%s)-start ))s" | tee -a "$OUT/summary-rerun.txt"; return $rc; }
: > "$OUT/summary-rerun.txt"
step 05b-db-prepare pnpm --filter @workspace/api-server test:db:prepare
(cd artifacts/api-server && exec node --enable-source-maps ./dist/index.mjs) > "$OUT/10b-api-server.log" 2>&1 &
API_PID=$!
ok=0; for i in $(seq 1 30); do curl --fail --silent http://localhost:8080/api/healthz >/dev/null && ok=1 && break; sleep 1; done
echo "10b-start-api ok=$ok root=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)" | tee -a "$OUT/summary-rerun.txt"
step 11b-integration bash tests/integration-tests.sh
step 12b-a11y pnpm --filter @workspace/content-os test:a11y
kill "$API_PID"; wait "$API_PID" 2>/dev/null
echo DONE | tee -a "$OUT/summary-rerun.txt"
