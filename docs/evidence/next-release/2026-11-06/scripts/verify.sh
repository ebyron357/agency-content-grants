#!/usr/bin/env bash
# Usage: verify.sh <expected-sha> <members:yes|no> [recovery:yes|no]
# Checks that data seeded on ee7b5c8 is intact and usable on the running version.
source "$(dirname "$0")/lib.sh"
source $R/seed.env
set -u
SHA="$1"; MEMBERS="$2"; RECOV="${3:-no}"
rm -f $R/owner.jar $R/writer.jar $R/reviewer.jar
echo "== Version"
check "healthz reports $SHA" "$SHA" "$(curl -sk $API/healthz | jq -r .commit)"
echo "== Owner (team password) reads the old records"
check "Team password sign-in" 200 "$(code owner -X POST $API/auth/login --data "{\"password\":\"$ADMIN_PASSWORD\"}")"
check "Brand readable" 200 "$(code owner $API/brands/$BRAND)"
check "Project readable" 200 "$(code owner $API/projects/$PROJECT)"
check "Project title intact" "[REHEARSAL] Volunteer tutor guide" "$(c owner $API/projects/$PROJECT | jq -r '.title // .project.title')"
if [[ "$MEMBERS" == no ]]; then
  check "Member sign-in not available on this version (team password only)" 401 "$(code writer -X POST $API/auth/login --data "$(jq -cn --arg p "$WPASS" '{email:"writer.rehearsal@example.org",password:$p}')")"
  echo "RESULT: $pass passed, $fail failed"; exit 0
fi
check "Same workspace as before" "$WS" "$(c owner $API/auth/me | jq -r .workspace.id)"
check "Applicant readable" 200 "$(code owner $API/grants/applicants/$APPLICANT)"
check "Confirmed fact intact" "[REHEARSAL] 82% of tutored students gained one reading level in 2025." "$(c owner $API/grants/applicants/$APPLICANT/facts | jq -r --arg f "$FACT" '(.facts // .)[] | select(.id==$f) | .body')"
APPJSON=$(c owner $API/grants/applications/$APP)
check "Application readable" "$APP" "$(echo "$APPJSON" | jq -r '.id // .application.id')"
check "Section text written on ee7b5c8 intact" 1 "$(echo "$APPJSON" | jq -r --arg s "$SECTION" '[.sections[] | select(.id==$s) | .content | contains("written on ee7b5c8")] | if .[0] then 1 else 0 end')"
check "Budget line intact" 52000 "$(echo "$APPJSON" | jq -r --arg b "$BUDGET_ID" '[(.budgetLines // .budget.lines // [])[] | select(.id==$b) | .total][0] // empty')"
check "Opportunity readable" 200 "$(code owner $API/grants/opportunities/$OPP)"
check "Both members listed with roles" "reviewer,writer" "$(c owner $API/workspace | jq -r '[.members[] | select(.name|startswith("[REHEARSAL]")) | .role] | sort | join(",")')"
check "Writer still shows two-factor on" true "$(c owner $API/workspace | jq -r '.members[] | select(.role=="writer" and (.name|startswith("[REHEARSAL]"))) | .mfaEnabled')"
# 2026-11-06: the log is paged 50 at a time (nextBefore); read every page, since later activity pushes the seed events past page 1.
AUD_SEED=0; AUD_BEFORE=""; for _p in $(seq 1 20); do AUD=$(c owner "$API/workspace/audit${AUD_BEFORE:+?before=$AUD_BEFORE}"); AUD_SEED=$((AUD_SEED + $(echo "$AUD" | jq '[.entries[] | select((.action // .type // "") | test("member_joined|member_mfa_enabled"))] | length'))); AUD_BEFORE=$(echo "$AUD" | jq -r '.nextBefore // empty'); [[ -z $AUD_BEFORE ]] && break; done
check "Audit log readable, with the seed events" 1 "$([[ $AUD_SEED -ge 3 ]] && echo 1 || echo 0)"
echo "== Writer signs in with password and two-factor"
LOGIN=$(c writer -X POST $API/auth/login --data "$(jq -cn --arg p "$WPASS" '{email:"writer.rehearsal@example.org",password:$p}')")
check "Password accepted, second factor required" true "$(echo "$LOGIN" | jq -r .mfaRequired)"
check "Wrong code refused" 401 "$(code writer -X POST $API/auth/mfa/verify --data '{"code":"000000"}')"
fresh_step
check "Current authenticator code accepted (secret sealed by ee7b5c8 opens here)" 200 "$(code writer -X POST $API/auth/mfa/verify --data "{\"code\":\"$(totp "$SECRET")\"}")"
check "Writer role" writer "$(c writer $API/auth/me | jq -r .role)"
check "Writer reads the application" 200 "$(code writer $API/grants/applications/$APP)"
check "Writer can still edit the section" 200 "$(code writer -X PATCH $API/grants/sections/$SECTION --data "{\"content\":\"<h2>Need</h2><p>[REHEARSAL] Section text written on ee7b5c8 by a member with two-factor on. Edited on $SHA.</p>\"}")"
if [[ "$RECOV" == yes ]]; then
  code writer -X POST $API/auth/logout >/dev/null
  c writer -X POST $API/auth/login --data "$(jq -cn --arg p "$WPASS" '{email:"writer.rehearsal@example.org",password:$p}')" >/dev/null
  check "Recovery code issued on ee7b5c8 accepted once" 200 "$(code writer -X POST $API/auth/mfa/verify --data "{\"recoveryCode\":\"$RECOVERY\"}")"
  code writer -X POST $API/auth/logout >/dev/null
  c writer -X POST $API/auth/login --data "$(jq -cn --arg p "$WPASS" '{email:"writer.rehearsal@example.org",password:$p}')" >/dev/null
  check "Same recovery code refused the second time" 401 "$(code writer -X POST $API/auth/mfa/verify --data "{\"recoveryCode\":\"$RECOVERY\"}")"
fi
echo "== Reviewer (no two-factor) and role enforcement"
check "Reviewer signs in with password only" 200 "$(code reviewer -X POST $API/auth/login --data "$(jq -cn --arg p "$RPASS" '{email:"reviewer.rehearsal@example.org",password:$p}')")"
check "Reviewer role" reviewer "$(c reviewer $API/auth/me | jq -r .role)"
check "Reviewer reads the application" 200 "$(code reviewer $API/grants/applications/$APP)"
check "Reviewer cannot invite members" 403 "$(code reviewer -X POST $API/workspace/invites --data '{"email":"x.rehearsal@example.org","role":"viewer"}')"
check "Anonymous request rejected" 401 "$(curl -sk -o /dev/null -w '%{http_code}' $API/grants/applications/$APP)"
echo "RESULT: $pass passed, $fail failed"
