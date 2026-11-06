#!/usr/bin/env bash
# Usage: smoke.sh <tree> <full-sha> <out-name>. Runs that tree's tests/production-smoke.sh through the local TLS edge.
R=/tmp/claude-0/-home-user-agency-content-grants/e22c0b2c-46ea-5f5f-8bd2-a9d68e47f66f/scratchpad/rehearsal
cd "$R/$1"
BASE_URL=https://localhost:8443 EXPECTED_SHA="$2" SMOKE_ADMIN_PASSWORD="$(cat $R/secrets/admin)" \
SMOKE_REQUIRE_READY=0 SMOKE_REQUIRE_GRANTS=0 SMOKE_CURL_OPTS=-k SMOKE_EVIDENCE="$R/out/$3" \
bash tests/production-smoke.sh > /dev/null 2>&1
grep -E "RESULT:" "$R/out/$3"; grep -E "FAIL" "$R/out/$3" | head
