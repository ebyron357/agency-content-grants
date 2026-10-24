# GO / NO-GO Decision

**Current decision record. Date: 2 October 2026.** It replaces the 12 August 2026 closeout-authorisation decision, archived verbatim at [`history/GO_NO_GO_DECISION_2026-08-12.md`](history/GO_NO_GO_DECISION_2026-08-12.md). Evidence for every statement below is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Decision

| Scope | Decision |
|---|---|
| Release candidate on `main` (reviewed code SHA `3537357888e98b6a519e4665a019c1df863fd6e6`, merged via PR #16) | **GO — VERIFIED COMPLETE** |
| Production | **NO-GO — one owner-only blocker: the Render production environment has not been created** |
| Closure state (per [`PROJECT_COMPLETION_STANDARD.md`](PROJECT_COMPLETION_STANDARD.md) §44) | **BLOCKED — OWNER ACTION REQUIRED** |

## The only remaining blocker

Production requires paid Render resources (web service, PostgreSQL, persistent disk) in the owner's Render account and owner-held secrets (`ADMIN_PASSWORD` and an AI provider key, without which `/api/readyz` reports `not_ready` in production). No agent has Render credentials or billing authority, and none may create paid resources without owner approval.

**Owner action:** in Render, **New → Blueprint** → `ebyron357/agency-content-grants`, branch `main` → approve the plan charges → enter `ADMIN_PASSWORD` and `OPENAI_API_KEY`.

## What changes the decision to PRODUCTION GO

All of the following, recorded in `PROJECT_STATUS.md`, Issue #8 and ClickUp `86e2tjzyc`:

1. Render reports the service live on the `main` release commit.
2. `tests/production-smoke.sh` passes against the production URL with `EXPECTED_SHA` set to that commit (health, readiness, SHA parity, authentication/session, anonymous rejection, persistence, media, export, ownership probes, logout, cleanup).
3. Render logs for the service show no unexpected errors during the smoke run.
4. The rollback path is confirmed available in Render (previous deploy listed under **Events**, or a re-deploy of the prior commit).

If any check fails, the decision stays NO-GO until the failure is fixed through a reviewed PR or the deploy is rolled back.

## Resolved items (no longer blockers)

Kept here so earlier records are not mistaken for open work: canonical repository confirmed (`ebyron357/agency-content-grants`); recovery baseline merged (PRs #4, #5); implementation lanes PR #9 and PR #10 superseded and closed; canonical closeout merged (PR #11); CI hardening merged (PRs #12, #13); release hygiene and security CI merged (PR #15); Issue #8 UI/UX system lock, dependency advisories, `/api/auth/me` admin state, deployment-parity reporting and production smoke tooling merged (PR #16); accessibility automated in CI across all primary routes; Replit is reference evidence only and is not a deployment target.

## Standing rules

These continue to apply after production GO:

- Never weaken tests, typecheck, authentication, ownership checks, database safety guards, secret scanning or CI to obtain a pass.
- Never commit secrets, real customer data or credentials. Production secrets live only in the Render environment.
- Production smoke tests use clearly labelled synthetic records and delete them.
- No purchases, billing changes or new paid services without explicit owner approval.
- Grant/proposal intelligence remains deferred; building it requires a new owner decision.
