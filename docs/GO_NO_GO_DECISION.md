# GO / NO-GO Decision

**Current decision record. Updated: 4 November 2026, 23:50 UTC. Production evidence: the Render API, 23:00–23:25 UTC.** It replaces the 19:50 UTC version, which still said production ran `6d9f488`; that version is archived verbatim at [`history/GO_NO_GO_DECISION_2026-11-04_PRE_PRODUCTION_RECONCILIATION.md`](history/GO_NO_GO_DECISION_2026-11-04_PRE_PRODUCTION_RECONCILIATION.md). Evidence for every statement below is in [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Decision

| Scope | Decision |
|---|---|
| Content Machine release scope (Issue #8 closeout) | **GO — VERIFIED COMPLETE** (unchanged since 2 October). Issue #8 is closed. |
| Production environment | **LIVE on `d2250c3bf2c3d76492d3078b9d8deec79c83e131`** (merge of PR #42) since 16:18 UTC on 4 November. Render's Blueprint Auto Sync deployed it, because PR #42 changed `render.yaml`. No person or agent triggered it, and it skipped the production gate. Render's logs show migrations `0016`–`0024` applied, the service live and ready, and the first grant syncs succeeding. **Not verified:** the authenticated smoke test, `/api/healthz` over HTTP and the security headers. Evidence: [`evidence/production/2026-11-04/`](evidence/production/2026-11-04/README.md). |
| Release candidate `main` `fdb352c7459239da8727ee290e32265e79d29dcd` | **Technically ready to deploy.** It is production plus PRs #43–#46: the job queue, templates, AI work as jobs, place designations, the writing toolkit and the competitiveness rating. CI passed on PR #46's head, whose tree is identical. The upgrade from production `d2250c3` was rehearsed with members, two-factor and Grant Studio data written by `d2250c3`. Every record stayed usable, members signed in with their existing two-factor, the rollbacks to `d2250c3` and `6d9f488` worked on the new schema, and every smoke run passed 75/75. Evidence: [`evidence/upgrade/2026-11-04/`](evidence/upgrade/2026-11-04/README.md) and [`evidence/toolkit/2026-11-04/`](evidence/toolkit/2026-11-04/README.md). |
| Scope and security-model acceptance | **PENDING — owner.** Grant Studio (#29 onward), the workspace, role and two-factor security model (#40–#42) and PR #46 were merged by `ebyron357`. No written owner approval is recorded, and none of PRs #29–#46 had a review. Most of this scope is now live without that approval. |
| Deploy path | **OPEN.** While Blueprint Auto Sync is on, any merge that changes `render.yaml` deploys immediately. Owner action: set Auto Sync to No. |
| Dependency audit (4 November, PR #46 head) | **PASS at the CI gate.** 0 critical, 0 high, 1 moderate (`minimatch`, dev only). |
| Production GO | **NO-GO.** Missing: the owner's decision on the unplanned deploy and the approvals, the deploy prerequisites, a deploy of a reviewed candidate (or a rollback), and the authenticated production verification. No code change is required. |
| Closure state ([`PROJECT_COMPLETION_STANDARD.md`](PROJECT_COMPLETION_STANDARD.md) §44) | **BLOCKED — OWNER ACTION REQUIRED** |

## Remaining steps to PRODUCTION GO

1. **Owner: decide and record the approvals.** Add a written statement on GitHub (a PR review or comment) and in ClickUp `86e2tjzyc`. It should either:
   - **(a, recommended)** accept Grant Studio as scope, the workspace, role and two-factor security model, and PR #46, and approve deploying `fdb352c`; or
   - **(b)** ask for a rollback to `6d9f488` and list the changes required first.
2. **Owner: close the automatic deploy path.** Render → Blueprints → the `agency-content-grants` Blueprint → Settings → **Auto Sync: No**. From then on, apply `render.yaml` changes with **Manual Sync**.
3. **Owner: deploy prerequisites.**
   - Under Render → Environment, confirm `MFA_ENCRYPTION_KEY` exists. The Blueprint sync very probably generated it. If it is missing, add it (Add → Generate) before anyone turns on two-factor. Never rotate it together with `SESSION_SECRET`.
   - Confirm database point-in-time recovery is available, or take a logical backup (runbook §7).
   - Download a copy of `/var/data`.
4. **Owner: deploy or roll back.**
   - **(a)** Run a Render manual deploy of `fdb352c7459239da8727ee290e32265e79d29dcd`, or of a later reviewed `main` commit, and use that SHA below. Confirm the logs show `[migrate] Migrations complete` (migrations `0025`–`0029`) and `Server listening`.
   - **(b)** Render → Events → the `6d9f488` deploy → **Rollback**. The older code was rehearsed on the newer schema with member and Grant Studio data present; that data is kept but unused, and only the team password signs in.
5. **Operator holding `ADMIN_PASSWORD`: smoke test.** Run the smoke test (runbook §4) with this command:

   ```bash
   BASE_URL=https://agency-content-grants.onrender.com SMOKE_ADMIN_PASSWORD='<ADMIN_PASSWORD>' EXPECTED_SHA=<deployed SHA> bash tests/production-smoke.sh
   ```

   It must end `RESULT: N passed, 0 failed`.
6. **Operator: check the new features** (option a).
   - In a browser, sign in with the team password and open Grant Studio.
   - Use **Refresh now** and confirm the sync job succeeds (Settings → Jobs).
   - Confirm Settings → Team loads.
7. **Operator: logs and rollback point.**
   - Confirm Render logs show no `"level":50` entries during the run.
   - Confirm memory stays within the plan after the sync.
   - Confirm the previous deploy is listed under **Events** as the rollback point.
8. **Record the result** in `PROJECT_STATUS.md`, this file, a comment on Issue #8 (attach the smoke evidence file) and ClickUp `86e2tjzyc`. On a pass, change the decision to **PRODUCTION GO**.

If any check fails, the decision stays NO-GO. Fix the failure through a reviewed PR, or roll back to `6d9f488`, which was rehearsed on the migrated schema and passed 75/75. Restore the database (runbook §8) only if the schema itself is at fault.

## Resolved items (no longer blockers)

- **4 November.**
  - `qs` advisory cleared (PR #35).
  - Grant directory merged (PR #26).
  - Grant Studio, accounts, jobs and templates merged (PRs #29–#45).
  - Candidate validated and the upgrade and rollback rehearsed on `997b735`.
  - Place designations, writing toolkit and competitiveness rating merged (PR #46), with CI green and the upgrade and rollback rehearsed on its tree.
  - First live grant sync succeeded in production (Grants.gov 1,387, California 156). Outbound access is no longer an open question.
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
- No agent triggers a production deploy or rollback, changes Render settings, or records an owner approval.
