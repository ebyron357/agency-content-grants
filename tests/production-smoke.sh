#!/usr/bin/env bash
# Content Machine production smoke test.
#
# Verifies a deployed environment end to end and leaves no business records
# behind: every record it creates is prefixed "[SMOKE]" and deleted at the end,
# and deleting the project also removes its uploaded image and export files.
# Grant Studio checks use a [SMOKE] organization that is deleted at the end and
# a viewer invitation to an example.invalid address that is withdrawn, never
# accepted. No application is started, nothing is confirmed or approved, and
# no two-factor code is submitted (wrong codes count toward the sign-in limit).
#
# Usage:
#   BASE_URL=https://<service>.onrender.com \
#   SMOKE_ADMIN_PASSWORD='<ADMIN_PASSWORD from the platform secret store>' \
#   EXPECTED_SHA=<reviewed main SHA> \
#   bash tests/production-smoke.sh
#
# Optional:
#   SMOKE_REQUIRE_READY=0   accept a 503 from /api/readyz (rehearsals only)
#   SMOKE_REQUIRE_GRANTS=0  do not require synced grant opportunities or a
#                           non-failed last sync (rehearsals without outbound access)
#   SMOKE_CURL_OPTS="-k"    extra curl flags (e.g. self-signed TLS in a rehearsal)
#   SMOKE_EVIDENCE=path     evidence log path (default ./smoke-evidence-<UTC>.txt)
#
# Cost note: one outline generation call is made to the configured AI provider.
# The password is never printed. Exit status is non-zero if any check fails.

set -uo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required}"
BASE_URL="${BASE_URL%/}"
API="$BASE_URL/api"
: "${SMOKE_ADMIN_PASSWORD:?SMOKE_ADMIN_PASSWORD is required}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
REQUIRE_READY="${SMOKE_REQUIRE_READY:-1}"
REQUIRE_GRANTS="${SMOKE_REQUIRE_GRANTS:-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="${SMOKE_EVIDENCE:-smoke-evidence-$STAMP.txt}"
WORK="$(mktemp -d)"
JAR="$WORK/cookies.txt"
PASS=0
FAIL=0
PROJECT_ID=""
BRAND_ID=""
APPLICANT_ID=""
INVITE_ID=""

# shellcheck disable=SC2206
EXTRA=(${SMOKE_CURL_OPTS:-})

