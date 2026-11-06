#!/usr/bin/env bash
# Usage: switch.sh <tree: ee7b5c8|combined> <full-sha> <log-name>. Stops the running rehearsal server, starts the given build, waits for /api/healthz.
set -uo pipefail
R=/tmp/claude-0/-home-user-agency-content-grants/e22c0b2c-46ea-5f5f-8bd2-a9d68e47f66f/scratchpad/rehearsal
if [[ -f $R/server.pid ]]; then kill "$(cat $R/server.pid)" 2>/dev/null; for i in $(seq 1 40); do kill -0 "$(cat $R/server.pid)" 2>/dev/null || break; sleep 1; done; fi
bash $R/scripts/run-server.sh "$1" "$2" "$R/out/$3"
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/healthz); [[ $c == 200 ]] && break; sleep 1; done
echo "healthz=$c commit=$(curl -s http://127.0.0.1:8080/api/healthz | jq -r .commit) readyz=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/readyz)"
echo "migrations=$(psql postgresql://rehearsal:rehearsal@127.0.0.1:5434/rehearsal_upgrade -tAqc 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null)"
