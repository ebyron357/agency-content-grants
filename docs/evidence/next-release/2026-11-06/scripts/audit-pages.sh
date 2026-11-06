#!/usr/bin/env bash
# Pages through /workspace/audit and counts the seed events (member_joined, member_mfa_enabled) across all pages.
source "$(dirname "$0")/lib.sh"
code owner -X POST $API/auth/login --data "{\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null
before=""; pages=0; total=0; seed=0
while :; do
  A=$(c owner "$API/workspace/audit${before:+?before=$before}")
  n=$(echo "$A" | jq '.entries|length'); pages=$((pages+1)); total=$((total+n))
  seed=$((seed + $(echo "$A" | jq '[.entries[] | select((.action // .type // "") | test("member_joined|member_mfa_enabled"))] | length')))
  before=$(echo "$A" | jq -r '.nextBefore // empty'); [[ -z $before || $n == 0 || $pages -ge 20 ]] && break
done
echo "commit=$(curl -sk $API/healthz | jq -r .commit | cut -c1-7) pages=$pages entries=$total seed_events=$seed"
echo "activity_log rows: $($PSQL -c "select count(*) from activity_log")"