log() { echo "$1" | tee -a "$EVIDENCE"; }
pass() { log "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { log "  FAIL  $1 :: $2"; FAIL=$((FAIL + 1)); }
section() { log ""; log "== $1"; }
check() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1" "expected $2, got $3"; fi; }

# Authenticated (cookie jar) and anonymous requests.
acurl() { curl -sS --max-time "${TIMEOUT:-30}" "${EXTRA[@]}" -b "$JAR" -c "$JAR" "$@"; }
ncurl() { curl -sS --max-time "${TIMEOUT:-30}" "${EXTRA[@]}" "$@"; }
code() { "$@" -o /dev/null -w "%{http_code}"; }
json() { "$@" -H "Content-Type: application/json"; }

cleanup() {
  if [[ -n "$PROJECT_ID" || -n "$BRAND_ID" || -n "$APPLICANT_ID" || -n "$INVITE_ID" ]]; then
    section "Cleanup of [SMOKE] records"
    login_session >/dev/null 2>&1
    [[ -n "$PROJECT_ID" ]] && check "DELETE smoke project" "204" "$(code acurl -X DELETE "$API/projects/$PROJECT_ID")"
    [[ -n "$BRAND_ID" ]] && check "DELETE smoke brand" "204" "$(code acurl -X DELETE "$API/brands/$BRAND_ID")"
    [[ -n "$PROJECT_ID" ]] && check "Deleted project is gone" "404" "$(code acurl "$API/projects/$PROJECT_ID")"
    [[ -n "$APPLICANT_ID" ]] && check "DELETE smoke Grant Studio organization" "204" "$(code acurl -X DELETE "$API/grants/applicants/$APPLICANT_ID")"
    [[ -n "$INVITE_ID" ]] && check "Withdraw smoke invitation" "204" "$(code acurl -X DELETE "$API/workspace/invites/$INVITE_ID")"
    acurl -X POST "$API/auth/logout" -o /dev/null
  fi
  rm -rf "$WORK"
  log ""
  log "RESULT: $PASS passed, $FAIL failed  ($BASE_URL, $STAMP)"
  log "Evidence written to $EVIDENCE"
  # Exit status covers every check, including the cleanup checks above.
  if [[ "$FAIL" -eq 0 ]]; then exit 0; else exit 1; fi
}
trap cleanup EXIT

login_session() {
  json acurl -X POST "$API/auth/login" -D "$WORK/login-headers.txt" \
    --data "$(jq -cn --arg p "$SMOKE_ADMIN_PASSWORD" '{password: $p}')" \
    -o "$WORK/login.json" -w "%{http_code}"
}

: >"$EVIDENCE"
log "Content Machine production smoke — $STAMP UTC"
log "Target: $BASE_URL"

section "1. Liveness, readiness and SHA parity"
HEALTH="$(ncurl "$API/healthz" -w "\n%{http_code}")"
check "GET /api/healthz returns 200" "200" "$(tail -n1 <<<"$HEALTH")"
COMMIT="$(head -n1 <<<"$HEALTH" | jq -r '.commit // empty' 2>/dev/null)"
log "  running commit: ${COMMIT:-<not reported>}"
if [[ -n "$EXPECTED_SHA" ]]; then
  if [[ -n "$COMMIT" && "$EXPECTED_SHA" == "$COMMIT"* || -n "$COMMIT" && "$COMMIT" == "$EXPECTED_SHA"* ]]; then
    pass "Deployed commit matches EXPECTED_SHA $EXPECTED_SHA"
  else
    fail "Deployed commit matches EXPECTED_SHA" "running=${COMMIT:-none} expected=$EXPECTED_SHA"
  fi
fi
READY="$(ncurl "$API/readyz" -w "\n%{http_code}")"
log "  readyz: $(head -n1 <<<"$READY")"
if [[ "$REQUIRE_READY" == "1" ]]; then
  check "GET /api/readyz returns 200 (database, storage, configuration ok)" "200" "$(tail -n1 <<<"$READY")"
else
  log "  (SMOKE_REQUIRE_READY=0: readiness recorded, not enforced)"
fi
check "GET / serves the GrantCrest app shell" "200" "$(code ncurl "$BASE_URL/")"
if ncurl "$BASE_URL/" | grep -q '<div id="root">'; then pass "App shell contains the React root"; else fail "App shell contains the React root" "root element missing"; fi
for target in "$BASE_URL/" "$API/healthz"; do
  ncurl "$target" -D "$WORK/headers.txt" -o /dev/null
  for header in "x-content-type-options: nosniff" "x-frame-options: DENY" "content-security-policy: .*frame-ancestors 'none'" "referrer-policy: strict-origin-when-cross-origin"; do
    if grep -qi "^$header" "$WORK/headers.txt"; then pass "$target sends ${header%%:*}"; else fail "$target sends ${header%%:*}" "header missing or different"; fi
  done
  if [[ "$BASE_URL" == https://* ]]; then
    if grep -qi '^strict-transport-security: max-age=' "$WORK/headers.txt"; then pass "$target sends strict-transport-security"; else fail "$target sends strict-transport-security" "header missing"; fi
  fi
  if grep -qi '^x-powered-by:' "$WORK/headers.txt"; then fail "$target hides x-powered-by" "x-powered-by present"; else pass "$target hides x-powered-by"; fi
done

section "2. Unauthenticated access is rejected"
RANDOM_ID="00000000-0000-4000-8000-000000000000"
for path in /projects /brands /dashboard/stats "/projects/$RANDOM_ID" "/media/images/$RANDOM_ID" /exports/download/missing.pdf /api-keys /grants/applicants /grants/opportunities /workspace /workspace/audit /jobs; do
  check "Anonymous GET /api$path is 401" "401" "$(code ncurl "$API$path")"
done
check "Anonymous POST /api/projects is 401" "401" "$(code json ncurl -X POST "$API/projects" --data '{}')"
check "Wrong password is rejected" "401" "$(code json ncurl -X POST "$API/auth/login" --data '{"password":"definitely-not-the-password"}')"

section "3. Authentication and session"
check "Login with the admin password" "200" "$(login_session)"
if [[ "$BASE_URL" == https://* ]]; then
  if grep -qi '^set-cookie: sid=.*;.*HttpOnly' "$WORK/login-headers.txt" && grep -qi '^set-cookie: sid=.*;.*Secure' "$WORK/login-headers.txt"; then
    pass "Session cookie is HttpOnly and Secure"
  else
    fail "Session cookie is HttpOnly and Secure" "$(grep -i '^set-cookie' "$WORK/login-headers.txt" | sed 's/sid=[^;]*/sid=<redacted>/')"
  fi
fi
ME="$(acurl "$API/auth/me")"
check "GET /api/auth/me reports an authenticated session" "true" "$(jq -r '.authenticated' <<<"$ME")"

section "4. Project and document persistence"
BRAND_ID="$(json acurl -X POST "$API/brands" --data "$(jq -cn --arg n "[SMOKE] Content Machine $STAMP" '{name: $n, industry: "Production smoke test"}')" | jq -r '.id // empty')"
[[ -n "$BRAND_ID" ]] && pass "Create [SMOKE] brand" || fail "Create [SMOKE] brand" "no id"
PROJECT_ID="$(json acurl -X POST "$API/projects" --data "$(jq -cn --arg b "$BRAND_ID" --arg t "[SMOKE] Operator guide $STAMP" '{brandId: $b, title: $t, contentType: "guide", topic: "Production smoke test guide", intendedAudience: "Operators"}')" | jq -r '.id // empty')"
[[ -n "$PROJECT_ID" ]] && pass "Create [SMOKE] guide project" || fail "Create [SMOKE] guide project" "no id"
check "Project is readable after creation" "[SMOKE] Operator guide $STAMP" "$(acurl "$API/projects/$PROJECT_ID" | jq -r '.title')"

TIMEOUT=180
OUTLINE="$(json acurl -X POST "$API/projects/$PROJECT_ID/outline" --data '{}')"
TIMEOUT=30
OUTLINE_ID="$(jq -r '.id // empty' <<<"$OUTLINE")"
SECTIONS="$(jq -r '(.sections // []) | length' <<<"$OUTLINE" 2>/dev/null || echo 0)"
if [[ -n "$OUTLINE_ID" && "$SECTIONS" -ge 1 ]]; then pass "AI provider generated an outline ($SECTIONS sections)"; else fail "AI provider generated an outline" "$(head -c 300 <<<"$OUTLINE")"; fi
check "Approve outline" "200" "$(code acurl -X POST "$API/outlines/$OUTLINE_ID/approve")"
DOC="$(acurl -X POST "$API/projects/$PROJECT_ID/document")"
SECTION_ID="$(jq -r '.sections[0].id // empty' <<<"$DOC")"
[[ -n "$SECTION_ID" ]] && pass "Create document with outline sections" || fail "Create document with outline sections" "$(head -c 300 <<<"$DOC")"

RICH='<h2>Smoke heading</h2><p>Persisted <strong>bold</strong> and <em>italic</em> text with a <a href="https://example.com">link</a>.</p><ul><li>First</li><li>Second</li></ul><script>alert(1)</script>'
check "Save rich HTML section content" "200" "$(code json acurl -X PATCH "$API/document-sections/$SECTION_ID" --data "$(jq -cn --arg c "$RICH" '{content: $c, contentFormat: "html"}')")"
SAVED="$(acurl "$API/document-sections/$SECTION_ID" | jq -r '.content')"
if grep -q '<h2>Smoke heading</h2>' <<<"$SAVED" && grep -q '<strong>bold</strong>' <<<"$SAVED" && grep -q '<li>Second</li>' <<<"$SAVED"; then pass "Rich formatting survives reload"; else fail "Rich formatting survives reload" "$(head -c 200 <<<"$SAVED")"; fi
if grep -qi '<script' <<<"$SAVED"; then fail "Server-side sanitizer strips <script>" "script persisted"; else pass "Server-side sanitizer strips <script>"; fi

section "5. Media persistence"
# Valid 1x1 PNG; the server validates uploads by file signature, not by name.
base64 -d >"$WORK/smoke.png" <<<'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
IMG="$(acurl -X POST "$API/document-sections/$SECTION_ID/media/images" -F "image=@$WORK/smoke.png;type=image/png" -F "altText=Smoke test pixel" -F "caption=[SMOKE] image")"
IMG_URL="$(jq -r '.url // empty' <<<"$IMG")"
[[ -n "$IMG_URL" ]] && pass "Upload image with alt text" || fail "Upload image with alt text" "$(head -c 200 <<<"$IMG")"
check "Uploaded image renders for its owner" "200" "$(code acurl "$BASE_URL$IMG_URL")"
check "Uploaded image is hidden from anonymous users" "401" "$(code ncurl "$BASE_URL$IMG_URL")"
check "Image metadata persisted with alt text" "Smoke test pixel" "$(acurl "$API/document-sections/$SECTION_ID/media/images" | jq -r '.[0].altText // empty')"
VIDEO="$(json acurl -X POST "$API/document-sections/$SECTION_ID/media/videos" --data '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ","caption":"[SMOKE] video"}')"
EMBED_URL="$(jq -r '.embedUrl // empty' <<<"$VIDEO")"
[[ -n "$EMBED_URL" ]] && pass "Supported YouTube embed is accepted" || fail "Supported YouTube embed is accepted" "$(head -c 200 <<<"$VIDEO")"
check "Unsafe video URL is rejected" "400" "$(code json acurl -X POST "$API/document-sections/$SECTION_ID/media/videos" --data '{"url":"javascript:alert(1)"}')"
check "Video embed persisted" "youtube" "$(acurl "$API/document-sections/$SECTION_ID/media/videos" | jq -r '.[0].provider // empty')"
# Place both in the section body exactly as the editor does, then reload.
MEDIA_HTML="$RICH<p><img src=\"$IMG_URL\" alt=\"Smoke test pixel\" title=\"Smoke caption\"></p><div data-video-embed=\"true\"><iframe src=\"$EMBED_URL\" title=\"Smoke video\"></iframe></div>"
check "Save section with inline image and video" "200" "$(code json acurl -X PATCH "$API/document-sections/$SECTION_ID" --data "$(jq -cn --arg c "$MEDIA_HTML" '{content: $c, contentFormat: "html"}')")"
SAVED="$(acurl "$API/document-sections/$SECTION_ID" | jq -r '.content')"
if grep -q "$IMG_URL" <<<"$SAVED" && grep -q 'youtube-nocookie.com/embed/aqz-KE-bpKQ' <<<"$SAVED"; then pass "Inline image and video survive reload"; else fail "Inline image and video survive reload" "$(head -c 300 <<<"$SAVED")"; fi

section "6. Ownership and isolation probes"
check "Unknown project id is 404" "404" "$(code acurl "$API/projects/$RANDOM_ID")"
check "Unknown section media is 404" "404" "$(code acurl "$API/document-sections/$RANDOM_ID/media/images")"
check "Unowned export file is not served" "404" "$(code acurl "$API/exports/download/not-an-owned-export.pdf")"
check "Path traversal in export download is rejected" "400" "$(code acurl "$API/exports/download/..%2Fpackage.json")"

section "7. Export generation and download"
for fmt in docx pdf html md txt; do
  EXP_ID="$(json acurl -X POST "$API/projects/$PROJECT_ID/exports" --data "{\"format\":\"$fmt\"}" | jq -r '.id // empty')"
  FILE_URL=""
  for _ in $(seq 1 30); do
    STATE="$(acurl "$API/exports/$EXP_ID")"
    [[ "$(jq -r '.status' <<<"$STATE")" == "completed" ]] && FILE_URL="$(jq -r '.fileUrl' <<<"$STATE")" && break
    [[ "$(jq -r '.status' <<<"$STATE")" == "failed" ]] && break
    sleep 2
  done
  if [[ -z "$FILE_URL" ]]; then fail "Export $fmt completes" "$(head -c 200 <<<"$STATE")"; continue; fi
  check "Download $fmt export" "200" "$(acurl "$BASE_URL$FILE_URL" -o "$WORK/export.$fmt" -w "%{http_code}")"
  case "$fmt" in
    docx)
      [[ "$(head -c 2 "$WORK/export.$fmt")" == "PK" ]] && pass "DOCX has a ZIP signature" || fail "DOCX has a ZIP signature" "bad header"
      grep -aq "word/media/" "$WORK/export.$fmt" && pass "DOCX embeds the inline image" || fail "DOCX embeds the inline image" "no word/media entry" ;;
    pdf)
      [[ "$(head -c 4 "$WORK/export.$fmt")" == "%PDF" ]] && pass "PDF has a %PDF signature" || fail "PDF has a %PDF signature" "bad header"
      grep -aq "/Subtype /Image" "$WORK/export.$fmt" && pass "PDF embeds the inline image" || fail "PDF embeds the inline image" "no image XObject" ;;
    html)
      grep -q "Smoke heading" "$WORK/export.$fmt" && pass "html export contains the saved section" || fail "html export contains the saved section" "content missing"
      grep -q "data:image/png;base64," "$WORK/export.$fmt" && pass "html export embeds the image" || fail "html export embeds the image" "no data URL" ;;
    *)
      grep -q "Smoke heading" "$WORK/export.$fmt" && pass "$fmt export contains the saved section" || fail "$fmt export contains the saved section" "content missing"
      grep -q "\[Image: Smoke test pixel" "$WORK/export.$fmt" && grep -q "watch?v=aqz-KE-bpKQ" "$WORK/export.$fmt" && pass "$fmt export labels the image and links the video" || fail "$fmt export labels the image and links the video" "media missing" ;;
  esac
  check "Anonymous download of $fmt export is 401" "401" "$(code ncurl "$BASE_URL$FILE_URL")"
