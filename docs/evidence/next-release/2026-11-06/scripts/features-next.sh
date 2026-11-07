#!/usr/bin/env bash
# Usage: features-next.sh <pdf-path>
# Exercises PRs #58, #56, #57 and #55 on the combined build, against the records seeded on ee7b5c8.
# Billing has no Stripe settings here, as in production today. All data is synthetic.
source "$(dirname "$0")/lib.sh"
source $R/seed.env
set -u
PDF="$1"
rm -f $R/owner.jar $R/writer.jar $R/reviewer.jar
code owner -X POST $API/auth/login --data "{\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null
code reviewer -X POST $API/auth/login --data "$(jq -cn --arg p "$RPASS" '{email:"reviewer.rehearsal@example.org",password:$p}')" >/dev/null

echo "== Migrations"
check "Migration rows in drizzle.__drizzle_migrations" 35 "$($PSQL -c 'select count(*) from drizzle.__drizzle_migrations')"
for t in foundation_funders grant_sources grant_notices billing_plans workspace_subscriptions; do
  check "Table $t exists" 1 "$($PSQL -c "select count(*) from information_schema.tables where table_name='$t'")"
done
check "grant_requirements gained notice columns" 8 "$($PSQL -c "select count(*) from information_schema.columns where table_name='grant_requirements' and column_name in ('notice_id','page','quote','extracted_by','confirmed_by','confirmed_at','rejected_by','rejected_at')")"

echo "== #58 Foundations (import off by default)"
check "Foundations meta readable" 200 "$(code owner $API/grants/foundations/meta)"
check "Funder list readable (empty: nothing imported)" 0 "$(c owner $API/grants/foundations | jq -r .total)"
check "Suggestions for the old applicant" 200 "$(code owner $API/grants/applicants/$APPLICANT/foundation-suggestions)"
check "Import without admin unlock refused" 403 "$(code owner -X POST $API/grants/foundations/import)"
check "Reviewer cannot import" 403 "$(code reviewer -X POST $API/grants/foundations/import)"

echo "== #56 Source registry"
check "Registry without admin unlock refused" 403 "$(code owner $API/grant-sources)"
check "Reviewer cannot read the registry" 403 "$(code reviewer $API/grant-sources)"
check "Change notifications off without a secret" 503 "$(curl -sk -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST $API/watch-events/changedetection --data '{"watch_uuid":"00000000-0000-0000-0000-000000000000"}')"

echo "== #55 Billing (no Stripe settings)"
B=$(c owner $API/billing)
check "Billing reports off" false "$(echo "$B" | jq -r .enabled)"
check "Missing settings named, not valued" "APP_BASE_URL,STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET" "$(echo "$B" | jq -r '.missingSettings | sort | join(",")')"
check "Entitlement unlimited while off" unlimited "$(echo "$B" | jq -r .entitlement.mode)"
check "Trial refused while off" 409 "$(code owner -X POST $API/billing/trial --data '{"planKey":"starter"}')"
check "Checkout refused while off" 409 "$(code owner -X POST $API/billing/checkout --data '{"planKey":"starter","interval":"month"}')"
check "Stripe webhook absent while off" 404 "$(curl -sk -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST $API/billing/webhook --data '{}')"
check "Reviewer cannot see billing" 403 "$(code reviewer $API/billing)"
check "Plans seeded, prices unpublished (psql prints f)" "f" "$($PSQL -c "select bool_or(prices_published) from billing_plans where purchasable")"
ORG=$(c owner -X POST $API/grants/applicants --data '{"name":"[REHEARSAL] Second organization","applicantType":"nonprofit_501c3","state":"CA"}' | jq -r '.id // empty')
check "New organization not limited while billing is off" 1 "$([[ -n $ORG ]] && echo 1)"
[[ -n $ORG ]] && code owner -X DELETE $API/grants/applicants/$ORG >/dev/null

echo "== #57 Notice PDF on the application started on ee7b5c8"
UP=$(curl -sk --max-time 60 -b $R/owner.jar -c $R/owner.jar -o $R/out/notice-upload.json -w '%{http_code}' -F "pdf=@$PDF;type=application/pdf" $API/grants/applications/$APP/notice)
check "Notice PDF accepted (201 done, or 202 queued)" 1 "$([[ $UP == 201 || $UP == 202 ]] && echo 1)"
for i in $(seq 1 20); do
  ST=$(c owner $API/grants/applications/$APP | jq -r '.notice.status // empty'); [[ $ST == done || $ST == failed || $ST == ready || $ST == read ]] && break; sleep 2
done
echo "  notice status: $ST; $(c owner $API/grants/applications/$APP | jq -c '.notice | {status,extractor,pageCount,pagesRead,proposed,checklistDemo,error}')"
check "Page 1 text readable" 1 "$(c owner $API/grants/applications/$APP/notice/pages/1 | jq -r '.text | contains("REH-26-001") | if . then 1 else 0 end')"
check "Original file served as PDF" 200 "$(code owner $API/grants/applications/$APP/notice/file)"
check "Reviewer cannot attach a notice" 403 "$(curl -sk -o /dev/null -w '%{http_code}' -b $R/reviewer.jar -F "pdf=@$PDF;type=application/pdf" $API/grants/applications/$APP/notice)"
check "Anonymous cannot read notice pages" 401 "$(curl -sk -o /dev/null -w '%{http_code}' $API/grants/applications/$APP/notice/pages/1)"
check "Link to a private address refused" 400 "$(code owner -X POST $API/grants/applications/$APP/notice --data '{"url":"https://127.0.0.1/notice.pdf"}')"
echo "  proposed rows: $(c owner $API/grants/applications/$APP | jq -c '[.requirements[]? | select(.origin=="notice") | {page,status: (.status // null), confirmed: (.confirmedAt != null)}]')"
check "Section text from ee7b5c8 still intact" 1 "$(c owner $API/grants/applications/$APP | jq -r --arg s "$SECTION" '[.sections[] | select(.id==$s) | .content | contains("written on ee7b5c8")] | if .[0] then 1 else 0 end')"

echo "== Admin unlock reaches the operator-only screens"
check "Admin unlock" 200 "$(code owner -X POST $API/auth/admin-unlock --data "$(jq -cn --arg p "$ADMIN_PASSWORD" '{password:$p}')")"
check "Registry lists the two feed sources" "ca_grants_portal,grants_gov" "$(c owner $API/grant-sources | jq -r '[(.sources // .)[] | .key] | sort | join(",")')"
check "Import still off (FOUNDATIONS_IMPORT_ENABLED unset)" 409 "$(code owner -X POST $API/grants/foundations/import)"
check "Jobs list includes the new schedules" 1 "$(c owner $API/jobs | jq -r '[.schedules[]?.name] | (index("source-sweep-hourly") != null and index("foundation-import-monthly") != null) | if . then 1 else 0 end')"
echo "RESULT: $pass passed, $fail failed"
