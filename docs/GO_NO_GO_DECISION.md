# GO / NO-GO Decision

**Current decision record. Updated: 4 November 2026. Production evidence remains dated 26 October.** It replaces the 2 October 2026 decision, archived verbatim at [`history/GO_NO_GO_DECISION_2026-10-02.md`](history/GO_NO_GO_DECISION_2026-10-02.md). Evidence for every statement below is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Decision

| Scope | Decision |
|---|---|
| Grant information directory | **Merged to `main` as `3221c7b` (PR #26, 2 November); validation passed; not deployed.** See `GRANT_RESOURCES.md`; no production promotion is implied |
| Content Machine release scope (Issue #8 and the approved closeout) | **GO — VERIFIED COMPLETE** (unchanged since 2 October) |
| Production environment | **LIVE on `6d9f488`** (PR #23 merge, which includes the PR #22 security headers); `main` has since advanced to `3221c7b`. Health, readiness, SHA parity, anonymous rejection and security headers verified anonymously on 26 October |
| Dependency audit (pre-deploy, 4 November) | **PASS at the CI gate** — 0 critical, 0 high on `3221c7b`; 2 moderate (`qs` runtime, assessed not reachable; `minimatch` dev-only). Evidence: `evidence/security/2026-11-04/README.md` |
| Production GO | **NO-GO — pending owner deploy and authenticated verification.** No code change is required; the owner's deploy of `3221c7b` (recommended), the `ADMIN_PASSWORD`-authenticated smoke test and Render log review have not been recorded |
| Closure state (per [`PROJECT_COMPLETION_STANDARD.md`](PROJECT_COMPLETION_STANDARD.md) §44) | **BLOCKED — OWNER ACTION REQUIRED** (deploy of `3221c7b`, authenticated smoke verification and records) |

## Remaining steps to PRODUCTION GO

1. ~~Merge the dependency fix~~ — done: PR #23 merged as `6d9f488` on 24 October with CI green.
2. ~~Deploy `main`~~ — done: `/api/healthz` reports `6d9f488` (checked 26 October).
3. ~~Pre-deploy dependency audit~~ — done 4 November on `3221c7b`: high gate passes, 2 moderate advisories recorded. Optional: merge a focused PR raising the `qs` override to `^6.16.1` first; deploy that merge commit instead and use its SHA below.
4. **Owner:** trigger the Render manual deploy of `main` `3221c7b` (adds the grant directory) and confirm `/api/healthz` reports it. Skipping this is allowed, but then the smoke run below uses `6d9f4887a28d8caec52e2e32c11e61d4a74059f4` and must be repeated after the next deploy.
5. Run `tests/production-smoke.sh` against `https://agency-content-grants.onrender.com` with `EXPECTED_SHA` set to the deployed commit (`3221c7bcd150d1f88664d398f871d1f397e62afc` after step 4) (health, readiness, SHA parity, security headers, authentication/session, anonymous rejection, persistence, media, export, ownership probes, logout, cleanup). It needs `ADMIN_PASSWORD`, so the owner or an operator holding it runs it. Runbook §4.
6. Confirm Render logs show no unexpected errors during the smoke run, and the previous deploy is listed under **Events** for rollback.
7. Record the result in `PROJECT_STATUS.md`, this file, Issue #8 and ClickUp `86e2tjzyc`; on a pass, change the decision to **PRODUCTION GO** and close Issue #8.

If any check fails, the decision stays NO-GO until the failure is fixed through a reviewed PR or the deploy is rolled back to the previous production deploy (`6d9f488` if step 4 was performed, otherwise `d9a06e7`).

## Resolved items (no longer blockers)

Render environment created by the owner and serving production (verified 22, 24 and 26 October); HTTP security headers merged (PR #22) and late-October advisories cleared (PR #23), both deployed as `6d9f488`; October dependency advisories cleared (PRs #18, #19) and Render database sized for the $20/month baseline (PR #21). Earlier items: canonical repository confirmed (`ebyron357/agency-content-grants`); recovery baseline merged (PRs #4, #5); implementation lanes PR #9 and PR #10 superseded and closed; canonical closeout merged (PR #11); CI hardening merged (PRs #12, #13); release hygiene and security CI merged (PR #15); Issue #8 UI/UX system lock, `/api/auth/me` admin state, deployment-parity reporting and production smoke tooling merged (PR #16); accessibility automated in CI across all primary routes; Replit is reference evidence only and is not a deployment target.

## Standing rules

These continue to apply after production GO:

- Never weaken tests, typecheck, authentication, ownership checks, database safety guards, secret scanning or CI to obtain a pass.
- Never commit secrets, real customer data or credentials. Production secrets live only in the Render environment.
- Production smoke tests use clearly labelled synthetic records and delete them.
- No purchases, billing changes or new paid services without explicit owner approval.
- The owner authorized the curated grant information directory on November 2. Automated matching, proposal generation, applicant data and submissions remain deferred.
