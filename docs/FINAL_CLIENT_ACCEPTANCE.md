# Final Acceptance Checklist

Status as of **2 October 2026** for release candidate `3537357888e98b6a519e4665a019c1df863fd6e6`. Evidence references point to [`PROJECT_STATUS.md`](PROJECT_STATUS.md) gate numbers. Items marked **PENDING — production** can only be completed after the owner creates the Render environment.

## A. Agent-verified before production

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| A1 | One coherent dark UI system across every authenticated route, desktop and mobile | PASS | Gate 1; `docs/evidence/ui/closeout-2026-10-02/` |
| A2 | Primary routes keyboard-usable with visible focus, labelled controls, readable contrast, reduced-motion support | PASS | Gate 11; `docs/DESIGN_SYSTEM.md` |
| A3 | Create a long-form document from an intent (brief → research → outline → draft → quality) | PASS | Gates 10, 27 |
| A4 | Manual/guide with multiple sections created and persisted | PASS | Gates 19, 27 (guide and manual projects) |
| A5 | Rich formatting survives save and reload; unsafe markup removed | PASS | Gate 20 |
| A6 | Image upload with alt text persists and renders after reload; owner-only | PASS | Gate 21 |
| A7 | Supported video embed persists; unsafe links rejected | PASS | Gate 22 |
| A8 | Export to DOCX, PDF, HTML, Markdown, TXT with valid files | PASS | Gate 23 |
| A9 | Unauthenticated access rejected; ownership enforced; path traversal rejected | PASS | Gates 17, 18 |
| A10 | Data survives a service restart | PASS | Gate 19 |
| A11 | Health, readiness and running-commit reporting work in production mode | PASS | Gates 24, 25 |
| A12 | Rollback to the previous release works on the same database and disk | PASS | Gate 26 |
| A13 | All CI gates green; no known dependency vulnerabilities; no committed secrets | PASS | Gates 2–15 |
| A14 | Operator, user, security, deployment, data and support documentation complete | PASS | `PROJECT_STATUS.md` → Documentation |

## B. Production acceptance (owner + operator)

| # | Acceptance item | Result | How to verify |
|---|---|---|---|
| B1 | Render environment created from `render.yaml`, secrets set | PENDING — production (owner action) | Runbook §3 |
| B2 | Deployed commit equals the `main` release commit | PENDING — production | `tests/production-smoke.sh` with `EXPECTED_SHA` |
| B3 | Production smoke passes with 0 failures and leaves no `[SMOKE]` records | PENDING — production | Runbook §4 |
| B4 | No unexpected errors in Render logs during smoke | PENDING — production | Render → Logs |
| B5 | Owner signs in from their own browser and opens Dashboard and a document | PENDING — production | Manual |
| B6 | Rollback option visible in Render Events | PENDING — production | Render → Events |
| B7 | First logical database backup taken and stored outside Render | PENDING — production | Runbook §7 |
| B8 | Access register and handoff template completed | PENDING — production | `SECURITY_AND_ACCESS_HANDOFF.md` §4; `CLIENT_ACCESS_HANDOFF_TEMPLATE.md` |

## C. Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Owner | Emmanuel Andre Byron | Accept / Reject | |
| Client (if applicable) | | Accept / Reject | |

When every B item is PASS, update `PROJECT_STATUS.md` and `GO_NO_GO_DECISION.md` to **PRODUCTION GO**, and record the result on Issue #8 and ClickUp `86e2tjzyc`.
