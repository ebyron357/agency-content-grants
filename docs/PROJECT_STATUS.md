# Content Machine — current project status

Status updated: **5 November 2026, 01:30 UTC**. Production observations come from the Render API between 23:00 and 23:25 UTC ([evidence](evidence/production/2026-11-04/README.md)). This session cannot reach the production URL directly, because the network proxy blocks it. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. ClickUp control task: `86e2tjzyc`. Governing issue [#8](https://github.com/ebyron357/agency-content-grants/issues/8) is **closed** (24 October, by `ebyron357`), but no authenticated production smoke result was ever recorded on it.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Production | **LIVE on `d2250c3bf2c3d76492d3078b9d8deec79c83e131`** (merge of PR #42) since 16:18 UTC on 4 November. **Nobody triggered this deploy.** Render's Blueprint Auto Sync deployed it because PR #42 changed `render.yaml`, so it skipped the production gate (next section).<br>• Migrations `0016`–`0024` applied, and the service is live with `/api/readyz` returning 200.<br>• The first live Grants.gov sync (1,387 opportunities) and California sync (156) succeeded.<br>• Memory is about 280 MB of 512 MB.<br>• There was one transient readiness failure (storage) at 18:18 UTC.<br>• The authenticated smoke test has **never been run** on this commit, and `/api/healthz` was not checked over HTTP.<br>[Evidence](evidence/production/2026-11-04/README.md) | Owner: choose to deploy `fdb352c` (recommended) or roll back to `6d9f488` (blocker 1), and turn Blueprint Auto Sync off (blocker 2) |
| Release candidate | **`main` `fdb352c7459239da8727ee290e32265e79d29dcd`** (merge of [PR #46](https://github.com/ebyron357/agency-content-grants/pull/46), 20:16 UTC on 4 November). It is four PRs ahead of production, adding migrations `0025`–`0029`:<br>• the job queue (#43);<br>• editable templates (#44);<br>• AI work as background jobs (#45);<br>• place designations, the writing toolkit and the competitiveness rating (#46).<br>CI passed on PR #46's head `9f09ac0`, whose tree is identical to `fdb352c`.<br>**The real upgrade path was rehearsed:** members, two-factor and Grant Studio data written by `d2250c3`, then `fdb352c`, then rollbacks to `d2250c3` and `6d9f488`, then forward to `fdb352c` again. Every data check passed, and so did every smoke run (75/75). [Upgrade evidence](evidence/upgrade/2026-11-04/README.md), [toolkit](evidence/toolkit/2026-11-04/README.md), [earlier candidate](evidence/release/2026-11-04/README.md) | Owner: approve, complete the prerequisites and deploy (blockers 1–4) |
| Production GO | **NO-GO** | See the blockers below |
| Content Machine release scope | **VERIFIED COMPLETE** (Issue #8 closeout, 2 October). The 4 November rehearsals re-ran the full smoke suite: 75/75 | Preserve |
| Grant directory (PR #26) | Merged 2 November; **deployed 4 November in `d2250c3`, not verified there**. [Scope](GRANT_RESOURCES.md), [evidence](evidence/grants/2026-11-02/README.md) | Verify after the next deploy |
| Grant Studio (PRs #29–#33, #37–#39) | **Deployed 4 November in `d2250c3`, not verified there. Owner acceptance is not recorded.** Discovery (Grants.gov and the California Grants Portal), readiness, matching, alerts, deadlines, fact library, grounded drafting, budgets, approvals, packages, saved writing, outcomes and pipeline. [Scope](GRANT_STUDIO.md), [evidence](evidence/grant-studio/2026-11-03/README.md) | Owner: record the scope acceptance (blocker 1) |
| Accounts and security (PRs #40–#42) | **Deployed 4 November in `d2250c3`, not verified there. Owner approval is not recorded.** Workspaces with their own data, personal member sign-in, invitations, seven roles enforced on every route, two-factor sign-in, sign-out everywhere and an audit log. The team password still signs in to the agency workspace as owner. The Blueprint sync very probably created `MFA_ENCRYPTION_KEY`, but its presence cannot be read from here. [Model](SECURITY_AND_ACCESS_HANDOFF.md), [evidence](evidence/accounts/2026-11-04/README.md) | Owner: confirm `MFA_ENCRYPTION_KEY` in Render → Environment **before anyone turns on two-factor**; record the security-model approval (blocker 1) |
| Background jobs and templates (PRs #43–#45) | **Merged; not deployed.** A durable queue and in-process worker run the grant sync and Grant Studio AI work, and each workspace can edit its application templates. [Design](BACKGROUND_JOBS.md), [jobs evidence](evidence/jobs/2026-11-04/README.md), [templates evidence](evidence/templates/2026-11-04/README.md) | Ships with the next deploy |
| Place designations, writing toolkit, competitiveness rating (PR #46) | **Merged 4 November; not deployed.** Opportunity Zone, HUBZone, HUD QCT and DDA, persistent-poverty county and USDA rural area, each recorded by a person from the agency's own tool. Writing checks, a logic model builder, the notice's format profile, a letters-of-support tracker and three new package checks. A 0–100 competitiveness rating, labelled as not a probability and frozen at submission for later calibration. [Scope](GRANT_STUDIO.md), [evidence](evidence/toolkit/2026-11-04/README.md) | Ships with the next deploy |
| Dependency security | **PASS at the CI gate on PR #46's head** (`9f09ac0`, the `fdb352c` tree): 0 critical, 0 high. 1 moderate, `minimatch` 10.2.5, dev/codegen only (DEFER: its fix is a major version of `typedoc`'s dependency) | Re-audit before each production deploy |
| HTTP security headers | **DEPLOYED** (PR #22; still in `d2250c3`). Last observed over HTTP on 26 October | Re-check in the next smoke run |

## Production deploy outside the gate (4 November)

Full detail: [evidence/production/2026-11-04](evidence/production/2026-11-04/README.md).

- **What happened.** At 16:16 UTC Render deployed `d2250c3` with trigger `blueprint_sync`, about five seconds after PR #42 merged. The deploy event records `manual: false`. It went live at 16:18 and replaced `6d9f488`.
- **Why.** PR #42 added `MFA_ENCRYPTION_KEY` to `render.yaml`. Render documents that "each push to the linked branch that modifies your Blueprint file triggers a deploy of any added or modified resources", and that Auto Sync is on by default ([Render Blueprints](https://render.com/docs/infrastructure-as-code#disabling-automatic-sync)). The service's `autoDeployTrigger: off` covers only ordinary commits. The 22 October deploy of PR #21, which also changed `render.yaml`, had the same trigger. PRs #43–#46 did not change `render.yaml`, so they were not deployed.
- **What it bypassed.**
  - The owner's written acceptance of Grant Studio and of the security model.
  - A confirmed backup before migrations `0016`–`0024` ran.
  - The authenticated smoke test and log review.
- **Risk today.**
  - `d2250c3` was not a planned candidate. Its code passed CI on PR #42's head ([run 41861455142](https://github.com/ebyron357/agency-content-grants/actions/runs/41861455142)), and every later candidate that contains it passed the full gate. It passed the smoke test 75/75 in a local production-mode rehearsal ([upgrade evidence](evidence/upgrade/2026-11-04/README.md)), but never in production.
  - Rolling back to `6d9f488` was rehearsed on a newer schema (`0026`, and again on `0029`), so a rollback is available. `6d9f488` is listed in Render as a deactivated deploy.
  - Between 16:18 and 23:19 UTC the logs show only Render's health checks, so nobody appears to have used the new version yet.
- **Records corrected.** `AGENTS.md`, `README.md` and the runbook said deploys happen only when someone triggers one manually. That is not true while Auto Sync is on. They now say so.

## PRs merged since production `6d9f488`

Every one of these PRs was merged by `ebyron357` on 2–4 November. CI run IDs are for the "CI" workflow on the PR head.

| PR | Change | Migration | CI on merged head | In production (`d2250c3`) |
|---|---|---|---|---|
| [#26](https://github.com/ebyron357/agency-content-grants/pull/26) | Curated grant directory (21 primary-source resources) | — | [41564319136](https://github.com/ebyron357/agency-content-grants/actions/runs/41564319136) | Yes |
| [#29](https://github.com/ebyron357/agency-content-grants/pull/29) | Grant Studio: federal discovery through to an approved DOCX package (replaces closed #28) | `0016` | [41814450904](https://github.com/ebyron357/agency-content-grants/actions/runs/41814450904) | Yes |
| [#30](https://github.com/ebyron357/agency-content-grants/pull/30) | New-match alerts, closing-soon counts, broad-topic warnings, `grant.new_matches` webhook | `0017` | [41814275870](https://github.com/ebyron357/agency-content-grants/actions/runs/41814275870) | Yes |
| [#31](https://github.com/ebyron357/agency-content-grants/pull/31) | Organization fact library for grounded drafting | `0018` | **none** on head `28197cb` (merge-only commit); covered by #32's head | Yes |
| [#32](https://github.com/ebyron357/agency-content-grants/pull/32) | Deadline calendars (`.ics`) and `grant.deadline_approaching` reminders | `0019` | [41814343326](https://github.com/ebyron357/agency-content-grants/actions/runs/41814343326) | Yes |
| [#33](https://github.com/ebyron357/agency-content-grants/pull/33) | California Grants Portal as a second source | `0020` | **none** on head `9dad733` (merge-only commit); covered by #37's head | Yes |
| [#34](https://github.com/ebyron357/agency-content-grants/pull/34) | Docs: PR #26 merge and 4 November audit | — | [41788891734](https://github.com/ebyron357/agency-content-grants/actions/runs/41788891734) | Yes |
| [#35](https://github.com/ebyron357/agency-content-grants/pull/35) | `qs` override `^6.16.1` (GHSA-6pq8-jhm2-2vcw) | — | [41789089839](https://github.com/ebyron357/agency-content-grants/actions/runs/41789089839) | Yes |
| [#37](https://github.com/ebyron357/agency-content-grants/pull/37) | Capacity measurement and an in-process alert-summary cache | — | [41814276916](https://github.com/ebyron357/agency-content-grants/actions/runs/41814276916) | Yes |
| [#38](https://github.com/ebyron357/agency-content-grants/pull/38) | Save approved writing and reuse it | `0021` | [41817559949](https://github.com/ebyron357/agency-content-grants/actions/runs/41817559949) | Yes |
| [#39](https://github.com/ebyron357/agency-content-grants/pull/39) | Outcomes, pipeline and win rate | `0022` | [41818876862](https://github.com/ebyron357/agency-content-grants/actions/runs/41818876862) | Yes |
| [#40](https://github.com/ebyron357/agency-content-grants/pull/40) | Workspaces, personal sign-in, invitations and roles | `0023` | [41827190219](https://github.com/ebyron357/agency-content-grants/actions/runs/41827190219) | Yes |
| [#41](https://github.com/ebyron357/agency-content-grants/pull/41) | Per-role permissions on every route (fails closed; a coverage test walks every route) | — | [41860586470](https://github.com/ebyron357/agency-content-grants/actions/runs/41860586470) | Yes |
| [#42](https://github.com/ebyron357/agency-content-grants/pull/42) | Two-factor sign-in, sign-out everywhere, audit log; adds `MFA_ENCRYPTION_KEY` to `render.yaml` | `0024` | [41861455142](https://github.com/ebyron357/agency-content-grants/actions/runs/41861455142) | Yes (the deployed commit) |
| [#43](https://github.com/ebyron357/agency-content-grants/pull/43) | Durable background job queue and worker | `0025` | [41865671702](https://github.com/ebyron357/agency-content-grants/actions/runs/41865671702) | No |
| [#44](https://github.com/ebyron357/agency-content-grants/pull/44) | Editable application templates per workspace | `0026` | [41871040953](https://github.com/ebyron357/agency-content-grants/actions/runs/41871040953) | No |
| [#45](https://github.com/ebyron357/agency-content-grants/pull/45) | Grant Studio AI work as background jobs; flaky grant tests fixed | — | [41878465167](https://github.com/ebyron357/agency-content-grants/actions/runs/41878465167) | No |
| [#46](https://github.com/ebyron357/agency-content-grants/pull/46) | Place designations, writing toolkit, competitiveness rating; status records reconciled with `997b735` | `0027`–`0029` | [41901743511](https://github.com/ebyron357/agency-content-grants/actions/runs/41901743511) | No |

Documentation and test PRs after #46, with no application code:

- [#47](https://github.com/ebyron357/agency-content-grants/pull/47) was merged on 5 November as `main` `3dc6da0`. It holds these records and the upgrade rehearsal.
- [#49](https://github.com/ebyron357/agency-content-grants/pull/49) was merged on 5 November as `main` `1ee5576`. It fixes an intermittent CI failure: four API test files shared one sign-in rate-limit counter, so a sign-in could get `429`. It changes test files only.
- [#48](https://github.com/ebyron357/agency-content-grants/pull/48) extends `tests/production-smoke.sh` to Grant Studio, invitations, the audit log and jobs.

Deploying `3dc6da0`, `1ee5576` or the #48 merge runs the same application code as `fdb352c`.

A second intermittent test failure is fixed by [#51](https://github.com/ebyron357/agency-content-grants/pull/51) (test-only). `grants.integration.test.ts` ("reuses hub alert summaries…") counted alert-cache hits while other test files changed grant opportunities in parallel. It is a test-isolation issue, not a product defect.

PRs closed without merging: #28 (a secret-scan false positive on `d3f1a0e`, replaced by #29) and #25 (superseded by #35; its branch is kept for possible `minimatch` work).

## Merge-record findings

These do not invalidate the code, which passed the full gate (next section). But they must be on the record.

- **CI never ran on two merged heads.** #31 (`28197cb`) and #33 (`9dad733`) were merge-only commits, and GitHub marked #31 and #32 merged because a later PR contained them. Their code is covered by later green heads. #34 and #35 merged 11 seconds apart, so their combination was first tested by later PRs.
- **None of PRs #29–#46 had a review.** Each of these 17 PRs had zero reviews, zero review comments and zero review threads, so no PR was merged with unresolved feedback. Every one was merged by `ebyron357`. #46 was merged 20 minutes after it was opened.
- **There is no written owner approval for the scope decisions.** `AGENTS.md` makes Grant Studio "accepted scope once the owner approves its pull request". #29 asked for that decision, #40 says it "changes the security model, so it needs owner approval (plan decision D5)", and #46 asked for a review as the written approval. The only record is the merge by `ebyron357`, the same account the agents work under. This record does not treat a merge as approval.
- **Branch protection on `main` is unknown.** The protection endpoint returned 403 and the ruleset list was empty. Open PR #36 states there is none. CI runs on pull requests only, not on pushes to `main`.
- **Merging can deploy.** A merge that changes `render.yaml` deploys immediately while Blueprint Auto Sync is on (previous section).

## Release-candidate validation

Full detail:

- [evidence/upgrade/2026-11-04](evidence/upgrade/2026-11-04/README.md): the upgrade from production `d2250c3` to `fdb352c`.
- [evidence/release/2026-11-04](evidence/release/2026-11-04/README.md): `997b735`.
- [evidence/toolkit/2026-11-04](evidence/toolkit/2026-11-04/README.md): the PR #46 tree that became `fdb352c`.

- **Hosted CI on `9f09ac0`** (PR #46's head; its tree is identical to `fdb352c`, and its base was `997b735`): "Format, typecheck, tests, build" and "Secret scan, dependency audit, SBOM" passed ([CI run 41901743511](https://github.com/ebyron357/agency-content-grants/actions/runs/41901743511)), and so did "validate" ([run 41901743565](https://github.com/ebyron357/agency-content-grants/actions/runs/41901743565)).
- **Local gates on the PR #46 tree.**
  - Frozen install, format, typecheck and production build.
  - API unit tests: 238 passed.
  - Migrations `0000`–`0029` on an empty database, then database-backed API tests: 457 passed.
  - Content OS tests: 34 passed.
  - Integration tests: 40 passed, 0 skipped.
  - Playwright accessibility and end-to-end gate: 11 passed.
  - `pnpm audit --audit-level=high` passes.
- **Local gates on `997b735`.** The same gates passed with 209 unit, 426 database-backed, 31 Content OS, 40 integration and 10 Playwright tests.
- **Upgrade rehearsal passed on both.** Records were written by `6d9f488`, then the candidate started on the same database (production mode, TLS proxy). The migrations applied cleanly, the old records stayed readable, and `tests/production-smoke.sh` passed **75/75**. On the PR #46 tree the server reported its parent commit `44aac09`, because the build came from the working tree before the last commit; only documentation and evidence changed after it.
- **Rollback rehearsal passed on both.** `6d9f488` restarted on the migrated schema, read the old records, and passed its own smoke test **75/75**.
- **Upgrade from production `d2250c3` passed** (23:30–23:45 UTC, 4 November, built `fdb352c` and `d2250c3` themselves).
  - **Setup.** `d2250c3` seeded data on an empty database: two members, one with two-factor on (an encrypted `v1:` secret), and a Grant Studio applicant with a confirmed fact, an application, an edited section and a budget line.
  - **Upgrade.** `fdb352c` started on the same database: migrations `0025`–`0029` applied cleanly and the job worker started.
    - Every record stayed readable.
    - The writer signed in with a code from the secret `d2250c3` had sealed, and a `d2250c3` recovery code worked once.
    - Roles held: a reviewer could not invite members.
    - The new rating, format profile, designations, letters, templates and jobs all worked on the old records.
  - **Round trip.** Rolling back to `d2250c3` and to `6d9f488` on the `0029` schema worked, and so did rolling forward to `fdb352c` again. Data checks passed at every step.
  - **Smoke.** **75/75** on each of the five runs, including `d2250c3` itself.
  - **Rate limit.** One run hit the two-factor brute-force limit (5 wrong codes per 15 minutes per address, kept in PostgreSQL across restarts). That is intended behavior; the run was repeated after clearing the rehearsal counter.
- **Limits.**
  - Data volume was small in every rehearsal: one workspace, two members and one application.
  - Node 22 was used locally (CI and Render use 24.15).
  - Readiness was 503 locally only because no AI key was set.
  - The smoke script now probes Grant Studio, invitations, the audit log and the job queue ([evidence](evidence/smoke/2026-11-05/README.md)). It deliberately does not create member accounts or submit two-factor codes in production. Those paths are covered by CI and the upgrade rehearsal.

## Deploy prerequisites for `fdb352c`

The runbook documents each of these ([`DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`](DEPLOYMENT_AND_RECOVERY_RUNBOOK.md)).

1. **Blueprint Auto Sync.** Render → Blueprints → the `agency-content-grants` Blueprint → Settings → **Auto Sync: No**. While it is on, any merge that changes `render.yaml` deploys at once. With it off, a `render.yaml` change takes effect only after **Manual Sync**.
2. **`MFA_ENCRYPTION_KEY`.** Confirm it exists under Render → Environment. The Blueprint sync very probably generated it. If it is missing, add it (Add → Generate) before anyone turns on two-factor; without it two-factor secrets are stored unencrypted (`v0:`). Keep the same value through the deploy. The rehearsal showed secrets sealed by `d2250c3` open on `fdb352c` only with the same key. Never rotate it together with `SESSION_SECRET`.
3. **Database backup.** Five forward-only migrations (`0025`–`0029`) run at startup. Confirm Render point-in-time recovery is available, or take a logical backup (runbook §7), and download a copy of the disk. Also note whether a backup exists from before 16:16 UTC on 4 November, when `0016`–`0024` ran.
4. **Outbound access.** Confirmed in production: the first Grants.gov and California syncs succeeded on 4 November. After the deploy the sync runs on the job queue; confirm it under Settings → Jobs.
5. **Capacity.** About 280 MB of the 512 MB `0.5c-512mb` instance is in use after the first sync. Watch memory in Render metrics after the deploy.
6. **Smoke variable name.** The script reads `SMOKE_ADMIN_PASSWORD`; set it to the value of `ADMIN_PASSWORD`.
7. **Two-factor lockout.** Five wrong two-factor codes from one network address lock that address out of two-factor sign-in for 15 minutes, across restarts. During verification, avoid deliberate wrong codes from a shared office address.

## Blockers and required decisions

| # | Item | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| 1 | Decide on the unplanned deploy, and record the approvals | Owner | A written owner statement on GitHub (a PR review or comment) and in ClickUp that either **(a)** accepts Grant Studio (#29 onward), the workspace, role and two-factor security model (#40–#42) and PR #46, and approves deploying `fdb352c`, or **(b)** asks for a rollback to `6d9f488` until specific changes are made | Owner writes it. Recommended: (a). The upgrade from `d2250c3` to `fdb352c`, and the rollbacks from it, were rehearsed with production-shaped data. A rollback would remove Grant Studio, which the owner requested. Both choices still need blocker 5 |
| 2 | Close the automatic deploy path | Owner | Blueprint Auto Sync set to **No**, or a written decision to keep it | Prerequisite 1 |
| 3 | Deploy prerequisites | Owner | `MFA_ENCRYPTION_KEY` confirmed; backup taken | Prerequisites 2–3 |
| 4 | Deploy the chosen commit | Owner | **(a)** Render manual deploy of `fdb352c` (or a later reviewed `main` commit), with logs showing `[migrate] Migrations complete` and `Server listening`; or **(b)** Render → Events → the `6d9f488` deploy → **Rollback** | Runbook §5 or §6 |
| 5 | Authenticated production verification | Owner / operator holding `ADMIN_PASSWORD` | `tests/production-smoke.sh` passes with `EXPECTED_SHA` set to the deployed SHA; no `"level":50` entries in Render logs during the run; a grant sync job succeeds (Settings → Jobs, on `fdb352c`); the previous deploy is listed for rollback | Run the smoke test (runbook §4) |
| 6 | Record the result | Owner / operator | This file, `GO_NO_GO_DECISION.md`, a comment on Issue #8 and ClickUp `86e2tjzyc` updated with the smoke evidence file | On a pass, change the decision to **PRODUCTION GO** |

No agent triggers a production deploy or rollback, changes Render settings, creates paid resources or records an approval on the owner's behalf.

## Recommendations (not blockers)

- Turn on branch protection for `main`, requiring the `CI` checks and one approving review. Agents and the owner work under the same account, so the review is the only way to tell an owner decision apart from an agent merge.
- Close stale PR [#36](https://github.com/ebyron357/agency-content-grants/pull/36). It conflicts with `main`, and this record supersedes it.
- Update [#27](https://github.com/ebyron357/agency-content-grants/pull/27), the grant platform plan (proposed, not on `main`). It predates R1 steps 1–5 (#40–#45) and #46, so its "what is built" section needs refreshing before it can be accepted.
- Delete the stale `feat/grant-studio` branch, which holds the secret-scan false positive, and the merged feature branches. This is the owner's call.

## Known non-blocking findings

- `minimatch` 10.2.5 moderate advisory, dev/codegen only (above).
- One production readiness check failed on storage at 18:18:54 UTC on 4 November (`d2250c3`), then recovered on the next check. The cause is unknown. Watch for a repeat in Render logs.
- One production UI chunk is over 500 kB (`ProjectDetail`). Vite warns; it is not a defect.
- Residual access risks, from [`SECURITY_AND_ACCESS_HANDOFF.md`](SECURITY_AND_ACCESS_HANDOFF.md):
  - The team password has no second factor.
  - There are no passkeys.
  - Content-side approvals are not separated from writing.
  - Audit entries and API keys created before PR #42 name no person.
- Not yet on the job queue: the publishing, performance and webhook schedulers ([`BACKGROUND_JOBS.md`](BACKGROUND_JOBS.md)).
- A calibrated probability of approval is **DEFER**: no outcome data exists yet. The competitiveness rating is labelled as not a probability, and award rates by band appear from 5 recorded decisions per band ([`GRANT_STUDIO.md`](GRANT_STUDIO.md)).
- Automatic place-designation lookup (address to tract to designation) is **DEFER**. The Census Geocoder, CDFI Fund, SBA, HUD and USDA hosts were blocked in the build environment, so it could not be built against real responses. A person records each result instead ([`GRANT_STUDIO.md`](GRANT_STUDIO.md)).
- Not connected as sources: SBIR.gov (its API returned 403), SAM.gov assistance listings and Simpler.Grants.gov (both need owner-held API keys), and other states and local portals.
- The in-process alert cache and in-process worker assume a single instance, as the runbooks require.

## HTTP security headers (deployed)

`artifacts/api-server/src/middleware/securityHeaders.ts` is applied first in `app.ts`, so it covers API routes, static assets, the SPA shell and 404s:

- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
- `X-Frame-Options: DENY` (legacy browsers)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin` (YouTube embeds need a referrer, so `no-referrer` is not used)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`, only when `NODE_ENV=production` (Render terminates TLS); no `preload`
- `x-powered-by` removed

**Hand-written middleware: ADOPT. `helmet`: REJECT for now.** The six fixed headers need no dependency and are each test-asserted. Helmet's defaults would need opting out for the editor's embeds. Revisit if the header set grows.

**Full CSP source allowlist: DEFER.** User-supplied `https` images, YouTube and Vimeo iframes, Google Fonts and inline styles make an enforced policy risky without browser verification. Next step: ship a `Content-Security-Policy-Report-Only` policy, collect violations, then enforce.

Evidence: `src/__tests__/security-headers.test.ts`. The headers were observed on production (`6d9f488`) on 26 October, and they pass in the 4 November rehearsal smoke runs. `d2250c3` contains the same middleware; the headers have not been observed on it over HTTP.

## Dependency repair history

- **13 October (PR #18):** patched `proxy-addr`, `source-map-js` and `prosemirror-view`, and replaced the `fast-glob` chain. [Evidence](evidence/security/2026-10-13/README.md).
- **21 October (PR #19):** cleared `vite`, `markdown-it`, `sanitize-html`, `fast-copy` and `postcss-selector-parser`. [Evidence](evidence/security/2026-10-21/README.md).
- **24 October (PR #23, deployed as `6d9f488`):** cleared 4 high, 7 moderate and 2 low advisories and the `@tiptap/pm` peer mismatch. [Evidence](evidence/security/2026-10-24/README.md).
- **4 November (PR #35):** cleared the `qs` moderate advisory. The pre-merge assessment is in [2026-11-04](evidence/security/2026-11-04/README.md). The audit of `997b735` is in [release/2026-11-04](evidence/release/2026-11-04/audit.json).

`sanitize-html` strips unsafe editor and Grant Studio section HTML on the server. The security threshold, secret scanning, database guards, ownership checks and CI checks are unchanged.

## Preserved product and operating constraints

- **Approved scope.**
  - The delivered Content Machine.
  - The owner-authorized grant directory (2 November).
  - The owner-requested Grant Studio (3 November), whose formal acceptance is blocker 1.
  - The owner-requested place designations, writing toolkit and competitiveness rating (4 November, PR #46), also awaiting acceptance.
- **Grant Studio limits.**
  - Grant Studio never submits an application, never records an approval on a person's behalf, and never presents a match as an eligibility decision.
  - AI drafting uses only confirmed facts and marks gaps `[Add: …]`.
  - Demo output stays labelled.
- **Access model.**
  - Workspaces own their data through their own principal user, and every ownership check scopes to the signed-in workspace.
  - Members sign in personally; the team password (`ADMIN_PASSWORD`) signs in to the agency workspace as owner.
  - Two-factor can be required per workspace.
  - Details: [`SECURITY_AND_ACCESS_HANDOFF.md`](SECURITY_AND_ACCESS_HANDOFF.md).
- **Deployment design.** A single instance, an in-process job worker and schedulers, and a persistent Render disk. Media and exports stay on disk. Backup and retention follow the runbooks. Deploys are manual, except that a `render.yaml` change deploys at once while Blueprint Auto Sync is on.
- **External dependencies.** AI providers, Typefully, Grants.gov, the California Grants Portal and production credentials are owner-managed.
- **Production verification** must show:
  - repository/deployment SHA parity;
  - authentication and isolation;
  - persistence and export;
  - accessibility;
  - runtime health;
  - rollback evidence.

## Governing documents and history

The following remain in force:
- `AGENTS.md`, [`GO_NO_GO_DECISION.md`](GO_NO_GO_DECISION.md), [`DOCUMENT_OWNERSHIP_MAP.md`](DOCUMENT_OWNERSHIP_MAP.md), `CI.md`, [`PROJECT_COMPLETION_STANDARD.md`](PROJECT_COMPLETION_STANDARD.md), [`GRANT_STUDIO.md`](GRANT_STUDIO.md), [`GRANT_RESOURCES.md`](GRANT_RESOURCES.md) and [`BACKGROUND_JOBS.md`](BACKGROUND_JOBS.md);
- the deployment, security and access, data lifecycle, admin, client, troubleshooting and acceptance manuals.

This file supersedes the 19:50 UTC 4 November version, which still said production ran `6d9f488`, described `main` as `997b735`, and described PR #46's branch as unmerged. That version is archived verbatim at [`history/PROJECT_STATUS_2026-11-04_PRE_PRODUCTION_RECONCILIATION.md`](history/PROJECT_STATUS_2026-11-04_PRE_PRODUCTION_RECONCILIATION.md). The earlier 4 November version, which described `main` as `3221c7b`, is at [`history/PROJECT_STATUS_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md`](history/PROJECT_STATUS_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md). Earlier snapshots, including the [2 October](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md) one, remain historical.