done

section "8. Grant Studio, workspace and background jobs"
META="$(acurl "$API/grants/meta" -w "\n%{http_code}")"
check "GET /api/grants/meta returns 200" "200" "$(tail -n1 <<<"$META")"
META="$(sed '$d' <<<"$META")"
OPPS="$(jq -r '.opportunities // 0' <<<"$META" 2>/dev/null || echo 0)"
log "  publishable opportunities: $OPPS ($(jq -r '[.sources[]? | "\(.label) \(.opportunities)"] | join(", ")' <<<"$META" 2>/dev/null))"
log "  last sync run: $(jq -c '.lastSync | if . then {source, status, startedAt, fetched, upserted} else null end' <<<"$META" 2>/dev/null); sync queued or running: $(jq -r '.syncRunning' <<<"$META" 2>/dev/null)"
log "  AI provider: $(jq -r '.aiProvider' <<<"$META" 2>/dev/null)"
if [[ "$REQUIRE_GRANTS" == "1" ]]; then
  if [[ "$OPPS" =~ ^[0-9]+$ && "$OPPS" -ge 1 ]]; then pass "Grant sources have publishable opportunities"; else fail "Grant sources have publishable opportunities" "$OPPS"; fi
  check "The most recent grant sync run did not fail" "no" "$(jq -r 'if .lastSync.status == "failed" then "yes" else "no" end' <<<"$META" 2>/dev/null)"
