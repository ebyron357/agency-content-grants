# GO / NO-GO Decision

**Current decision record. Updated: 4 November 2026 (post-merge audit). Production re-checked anonymously on 4 November.** It replaces the 2 October 2026 decision, archived verbatim at [`history/GO_NO_GO_DECISION_2026-10-02.md`](history/GO_NO_GO_DECISION_2026-10-02.md). Evidence for every statement below is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Decision

| Scope | Decision |
|---|---|
| Content Machine release scope (Issue #8 and the approved closeout) | **GO — VERIFIED COMPLETE** (unchanged since 2 October; Issue #8 closed by the owner on 24 October) |
| Grant information directory | **Merged to `main` (`3221c7b`, PR #26); validation passed; not deployed** |
| Grant Studio (PRs #29–#33) | **NOT APPROVED — owner scope decision pending.** Outside the approved scope in `AGENTS.md`; must not merge or deploy without it |
| Release candidate | **`main` `0131ba338af115ab5d8c7a5c11094550e948dc9f`** (or a later documentation-only merge). Includes the grant directory and the `qs` override fix (PR #35) |
| Production environment | **LIVE on `6d9f488`** (PR #23 merge). Health, readiness, SHA report, anonymous rejection and security headers verified anonymously on 4 November |
| Dependency audit (post-merge, 4 November) | **PASS** — 0 critical, 0 high; production dependencies clean; 1 moderate (`minimatch`, dev/codegen only, deferred) |
| Repository controls | **GAP** — `main` has no branch protection; the CI gate is policy, not enforced |
| Production GO | **NO-GO — pending owner deploy and authenticated verification.** No code change is required |
| Closure state (per [`PROJECT_COMPLETION_STANDARD.md`](PROJECT_COMPLETION_STANDARD.md)) | **BLOCKED — OWNER ACTION REQUIRED** (deploy, authenticated smoke verification, branch protection and records) |

## Remaining steps to PRODUCTION GO

1. ~~Merge the dependency fixes~~ — done: PR #23 (`6d9f488`, 24 October) and PR #35 (`qs` override, `e1e7df1`, 4 November); PR #25 closed as superseded.
2. ~~Pre-deploy dependency audit~~ — done 4 November on `0131ba3`: high gate passes, production dependencies clean.
3. **Owner:** enable branch protection on `main` requiring a PR and the CI checks **Format, typecheck, tests, build** and **Secret scan, dependency audit, SBOM**.
4. **Owner:** trigger the Render manual deploy of the current `main` head and confirm `/api/healthz` reports it.
5. Run `tests/production-smoke.sh` against `https://agency-content-grants.onrender.com` with `EXPECTED_SHA` set to the full SHA from step 4 (health, readiness, SHA parity, security headers, authentication/session, anonymous rejection, persistence, media, export, ownership probes, logout, cleanup). It needs `ADMIN_PASSWORD`, so the owner or an operator holding it runs it. Runbook §4.
6. Confirm Render logs show no unexpected errors during the smoke run, and the previous deploy (`6d9f488`) is listed under **Events** for rollback.
7. Record the result in `PROJECT_STATUS.md`, this file and ClickUp `86e2tjzyc`; on a pass, change the decision to **PRODUCTION GO**.

If any check fails, the decision stays NO-GO until the failure is fixed through a reviewed PR or the deploy is rolled back to `6d9f488`.

## Resolved items (no longer blockers)

Issue #8 closed as completed (24 October); `qs` advisory cleared (PR #35) and superseded PR #25 closed (4 November); merged branches cleaned up (4 November); Render environment created by the owner and serving production (verified 22, 24 and 26 October and 4 November); HTTP security headers merged (PR #22) and late-October advisories cleared (PR #23), both deployed as `6d9f488`; October dependency advisories cleared (PRs #18, #19) and Render database sized for the $20/month baseline (PR #21). Earlier items: canonical repository confirmed (`ebyron357/agency-content-grants`); recovery baseline merged (PRs #4, #5); implementation lanes PR #9 and PR #10 superseded and closed; canonical closeout merged (PR #11); CI hardening merged (PRs #12, #13); release hygiene and security CI merged (PR #15); Issue #8 UI/UX system lock, `/api/auth/me` admin state, deployment-parity reporting and production smoke tooling merged (PR #16); accessibility automated in CI across all primary routes; Replit is reference evidence only and is not a deployment target.

## Standing rules

These continue to apply after production GO:

- Never weaken tests, typecheck, authentication, ownership checks, database safety guards, secret scanning or CI to obtain a pass.
- Never commit secrets, real customer data or credentials. Production secrets live only in the Render environment.
- Production smoke tests use clearly labelled synthetic records and delete them.
- No purchases, billing changes or new paid services without explicit owner approval.
- The owner authorized the curated grant information directory on November 2. Automated matching, proposal generation, applicant data and submissions remain deferred unless the owner approves Grant Studio.
