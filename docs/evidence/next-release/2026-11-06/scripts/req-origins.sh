#!/usr/bin/env bash
# Prints the running version and the application's requirement rows by origin (owner session from the last verify run).
source "$(dirname "$0")/lib.sh"
source $R/seed.env
code owner -X POST $API/auth/login --data "{\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null
echo "commit=$(curl -sk $API/healthz | jq -r .commit | cut -c1-7) status=$(code owner $API/grants/applications/$APP) origins=$(c owner $API/grants/applications/$APP | jq -c '[.requirements[] | .origin] | group_by(.) | map({(.[0]): length}) | add')"