else
  log "  (SMOKE_REQUIRE_GRANTS=0: grant data recorded, not enforced)"
fi
check "GET /api/grants/opportunities returns 200" "200" "$(code acurl "$API/grants/opportunities")"
TEMPLATES="$(acurl "$API/grants/templates" | jq -r '(.templates // []) | length' 2>/dev/null || echo 0)"
if [[ "$TEMPLATES" =~ ^[0-9]+$ && "$TEMPLATES" -ge 1 ]]; then pass "Application templates are listed ($TEMPLATES)"; else fail "Application templates are listed" "$TEMPLATES"; fi

APPLICANT_ID="$(json acurl -X POST "$API/grants/applicants" --data "$(jq -cn --arg n "[SMOKE] Grant Studio $STAMP" '{name: $n, applicantType: "nonprofit_501c3", state: "CA", mission: "Production smoke test organization. Not a real applicant.", focusAreas: ["smoke test"]}')" | jq -r '.id // empty')"
[[ -n "$APPLICANT_ID" ]] && pass "Create [SMOKE] Grant Studio organization" || fail "Create [SMOKE] Grant Studio organization" "no id"
check "Organization is readable after creation" "[SMOKE] Grant Studio $STAMP" "$(acurl "$API/grants/applicants/$APPLICANT_ID" | jq -r '.name // .applicant.name // empty')"
FACT_BODY="[SMOKE] Synthetic fact for the production smoke test."
FACT_ID="$(json acurl -X POST "$API/grants/applicants/$APPLICANT_ID/facts" --data "$(jq -cn --arg b "$FACT_BODY" '{category: "other", label: "[SMOKE] Fact", body: $b, confirmed: false}')" | jq -r '.id // empty')"
check "Unconfirmed fact persists" "$FACT_BODY" "$(acurl "$API/grants/applicants/$APPLICANT_ID/facts" | jq -r --arg f "$FACT_ID" '(.facts // .)[]? | select(.id == $f) | .body')"
check "Record a place designation" "200" "$(code json acurl -X PUT "$API/grants/applicants/$APPLICANT_ID/places/opportunity_zone" --data "$(jq -cn --arg d "$(date -u +%F)" '{status: "not_in", place: "[SMOKE] synthetic place", checkedOn: $d, note: "Production smoke test"}')")"
check "Place designation persists" "not_in" "$(acurl "$API/grants/applicants/$APPLICANT_ID" | jq -r '(.places // .applicant.places // [])[] | select(.key == "opportunity_zone") | .record.status')"
check "Matching runs for the organization" "200" "$(code acurl "$API/grants/applicants/$APPLICANT_ID/matches")"
check "DELETE [SMOKE] Grant Studio organization" "204" "$(code acurl -X DELETE "$API/grants/applicants/$APPLICANT_ID")"
check "Deleted organization is gone" "404" "$(code acurl "$API/grants/applicants/$APPLICANT_ID")"
APPLICANT_ID=""

