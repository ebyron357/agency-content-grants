#!/usr/bin/env bash
# New fdb352c features exercised on records created by d2250c3.
source "$(dirname "$0")/lib.sh"
source $R/seed.env
set -u
rm -f $R/owner.jar
check "Team password sign-in" 200 "$(code owner -X POST $API/auth/login --data "{\"password\":\"$ADMIN_PASSWORD\"}")"
A=$(c owner $API/grants/applications/$APP)
check "Competitiveness rating computed for the old application (0-100)" 1 "$(echo "$A" | jq -r '.rating.score | if type=="number" and . >= 0 and . <= 100 then 1 else 0 end')"
check "Format profile present for the old application" 1 "$(echo "$A" | jq -r 'if (.format.estimatedPages|type)=="number" then 1 else 0 end')"
check "New package check present (no placeholders)" 1 "$(echo "$A" | jq -r '[.compliance.checks[]? // .compliance[]? | (.label // "")] | map(select(test("placeholders"))) | length')"
check "Record a place designation on the old applicant" 200 "$(code owner -X PUT $API/grants/applicants/$APPLICANT/places/opportunity_zone --data '{"status":"in","place":"[REHEARSAL] Tract 101","geoRef":"06001400100","checkedOn":"2026-11-04","note":"Synthetic"}')"
check "Designation saved" in "$(c owner $API/grants/applicants/$APPLICANT | jq -r '.places[] | select(.key=="opportunity_zone") | .record.status')"
check "Track a letter of support on the old application" 201 "$(code owner -X POST $API/grants/applications/$APP/letters --data '{"name":"[REHEARSAL] Dana Partner","organization":"Synthetic Library","purpose":"Partner commitment","status":"requested","requestedOn":"2026-11-04"}')"
check "Templates list" 200 "$(code owner $API/grants/templates)"
check "Jobs list refused before admin unlock" 403 "$(code owner $API/jobs)"
check "Admin unlock with the team password" 200 "$(code owner -X POST $API/auth/admin-unlock --data "{\"password\":\"$ADMIN_PASSWORD\"}")"
check "Jobs list (Settings -> Jobs)" 200 "$(code owner $API/jobs)"
echo "  jobs by kind/status: $(c owner $API/jobs | jq -c '[(.jobs // .items // [])[] | "\(.kind // .type)=\(.status)"] | group_by(.) | map("\(.[0]) x\(length)")')"
echo "RESULT: $pass passed, $fail failed"
