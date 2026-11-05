#!/usr/bin/env bash
# Seeds synthetic data on the version under test (d2250c3) and records ids in $R/seed.env.
source "$(dirname "$0")/lib.sh"
set -u
rm -f $R/owner.jar $R/writer.jar $R/reviewer.jar $R/seed.env
echo "== Owner (team password)"
check "Team password sign-in" 200 "$(code owner -X POST $API/auth/login --data "{\"password\":\"$ADMIN_PASSWORD\"}")"
WS=$(c owner $API/auth/me | jq -r .workspace.id)

echo "== Content Machine records"
BRAND=$(c owner -X POST $API/brands --data '{"name":"[REHEARSAL] Northwind Literacy","industry":"Nonprofit education"}' | jq -r '.id // empty')
PROJECT=$(c owner -X POST $API/projects --data "$(jq -cn --arg b "$BRAND" '{brandId:$b,title:"[REHEARSAL] Volunteer tutor guide",contentType:"guide",topic:"Onboarding volunteer reading tutors",intendedAudience:"New volunteers"}')" | jq -r '.id // empty')
check "Brand created" 1 "$([[ -n $BRAND ]] && echo 1)"
check "Project created" 1 "$([[ -n $PROJECT ]] && echo 1)"

echo "== Members"
INV_W=$(c owner -X POST $API/workspace/invites --data '{"email":"writer.rehearsal@example.org","role":"writer"}')
INV_R=$(c owner -X POST $API/workspace/invites --data '{"email":"reviewer.rehearsal@example.org","role":"reviewer"}')
TOK_W=$(echo "$INV_W" | jq -r '.invitePath' | sed 's#^/invite/##')
TOK_R=$(echo "$INV_R" | jq -r '.invitePath' | sed 's#^/invite/##')
WPASS="Rehearsal-writer-$(openssl rand -hex 6)"; RPASS="Rehearsal-reviewer-$(openssl rand -hex 6)"
check "Writer accepts invitation" 201 "$(code writer -X POST $API/auth/invites/$TOK_W/accept --data "$(jq -cn --arg p "$WPASS" '{name:"[REHEARSAL] Wren Writer",password:$p}')")"
check "Reviewer accepts invitation" 201 "$(code reviewer -X POST $API/auth/invites/$TOK_R/accept --data "$(jq -cn --arg p "$RPASS" '{name:"[REHEARSAL] Reese Reviewer",password:$p}')")"

echo "== Writer turns on two-factor"
SECRET=$(c writer -X POST $API/account/mfa/setup | jq -r '.secret' | tr -d ' ')
ENABLE=$(c writer -X POST $API/account/mfa/enable --data "{\"code\":\"$(totp "$SECRET")\"}")
check "Two-factor enabled" true "$(echo "$ENABLE" | jq -r .mfaEnabled)"
RECOVERY=$(echo "$ENABLE" | jq -r '.recoveryCodes[0]')
SEALED=$($PSQL -c "select left(totp_secret,3) from members where email='writer.rehearsal@example.org'")
check "Stored secret is encrypted (v1:)" "v1:" "$SEALED"

echo "== Grant Studio"
OPP=rehearsal-opp-0001
$PSQL -c "insert into grant_opportunities (id,source,source_ref,number,title,agency,status,open_date,close_date,award_floor,award_ceiling,estimated_funding,eligibility_text,description,official_url,fetched_at,checksum,connector_version,publishable) values ('$OPP','grants.gov','REH-0001','REH-26-001','[SYNTHETIC] Community Literacy Partnerships','Synthetic Department of Education','posted','2026-10-01','2026-12-15',50000,250000,1000000,'Nonprofits with 501(c)(3) status','Synthetic notice for an upgrade rehearsal.','https://www.grants.gov/search-results-detail/000000',now(),'rehearsal','rehearsal',true) on conflict do nothing"
APPLICANT=$(c owner -X POST $API/grants/applicants --data '{"name":"[REHEARSAL] Northwind Literacy Council","applicantType":"nonprofit_501c3","ein":"12-3456789","state":"CA","mission":"Every child reads by third grade.","focusAreas":["literacy","education"]}' | jq -r '.id // empty')
check "Applicant created" 1 "$([[ -n $APPLICANT ]] && echo 1)"
FACT=$(c owner -X POST $API/grants/applicants/$APPLICANT/facts --data '{"category":"outcomes","label":"Reading gains","body":"[REHEARSAL] 82% of tutored students gained one reading level in 2025.","source":"Synthetic annual report","asOf":"2025-12-31","confirmed":true}' | jq -r '.id // empty')
check "Confirmed fact created" 1 "$([[ -n $FACT ]] && echo 1)"
APP=$(c owner -X POST $API/grants/applications --data "$(jq -cn --arg a "$APPLICANT" --arg o "$OPP" '{applicantId:$a,opportunityId:$o,eligibilityConfirmed:true,eligibilityNote:"[REHEARSAL] Checked against the synthetic notice."}')" | jq -r '.id // empty')
check "Application started" 1 "$([[ -n $APP ]] && echo 1)"
SECTION=$(c owner $API/grants/applications/$APP | jq -r '.sections[0].id // empty')
check "Writer edits a section" 200 "$(code writer -X PATCH $API/grants/sections/$SECTION --data '{"content":"<h2>Need</h2><p>[REHEARSAL] Section text written on d2250c3 by a member with two-factor on.</p>"}')"
BUDGET=$(c owner -X POST $API/grants/applications/$APP/budget-lines --data '{"category":"personnel","description":"[REHEARSAL] Program coordinator","quantity":1,"unitCost":52000}')
echo "  budget line: $(echo "$BUDGET" | jq -c '{id,category,total,error}')"
BUDGET_ID=$(echo "$BUDGET" | jq -r '.id // empty')

echo "== Audit log"
AUDIT=$(c owner "$API/workspace/audit" | jq -r '[.entries[]?.action // .[]?.action] | join(",")' 2>/dev/null)
echo "  audit actions: $AUDIT"

cat > $R/seed.env <<ENV
WS=$WS
BRAND=$BRAND
PROJECT=$PROJECT
APPLICANT=$APPLICANT
FACT=$FACT
APP=$APP
SECTION=$SECTION
BUDGET_ID=$BUDGET_ID
OPP=$OPP
WPASS=$WPASS
RPASS=$RPASS
SECRET=$SECRET
RECOVERY=$RECOVERY
ENV
chmod 600 $R/seed.env
echo "RESULT: $pass passed, $fail failed"
