# GO / NO-GO Decision

**Current decision record. Updated: 4 November 2026, 19:50 UTC. Production evidence is still dated 26 October.** It replaces the earlier 4 November decision, which described `main` as `3221c7b`; that version is archived verbatim at [`history/GO_NO_GO_DECISION_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md`](history/GO_NO_GO_DECISION_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md). Evidence for every statement below is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Decision

| Scope | Decision |
|---|---|
| Content Machine release scope (Issue #8 closeout) | **GO — VERIFIED COMPLETE** (unchanged since 2 October). Issue #8 is closed. |
| Release candidate `main` `997b7356b29f9d0a47028d82569c62d8d854c5ef` | **Technically ready to deploy.** Contents: the grant directory, Grant Studio, accounts and security, background jobs, templates and the `qs` fix (PRs #26–#45). All CI-equivalent gates pass on this exact commit. The upgrade from the production version and a rollback to it were rehearsed, and the smoke test passed 75/75 on both. Evidence: [`evidence/release/2026-11-04/`](evidence/release/2026-11-04/README.md). |
| Place designations and writing toolkit (branch `claude/stoic-hawking-8vvewa`) | **Implemented and validated locally; not merged.** It needs a reviewed PR with `CI` green. If it merges before the deploy, deploy that merge commit instead of `997b735`. Evidence: [`evidence/toolkit/2026-11-04/`](evidence/toolkit/2026-11-04/README.md) |
| Scope and security-model acceptance | **PENDING — owner.** Grant Studio (#29 onward) and the workspace, role and two-factor security model (#40–#42) were merged by `ebyron357`. No written owner approval is recorded, and none of the 16 PRs had a review. |
| Production environment | **LIVE on `6d9f488`** (PR #23 merge). Checked anonymously on 26 October: health, readiness, SHA parity, anonymous rejection and security headers. Not re-checked since. |
| Dependency audit (4 November, `997b735`) | **PASS at the CI gate.** 0 critical, 0 high, 1 moderate (`minimatch`, dev only). |
| Production GO | **NO-GO.** Three things are missing: the owner approvals, the deploy of the candidate, and the authenticated production verification. No code change is required. |
| Closure state ([`PROJECT_COMPLETION_STANDARD.md`](PROJECT_COMPLETION_STANDARD.md) §44) | **BLOCKED — OWNER ACTION REQUIRED** |

## Remaining steps to PRODUCTION GO

1. **Owner: record the approvals.** Add a written statement on GitHub (a PR review or comment) and in ClickUp `86e2tjzyc`. It should either:
   - accept Grant Studio as scope and the workspace, role and two-factor security model, or
   - list the changes required before deploy.
2. **Owner: deploy prerequisites.**
   - In Render → Environment, add `MFA_ENCRYPTION_KEY` (Add → Generate). Never rotate it together with `SESSION_SECRET`.
   - Confirm database point-in-time recovery is available, or take a logical backup (runbook §7).
   - Download a copy of `/var/data`.
3. **Owner: deploy.**
   - Run a Render manual deploy of `997b7356b29f9d0a47028d82569c62d8d854c5ef`, or of a later reviewed `main` commit, and use that SHA below.
   - Confirm `/api/healthz` reports the SHA.
   - Confirm the logs show `[migrate] Migrations complete` for migrations `0016`–`0026` and `Server listening`.
4. **Operator holding `ADMIN_PASSWORD`: smoke test.** Run the smoke test (runbook §4) with this command:

   ```bash
   BASE_URL=https://agency-content-grants.onrender.com SMOKE_ADMIN_PASSWORD='<ADMIN_PASSWORD>' EXPECTED_SHA=<deployed SHA> bash tests/production-smoke.sh
   ```

   It must end `RESULT: N passed, 0 failed`.
5. **Operator: check the new features.**
   - In a browser, sign in with the team password and open Grant Studio.
   - Use **Refresh now** and confirm the sync succeeds (Settings → Jobs).
   - Confirm Settings → Team loads.
6. **Operator: logs and rollback point.**
   - Confirm Render logs show no `"level":50` entries during the run.
   - Confirm memory stays within the plan after the sync.
   - Confirm `6d9f488` is listed under **Events** as the rollback point.
7. **Record the result** in `PROJECT_STATUS.md`, this file, a comment on Issue #8 (attach the smoke evidence file) and ClickUp `86e2tjzyc`. On a pass, change the decision to **PRODUCTION GO**.

If any check fails, the decision stays NO-GO. Fix the failure through a reviewed PR, or roll back to `6d9f488`. That rollback was rehearsed on the migrated schema and passed 75/75. Members and Grant Studio data are kept but unused on the older code, and only the team password signs in there. Restore the database (runbook §8) only if the schema itself is at fault.

## Resolved items (no longer blockers)

- **4 November.**
  - `qs` advisory cleared (PR #35).
  - Grant directory merged (PR #26).
  - Grant Studio, accounts, jobs and templates merged (PRs #29–#45).
  - Candidate validated and the upgrade and rollback rehearsed on `997b735`.
- **24–26 October.**
  - HTTP security headers (PR #22) and the late-October advisories (PR #23) deployed as `6d9f488`.
  - Issue #8 closed.
- **Earlier.**
  - Render environment created by the owner and serving production.
  - October advisories cleared (PRs #18, #19).
  - Render database sized for the $20/month baseline (PR #21).
  - Canonical repository confirmed, recovery baseline merged (PRs #4, #5) and canonical closeout merged (PR #11).
  - CI hardening (PRs #12, #13, #15).
  - Issue #8 UI/UX lock and production smoke tooling (PR #16).
  - Accessibility automated in CI across all primary routes.
  - Replit is reference evidence only.

## Standing rules

These continue to apply after production GO:

- Never weaken tests, typecheck, authentication, ownership or permission checks, database safety guards, secret scanning or CI to obtain a pass.
- Never commit secrets, real customer data or credentials. Production secrets live only in the Render environment.
- Production smoke tests use clearly labelled synthetic records and delete them.
- No purchases, billing changes or new paid services without explicit owner approval.
- Grant Studio never submits an application, never records an approval on a person's behalf, and never presents a match as an eligibility decision. AI drafting does not invent facts, and demo output stays labelled.
- No agent triggers a production deploy or records an owner approval.