check "GET /api/workspace reports the owner role" "owner" "$(acurl "$API/workspace" | jq -r '.role // empty')"
SMOKE_EMAIL="smoke-$(tr '[:upper:]' '[:lower:]' <<<"$STAMP")@example.invalid"
INVITE="$(json acurl -X POST "$API/workspace/invites" --data "$(jq -cn --arg e "$SMOKE_EMAIL" '{email: $e, role: "viewer"}')")"
INVITE_ID="$(jq -r '.id // empty' <<<"$INVITE")"
INVITE_TOKEN="$(jq -r '.invitePath // empty' <<<"$INVITE" | sed 's#^/invite/##')"
[[ -n "$INVITE_ID" && -n "$INVITE_TOKEN" ]] && pass "Create a [SMOKE] viewer invitation (never accepted)" || fail "Create a [SMOKE] viewer invitation" "$(head -c 200 <<<"$INVITE")"
check "Invitation link resolves for an anonymous visitor" "viewer" "$(ncurl "$API/auth/invites/$INVITE_TOKEN" | jq -r '.role // empty')"
check "Withdraw the invitation" "204" "$(code acurl -X DELETE "$API/workspace/invites/$INVITE_ID")"
INVITE_ID=""
check "Withdrawn invitation link no longer works" "404" "$(code ncurl "$API/auth/invites/$INVITE_TOKEN")"
check "Audit log records the invitation" "1" "$(acurl "$API/workspace/audit" | jq -r --arg e "$SMOKE_EMAIL" '[(.entries // [])[] | select((.description // "") | contains($e))] | if length >= 1 then 1 else 0 end')"

check "Jobs list requires admin elevation" "403" "$(code acurl "$API/jobs")"
check "Admin unlock with the admin password" "200" "$(code json acurl -X POST "$API/auth/admin-unlock" --data "$(jq -cn --arg p "$SMOKE_ADMIN_PASSWORD" '{password: $p}')")"
JOBS="$(acurl "$API/jobs")"
check "Background job worker is enabled" "true" "$(jq -r '.workerEnabled' <<<"$JOBS" 2>/dev/null)"
log "  job counts: $(jq -c '.counts' <<<"$JOBS" 2>/dev/null)"
log "  recent grant_sync jobs: $(jq -c '[(.jobs // [])[] | select(.kind == "grant_sync") | {status, attempts, createdAt}] | .[0:3]' <<<"$JOBS" 2>/dev/null)"
check "Admin lock" "200" "$(code acurl -X POST "$API/auth/admin-lock")"

section "9. Logout ends the session"
check "Logout" "200" "$(code acurl -X POST "$API/auth/logout")"
check "Data routes reject the logged-out session" "401" "$(code acurl "$API/projects")"
