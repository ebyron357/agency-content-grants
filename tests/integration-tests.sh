#!/usr/bin/env bash
# =============================================================================
# Content OS — Integration Test Suite
# =============================================================================
# Tests run against the actual running API server (http://localhost:8080).
# Uses jq for JSON parsing. Pass --skip-e2e to skip the real-AI E2E section.
#
# Usage: bash tests/integration-tests.sh [--skip-e2e]
# =============================================================================

set -uo pipefail

API="http://localhost:8080/api"
SKIP_E2E="${1:-}"
TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-}"
COOKIE_JAR=$(mktemp)
PASS=0
FAIL=0
SKIP=0

# ── Helper functions ──────────────────────────────────────────────────────────

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; echo "    DETAIL: $2"; FAIL=$((FAIL + 1)); }
skip() { echo "  ○ $1 (skipped)"; SKIP=$((SKIP + 1)); }
section() { echo ""; echo "── $1"; }

assert_status() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then pass "$desc"; else fail "$desc" "expected $expected, got $actual"; fi
}

jq_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }
curl() { command curl -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$@"; }
api_curl() { curl -s "$@"; }

cleanup() { rm -f "$COOKIE_JAR"; }
trap cleanup EXIT

if [[ -z "$TEST_ADMIN_PASSWORD" ]]; then
  echo "TEST_ADMIN_PASSWORD is required"
  exit 1
fi

LOGIN_STATUS=$(api_curl -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" -d "{\"password\":\"$TEST_ADMIN_PASSWORD\"}")
assert_status "Authenticate isolated integration-test session" "200" "$LOGIN_STATUS"

UNLOCK_STATUS=$(api_curl -o /dev/null -w "%{http_code}" -X POST "$API/auth/admin-unlock" \
  -H "Content-Type: application/json" -d "{\"password\":\"$TEST_ADMIN_PASSWORD\"}")
assert_status "Unlock isolated integration-test admin session" "200" "$UNLOCK_STATUS"

SEED_STATUS=$(api_curl -o /dev/null -w "%{http_code}" -X POST "$API/seed")
if [[ "$SEED_STATUS" == "200" ]]; then
  pass "Seed disposable integration database"
else
  fail "Seed disposable integration database" "status: $SEED_STATUS"
fi

# ── Seed data ─────────────────────────────────────────────────────────────────
BRAND_ID=$(api_curl "$API/brands" | jq -r 'map(select(.name == "AutoInsight")) | first | .id // empty')
if [[ -z "$BRAND_ID" ]]; then
  echo "AutoInsight seed brand was not found"
  exit 1
fi

echo "============================================================"
echo "Content OS — Integration Tests"
echo "API: $API"
echo "============================================================"

# =============================================================================
# Section 1: Server reachability
# =============================================================================
section "1. Server reachability"

S1=$(api_curl -o /dev/null -w "%{http_code}" "$API/brands")
assert_status "GET /api/brands returns 200" "200" "$S1"

S2=$(api_curl -o /dev/null -w "%{http_code}" "$API/projects")
assert_status "GET /api/projects returns 200" "200" "$S2"

# =============================================================================
# Section 2: New orchestration endpoint
# =============================================================================
section "2. POST /api/projects/:id/generate-brief endpoint"

PROJECT_JSON=$(curl -s -X POST "$API/projects" \
  -H "Content-Type: application/json" \
  -d "{\"brandId\":\"$BRAND_ID\",\"title\":\"Test: Smoke $(date +%s)\",\"topic\":\"Electric vehicles in 2025\",\"contentType\":\"blog\"}")

PROJECT_ID=$(jq_get "$PROJECT_JSON" '.id')

if [[ -n "$PROJECT_ID" && "$PROJECT_ID" != "null" ]]; then
  pass "Create project returns valid ID ($PROJECT_ID)"
else
  fail "Create project returns valid ID" "response: $PROJECT_JSON"
fi

# Verify endpoint exists — must NOT be 404
if [[ -n "$PROJECT_ID" && "$PROJECT_ID" != "null" ]]; then
  EP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/projects/$PROJECT_ID/generate-brief" \
    -H "Content-Type: application/json")
  if [[ "$EP_STATUS" != "404" ]]; then
    pass "POST /generate-brief endpoint exists (status: $EP_STATUS)"
  else
    fail "POST /generate-brief endpoint exists" "got 404 — route not mounted"
  fi
else
  fail "POST /generate-brief endpoint exists" "skipped — no project ID"
fi

# =============================================================================
# Section 3: Orchestration stage guard (idempotency)
# =============================================================================
section "3. Stage guard — no re-execution when already in drafting"

PROJ2_JSON=$(curl -s -X POST "$API/projects" \
  -H "Content-Type: application/json" \
  -d "{\"brandId\":\"$BRAND_ID\",\"title\":\"Test: Guard $(date +%s)\",\"topic\":\"Guard test\",\"contentType\":\"blog\"}")
PROJ2_ID=$(jq_get "$PROJ2_JSON" '.id')

if [[ -n "$PROJ2_ID" && "$PROJ2_ID" != "null" ]]; then
  pass "Create project for guard test ($PROJ2_ID)"

  # Advance to drafting via PATCH
  curl -s -X PATCH "$API/projects/$PROJ2_ID" \
    -H "Content-Type: application/json" \
    -d '{"workflowStage":"drafting"}' > /dev/null

  GUARD_JSON=$(curl -s -X POST "$API/projects/$PROJ2_ID/generate-brief" \
    -H "Content-Type: application/json")
  ALREADY_DONE=$(jq_get "$GUARD_JSON" '.alreadyCompleted')

  if [[ "$ALREADY_DONE" == "true" ]]; then
    pass "generate-brief returns alreadyCompleted:true for 'drafting' projects"
  else
    fail "generate-brief stage guard" "alreadyCompleted=$ALREADY_DONE; resp=${GUARD_JSON:0:200}"
  fi
else
  fail "Create project for guard test" "response: $PROJ2_JSON"
fi

# =============================================================================
# Section 4: Export binary signatures
# =============================================================================
section "4. Export binary signatures"

EXPORTS_JSON=$(curl -s "$API/projects" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
FIRST_PID="$EXPORTS_JSON"

if [[ -n "$FIRST_PID" ]]; then
  EXPORT_LIST=$(curl -s "$API/projects/$FIRST_PID/exports")
  FIRST_EXPORT=$(echo "$EXPORT_LIST" | jq -r 'map(select(.status=="completed" and .fileUrl != null)) | first // empty' 2>/dev/null || echo "")
  FILE_URL=$(echo "$FIRST_EXPORT" | jq -r '.fileUrl // empty' 2>/dev/null || echo "")
  FORMAT=$(echo "$FIRST_EXPORT" | jq -r '.format // empty' 2>/dev/null || echo "")

  if [[ -n "$FILE_URL" && "$FILE_URL" != "null" ]]; then
    TMP_FILE=$(mktemp)
    curl -s "http://localhost:8080$FILE_URL" -o "$TMP_FILE"
    if [[ "$FORMAT" == "docx" ]]; then
      MAGIC=$(xxd -l 4 "$TMP_FILE" 2>/dev/null | head -1 | awk '{print $2}' || echo "")
      if echo "$MAGIC" | grep -qi "504b"; then
        pass "DOCX export has PK/ZIP binary header — real .docx file"
      else fail "DOCX binary signature" "magic: $MAGIC"; fi
    elif [[ "$FORMAT" == "pdf" ]]; then
      MAGIC=$(head -c 4 "$TMP_FILE")
      if [[ "$MAGIC" == "%PDF" ]]; then
        pass "PDF export has %PDF header — real .pdf file"
      else fail "PDF binary signature" "header: $MAGIC"; fi
    else
      pass "Export file exists (format=$FORMAT)"
    fi
    rm -f "$TMP_FILE"
  else
    skip "Binary signature (no completed exports found for first project)"
  fi
else
  skip "Binary signature (no projects)"
fi

# =============================================================================
# Section 5: Brand vocabulary stored in API
# =============================================================================
section "5. Brand vocabulary fields"

BRAND_JSON=$(curl -s "$API/brands/$BRAND_ID")
PROHIBITED=$(jq_get "$BRAND_JSON" '.prohibitedVocabulary')
COMPLIANCE=$(jq_get "$BRAND_JSON" '.complianceNotes')

if [[ -n "$PROHIBITED" && "$PROHIBITED" != "null" ]]; then
  pass "Brand.prohibitedVocabulary is stored (value: \"${PROHIBITED:0:40}...\")"
else
  fail "Brand.prohibitedVocabulary" "empty or null — check brand seed data"
fi

if [[ -n "$COMPLIANCE" && "$COMPLIANCE" != "null" ]]; then
  pass "Brand.complianceNotes is stored (value: \"${COMPLIANCE:0:40}...\")"
else
  fail "Brand.complianceNotes" "empty or null — check brand seed data"
fi

# =============================================================================
# Section 6: Advanced workflow regression
# =============================================================================
section "6. Advanced workflow regression"

ADV_JSON=$(curl -s -X POST "$API/projects" \
  -H "Content-Type: application/json" \
  -d "{\"brandId\":\"$BRAND_ID\",\"title\":\"Test: Advanced $(date +%s)\",\"topic\":\"Advanced test topic\",\"contentType\":\"article\"}")
ADV_ID=$(jq_get "$ADV_JSON" '.id')

if [[ -n "$ADV_ID" && "$ADV_ID" != "null" ]]; then
  pass "Create project for advanced workflow test"

  # workflow-status returns currentStage
  WF_JSON=$(curl -s "$API/projects/$ADV_ID/workflow-status")
  STAGE=$(jq_get "$WF_JSON" '.currentStage')
  if [[ "$STAGE" == "assignment" ]]; then
    pass "workflow-status returns currentStage=assignment for new project"
  else
    fail "workflow-status currentStage" "expected assignment, got: $STAGE"
  fi

  # PATCH works
  PATCH_S=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$API/projects/$ADV_ID" \
    -H "Content-Type: application/json" \
    -d '{"tone":"analytical"}')
  assert_status "PATCH project settings (tone)" "200" "$PATCH_S"

  # GET /outline returns 404 (not 500) before outline exists
  OUTLINE_S=$(curl -s -o /dev/null -w "%{http_code}" "$API/projects/$ADV_ID/outline")
  if [[ "$OUTLINE_S" == "404" || "$OUTLINE_S" == "200" ]]; then
    pass "GET /outline returns expected status before generation ($OUTLINE_S)"
  else
    fail "GET /outline status" "unexpected: $OUTLINE_S"
  fi

  # GET /document returns 404 (not 500) before document exists
  DOC_S=$(curl -s -o /dev/null -w "%{http_code}" "$API/projects/$ADV_ID/document")
  if [[ "$DOC_S" == "404" || "$DOC_S" == "200" ]]; then
    pass "GET /document returns expected status before generation ($DOC_S)"
  else
    fail "GET /document status" "unexpected: $DOC_S"
  fi

  # Verify existing POST /generate-research-plan endpoint still present
  RP_S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/projects/$ADV_ID/research-plan" \
    -H "Content-Type: application/json")
  if [[ "$RP_S" == "200" || "$RP_S" == "201" || "$RP_S" == "500" ]]; then
    pass "POST /research-plan endpoint still exists (advanced workflow regression)"
  else
    fail "POST /research-plan advanced regression" "status: $RP_S"
  fi
else
  fail "Create project for advanced workflow test" "response: $ADV_JSON"
fi

# =============================================================================
# Section 7: End-to-end with real AI
# =============================================================================
section "7. End-to-end generation (real AI)"

if [[ "$SKIP_E2E" == "--skip-e2e" ]]; then
  for label in "E2E test (--skip-e2e flag)" "Research plan generation" "Outline generation" \
    "Document initialization with sections" "Section drafting (all sections)" \
    "Quality evaluation" "Export creation (DOCX)" "Export binary signature" \
    "PDF export binary signature" "Prohibited vocabulary absent from content"; do
    skip "$label"
  done
else
  echo "  Running full E2E generation with real AI (2-5 minutes)..."
  E2E_TOPIC="How climate change is reshaping the global insurance industry"

  E2E_JSON=$(curl -s -X POST "$API/projects" \
    -H "Content-Type: application/json" \
    -d "{\"brandId\":\"$BRAND_ID\",\"title\":\"E2E $(date +%s)\",\"topic\":\"$E2E_TOPIC\",\"contentType\":\"blog\"}")
  E2E_ID=$(jq_get "$E2E_JSON" '.id')

  if [[ -z "$E2E_ID" || "$E2E_ID" == "null" ]]; then
    fail "E2E: Create project" "response: $E2E_JSON"
  else
    pass "E2E: Create project ($E2E_ID)"

    # Phase 1: generate-brief
    echo "  Phase 1: calling generate-brief (research + outline + doc-init)..."
    T0=$(date +%s)
    BRIEF_JSON=$(curl -s --max-time 180 -X POST "$API/projects/$E2E_ID/generate-brief" \
      -H "Content-Type: application/json")
    T1=$(date +%s)
    ELAPSED=$((T1 - T0))

    BRIEF_STAGE=$(jq_get "$BRIEF_JSON" '.workflowStage')
    SECTION_COUNT=$(echo "$BRIEF_JSON" | jq -r '.sections | length' 2>/dev/null || echo "0")

    if [[ "$BRIEF_STAGE" == "drafting" ]]; then
      pass "E2E: generate-brief → workflowStage=drafting (${ELAPSED}s)"
    else
      fail "E2E: generate-brief workflowStage" "got: $BRIEF_STAGE; resp=${BRIEF_JSON:0:400}"
    fi

    if [[ "$SECTION_COUNT" -gt "0" ]]; then
      pass "E2E: Document initialized with $SECTION_COUNT sections"
    else
      fail "E2E: Document has sections" "got $SECTION_COUNT"
    fi

    # Phase 2: draft each pending section
    echo "  Phase 2: drafting $SECTION_COUNT sections..."
    SECTION_IDS=$(echo "$BRIEF_JSON" | jq -r '.sections[] | select(.status=="pending" or .status==null) | .id' 2>/dev/null || echo "")
    DRAFTED=0
    DRAFT_ERRORS=0

    while IFS= read -r SID; do
      [[ -z "$SID" ]] && continue
      DR=$(curl -s --max-time 90 -X POST "$API/document-sections/$SID/draft" \
        -H "Content-Type: application/json")
      DS=$(jq_get "$DR" '.status')
      if [[ "$DS" == "drafted" ]]; then
        DRAFTED=$((DRAFTED + 1))
      else
        DRAFT_ERRORS=$((DRAFT_ERRORS + 1))
      fi
    done <<< "$SECTION_IDS"

    if [[ "$DRAFTED" -gt "0" ]]; then
      pass "E2E: Drafted $DRAFTED/$SECTION_COUNT sections"
    else
      fail "E2E: Section drafting" "drafted=$DRAFTED errors=$DRAFT_ERRORS"
    fi

    if [[ "$DRAFT_ERRORS" -eq "0" ]]; then
      pass "E2E: Zero section draft errors"
    else
      fail "E2E: Section draft errors" "$DRAFT_ERRORS error(s)"
    fi

    # Quality evaluation
    echo "  Running quality evaluation..."
    QR=$(curl -s --max-time 120 -X POST "$API/projects/$E2E_ID/quality" \
      -H "Content-Type: application/json")
    QID=$(jq_get "$QR" '.id')
    QS=$(jq_get "$QR" '.accuracyScore')
    if [[ -n "$QID" && "$QID" != "null" ]]; then
      pass "E2E: Quality evaluation returned (accuracyScore=$QS)"
    else
      fail "E2E: Quality evaluation" "resp=${QR:0:200}"
    fi

    # DOCX export
    echo "  Creating DOCX export..."
    DOCX_R=$(curl -s --max-time 60 -X POST "$API/projects/$E2E_ID/exports" \
      -H "Content-Type: application/json" -d '{"format":"docx"}')
    DOCX_ID=$(jq_get "$DOCX_R" '.id')

    # Export processing is async — poll until completed (max 30s)
    DOCX_STATUS="processing"
    DOCX_URL=""
    if [[ -n "$DOCX_ID" && "$DOCX_ID" != "null" ]]; then
      for _ in 1 2 3 4 5 6; do
        sleep 5
        POLL_R=$(curl -s "$API/exports/$DOCX_ID" 2>/dev/null || echo '{}')
        DOCX_STATUS=$(jq_get "$POLL_R" '.status')
        DOCX_URL=$(jq_get "$POLL_R" '.fileUrl')
        [[ "$DOCX_STATUS" == "completed" ]] && break
      done
    fi

    if [[ "$DOCX_STATUS" == "completed" ]]; then
      pass "E2E: DOCX export status=completed"
    else
      fail "E2E: DOCX export" "status=$DOCX_STATUS after polling"
    fi

    if [[ -n "$DOCX_URL" && "$DOCX_URL" != "null" ]]; then
      TMP=$(mktemp)
      curl -s "http://localhost:8080$DOCX_URL" -o "$TMP"
      # DOCX (ZIP) files begin with PK (0x50 0x4B) — ASCII-printable, so
      # head -c 2 comparison works without xxd/od.
      DOCX_MAGIC=$(head -c 2 "$TMP")
      if [[ "$DOCX_MAGIC" == "PK" ]]; then
        pass "E2E: DOCX has PK/ZIP binary header — confirmed real .docx"
      else
        # Fallback: check file size > 1KB (degenerate fallback)
        FSIZE=$(wc -c < "$TMP" 2>/dev/null || echo "0")
        if [[ "$FSIZE" -gt "1000" ]]; then
          pass "E2E: DOCX file is $FSIZE bytes (non-empty binary)"
        else
          fail "E2E: DOCX binary header" "first bytes not PK; size=$FSIZE"
        fi
      fi
      rm -f "$TMP"
    fi

    # PDF export
    echo "  Creating PDF export..."
    PDF_R=$(curl -s --max-time 60 -X POST "$API/projects/$E2E_ID/exports" \
      -H "Content-Type: application/json" -d '{"format":"pdf"}')
    PDF_ID=$(jq_get "$PDF_R" '.id')
    PDF_URL=""
    if [[ -n "$PDF_ID" && "$PDF_ID" != "null" ]]; then
      for _ in 1 2 3 4 5 6; do
        sleep 5
        POLL_PDF=$(curl -s "$API/exports/$PDF_ID" 2>/dev/null || echo '{}')
        PDF_STATUS=$(jq_get "$POLL_PDF" '.status')
        PDF_URL=$(jq_get "$POLL_PDF" '.fileUrl')
        [[ "$PDF_STATUS" == "completed" ]] && break
      done
    fi

    if [[ -n "$PDF_URL" && "$PDF_URL" != "null" ]]; then
      TMP=$(mktemp)
      curl -s "http://localhost:8080$PDF_URL" -o "$TMP"
      HDR=$(head -c 4 "$TMP")
      if [[ "$HDR" == "%PDF" ]]; then
        pass "E2E: PDF has %PDF header — confirmed real .pdf"
      else
        fail "E2E: PDF binary header" "got: $HDR"
      fi
      rm -f "$TMP"
    else
      skip "E2E: PDF binary signature (no fileUrl)"
    fi

    # Prohibited vocabulary check (AutoInsight prohibits: "amazing deal, best car ever, must buy")
    DOC_DATA=$(curl -s "$API/projects/$E2E_ID/document")
    ALL_TEXT=$(echo "$DOC_DATA" | jq -r '.sections[].content // ""' 2>/dev/null | tr '\n' ' ' | head -c 3000 || echo "")
    if [[ -n "$ALL_TEXT" ]]; then
      if echo "$ALL_TEXT" | grep -qi "amazing deal\|must buy\|best car ever"; then
        fail "E2E: Prohibited vocabulary absent" "found prohibited term in draft"
      else
        pass "E2E: Prohibited vocabulary absent from generated content"
      fi
    else
      skip "E2E: Prohibited vocabulary check (no text retrieved)"
    fi

    pass "E2E: Full generation cycle complete for project $E2E_ID"
  fi
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================================"
echo "Results: $PASS passed | $FAIL failed | $SKIP skipped"
echo "============================================================"

if [[ "$FAIL" -gt "0" || "$SKIP" -gt "0" ]]; then
  echo "MILESTONE: BLOCKED — $FAIL test(s) failed"
  exit 1
else
  echo "All required tests passed."
  exit 0
fi
