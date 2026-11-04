# Content Machine — current project status

Status updated: **4 November 2026, 19:05 UTC**. Production observations below are still dated **26 October 2026**; this session could not reach production (the network proxy blocks it). Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. ClickUp control task: `86e2tjzyc`. Governing issue [#8](https://github.com/ebyron357/agency-content-grants/issues/8) is **closed** (24 October, by `ebyron357`), but no authenticated production smoke result was ever recorded on it.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Release candidate | **`main` `997b7356b29f9d0a47028d82569c62d8d854c5ef`** (merge of [PR #45](https://github.com/ebyron357/agency-content-grants/pull/45), 4 November). It is 16 merged PRs ahead of production: the grant directory, Grant Studio, accounts and workspaces, roles, two-factor sign-in and audit log, background jobs, editable templates, and the `qs` fix (table below). **All CI-equivalent gates and an upgrade and rollback rehearsal passed locally on this exact commit.** [Evidence](evidence/release/2026-11-04/README.md) | Owner: confirm the scope and security-model approvals, then complete the deploy prerequisites (below) |
| Production | **LIVE on `6d9f4887a28d8caec52e2e32c11e61d4a74059f4`** (PR #23 merge). Last anonymous check on 26 October: `/api/healthz` commit `6d9f488`, `/api/readyz` 200, anonymous `/api/projects` 401, and every PR #22 security header present with no `x-powered-by`. The authenticated `tests/production-smoke.sh` run and Render log review have **never been recorded** | Owner deploys `997b735`, then an operator holding `ADMIN_PASSWORD` runs the smoke test ([`GO_NO_GO_DECISION.md`](GO_NO_GO_DECISION.md)) |
| Production GO | **NO-GO** | See the blockers below |
| Content Machine release scope | **VERIFIED COMPLETE** (Issue #8 closeout, 2 October). The 4 November rehearsal re-ran the full smoke suite on the candidate: 75/75 | Preserve |
| Grant directory (PR #26) | Merged 2 November (`3221c7b`); **not deployed**. [Scope](GRANT_RESOURCES.md), [evidence](evidence/grants/2026-11-02/README.md) | Ships with the next deploy |
| Grant Studio (PRs #29–#33, #37–#39, #44, #45) | **Merged; not deployed.** Discovery (Grants.gov and the California Grants Portal), readiness, matching, alerts, deadlines, fact library, grounded drafting, budgets, approvals, packages, saved writing, outcomes and pipeline, templates, and AI work as background jobs. [Scope](GRANT_STUDIO.md), [evidence](evidence/grant-studio/2026-11-03/README.md), [templates](evidence/templates/2026-11-04/README.md) | Owner: record the scope acceptance (blocker 1) |
| Accounts and security (PRs #40–#42) | **Merged; not deployed.** Workspaces with their own data, personal member sign-in, invitations, seven roles (owner, admin, writer, reviewer, authorized representative, finance, viewer) enforced on every route, two-factor sign-in, sign-out everywhere, and an audit log. The team password still signs in to the agency workspace as owner. [Model](SECURITY_AND_ACCESS_HANDOFF.md), [evidence](evidence/accounts/2026-11-04/README.md) | Owner: record the security-model approval (blocker 1); add `MFA_ENCRYPTION_KEY` before deploy |
| Background jobs (PRs #43, #45) | **Merged; not deployed.** A durable queue and in-process worker, with the grant sync and Grant Studio AI work on it. [Design](BACKGROUND_JOBS.md), [evidence](evidence/jobs/2026-11-04/README.md) | — |
| Dependency security | **PASS at the CI gate on `997b735`**: 0 critical, 0 high. 1 moderate, `minimatch` 10.2.5, dev/codegen only (DEFER: its fix is a major version of `typedoc`'s dependency). `qs` was raised to `^6.16.1` by [PR #35](https://github.com/ebyron357/agency-content-grants/pull/35) and is no longer reported. [Audit](evidence/release/2026-11-04/audit.json) | Re-audit before each production deploy |
| HTTP security headers | **DEPLOYED** (PR #22). Details below | — |

## What `main` contains beyond production

Every one of these PRs was merged by `ebyron357` on 2–4 November. All CI run IDs are for the "CI" workflow on the PR head.

| PR | Change | Migration | CI on merged head |
|---|---|---|---|
| [#26](https://github.com/ebyron357/agency-content-grants/pull/26) | Curated grant directory (21 primary-source resources) | — | [41564319136](https://github.com/ebyron357/agency-content-grants/actions/runs/41564319136) |
| [#29](https://github.com/ebyron357/agency-content-grants/pull/29) | Grant Studio: federal discovery through to an approved DOCX package (replaces closed #28) | `0016` | [41814450904](https://github.com/ebyron357/agency-content-grants/actions/runs/41814450904) |
| [#30](https://github.com/ebyron357/agency-content-grants/pull/30) | New-match alerts, closing-soon counts, broad-topic warnings, `grant.new_matches` webhook | `0017` | [41814275870](https://github.com/ebyron357/agency-content-grants/actions/runs/41814275870) |
| [#31](https://github.com/ebyron357/agency-content-grants/pull/31) | Organization fact library for grounded drafting | `0018` | **none** on head `28197cb` (merge-only commit); covered by #32's head |
| [#32](https://github.com/ebyron357/agency-content-grants/pull/32) | Deadline calendars (`.ics`) and `grant.deadline_approaching` reminders | `0019` | [41814343326](https://github.com/ebyron357/agency-content-grants/actions/runs/41814343326) |
| [#33](https://github.com/ebyron357/agency-content-grants/pull/33) | California Grants Portal as a second source | `0020` | **none** on head `9dad733` (merge-only commit); covered by #37's head |
| [#34](https://github.com/ebyron357/agency-content-grants/pull/34) | Docs: PR #26 merge and 4 November audit | — | [41788891734](https://github.com/ebyron357/agency-content-grants/actions/runs/41788891734) |
| [#35](https://github.com/ebyron357/agency-content-grants/pull/35) | `qs` override `^6.16.1` (GHSA-6pq8-jhm2-2vcw) | — | [41789089839](https://github.com/ebyron357/agency-content-grants/actions/runs/41789089839) |
| [#37](https://github.com/ebyron357/agency-content-grants/pull/37) | Capacity measurement and an in-process alert-summary cache | — | [41814276916](https://github.com/ebyron357/agency-content-grants/actions/runs/41814276916) |
| [#38](https://github.com/ebyron357/agency-content-grants/pull/38) | Save approved writing and reuse it | `0021` | [41817559949](https://github.com/ebyron357/agency-content-grants/actions/runs/41817559949) |
| [#39](https://github.com/ebyron357/agency-content-grants/pull/39) | Outcomes, pipeline and win rate | `0022` | [41818876862](https://github.com/ebyron357/agency-content-grants/actions/runs/41818876862) |
| [#40](https://github.com/ebyron357/agency-content-grants/pull/40) | Workspaces, personal sign-in, invitations and roles | `0023` | [41827190219](https://github.com/ebyron357/agency-content-grants/actions/runs/41827190219) |
| [#41](https://github.com/ebyron357/agency-content-grants/pull/41) | Per-role permissions on every route (fails closed; a coverage test walks every route) | — | [41860586470](https://github.com/ebyron357/agency-content-grants/actions/runs/41860586470) |
| [#42](https://github.com/ebyron357/agency-content-grants/pull/42) | Two-factor sign-in, sign-out everywhere, audit log | `0024` | [41861455142](https://github.com/ebyron357/agency-content-grants/actions/runs/41861455142) |
| [#43](https://github.com/ebyron357/agency-content-grants/pull/43) | Durable background job queue and worker | `0025` | [41865671702](https://github.com/ebyron357/agency-content-grants/actions/runs/41865671702) |
| [#44](https://github.com/ebyron357/agency-content-grants/pull/44) | Editable application templates per workspace | `0026` | [41871040953](https://github.com/ebyron357/agency-content-grants/actions/runs/41871040953) |
| [#45](https://github.com/ebyron357/agency-content-grants/pull/45) | Grant Studio AI work as background jobs; flaky grant tests fixed | — | [41878465167](https://github.com/ebyron357/agency-content-grants/actions/runs/41878465167) |

PRs closed without merging: #28 (a secret-scan false positive on `d3f1a0e`, replaced by #29) and #25 (superseded by #35; its branch is kept for possible `minimatch` work).

## Merge-record findings

These do not invalidate the code, which passed the full gate on `997b735` (next section). But they must be on the record.

- **CI never ran on two merged heads.** #31 (`28197cb`) and #33 (`9dad733`) were merge-only commits, and GitHub marked #31 and #32 merged because a later PR contained them. Their code is covered by later green heads (#32 `a83bba3`, #37 `c451d73`, and every head after). #34 and #35 merged 11 seconds apart, so their combination was first tested by later PRs.
- **None of the 16 PRs had a review.** Each PR had zero reviews, zero review comments and zero review threads, so no PR was merged with unresolved feedback. Every one was merged by `ebyron357`.
- **There is no written owner approval for two scope decisions.** `AGENTS.md` makes Grant Studio "accepted scope once the owner approves its pull request". #29 asked for that decision, and #40 says it "changes the security model, so it needs owner approval (plan decision D5)". The only record is the merge by `ebyron357`, the same account the agents work under. This record does not treat the merge as approval.
- **Branch protection on `main` is unknown.** The protection endpoint returned 403 and the ruleset list was empty. Open PR #36 states there is none. CI runs on pull requests only, not on pushes to `main`.

## Release-candidate validation on `997b735` (4 November)

Full detail: [evidence/release/2026-11-04](evidence/release/2026-11-04/README.md).

- **CI-equivalent gates pass locally.**
  - Frozen install, format, typecheck and production build.
  - API unit tests: 209 passed, 0 skipped.
  - Migrations on an empty database.
  - Database-backed API tests: 426 passed.
  - Content OS tests: 31 passed.
  - Integration tests: 40 passed, 0 skipped.
  - Playwright accessibility and end-to-end gate: 10 passed. It covers every primary route, Grant Studio, accounts, two-factor, jobs and templates.
  - `pnpm audit --audit-level=high` passes.
- **Upgrade rehearsal passed.** Records were written by `6d9f488`, then `997b735` started on the same database (production mode, TLS proxy). Migrations `0016`–`0026` applied cleanly and the old records stayed readable. `tests/production-smoke.sh` with `EXPECTED_SHA=997b735…` passed **75/75**.
- **Rollback rehearsal passed.** `6d9f488` restarted on the migrated schema, read the old records, and passed its own smoke test **75/75**.
- **Limits.**
  - Node 22 was used locally (CI and Render use 24.15).
  - Readiness was 503 only because no AI key was set.
  - The container could not reach Grants.gov or `data.ca.gov`, so the first live sync is unverified.
  - The smoke script does not probe Grant Studio, member sign-in, two-factor or jobs.

## Deploy prerequisites for `997b735`

The runbook already documents each of these ([`DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`](DEPLOYMENT_AND_RECOVERY_RUNBOOK.md)). They are restated here because this deploy is the first to need them.

1. **`MFA_ENCRYPTION_KEY`.** The existing Render service was created before this variable was in `render.yaml`. The owner adds it once: Render → Environment → Add → Generate. Without it the service still starts, but two-factor secrets are stored unencrypted (`v0:`). Never rotate it together with `SESSION_SECRET`.
2. **Database backup.** Eleven forward-only migrations run at startup. Rolling the code back to `6d9f488` was rehearsed and works on the newer schema. Still, before deploying, confirm Render point-in-time recovery is available, or take a logical backup (runbook §7), and download a copy of the disk.
3. **Outbound access.** The daily grant sync calls the Grants.gov API and the `data.ca.gov` CKAN datastore. After deploy, use **Grant Studio → Refresh now** (or wait for the daily run), then confirm the sync run and job succeed: Settings → Jobs.
4. **Capacity.** The `0.5c-512mb` instance was measured with about 220 MB of headroom at the tested scale ([`GRANT_STUDIO.md`](GRANT_STUDIO.md)). Watch memory in Render metrics after the first sync.
5. **Smoke variable name.** The script reads `SMOKE_ADMIN_PASSWORD`; set it to the value of `ADMIN_PASSWORD`.

## Blockers and required decisions

| # | Item | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| 1 | Record the scope and security-model approvals | Owner | A written owner statement accepting Grant Studio (#29 onward) and the workspace/role/two-factor security model (#40–#42), recorded on GitHub (a PR review or comment) and in ClickUp | Owner writes it, or asks for specific changes before deploy |
| 2 | Deploy prerequisites | Owner | `MFA_ENCRYPTION_KEY` present in Render; backup confirmed | Steps 1–2 above |
| 3 | Deploy the candidate | Owner | Render manual deploy of `997b735` (or a later reviewed `main` commit); `/api/healthz` reports it; logs show `[migrate] Migrations complete` | Runbook §5 |
| 4 | Authenticated production verification | Owner / operator holding `ADMIN_PASSWORD` | `tests/production-smoke.sh` passes with `EXPECTED_SHA` set to the deployed SHA; no `"level":50` entries in Render logs during the run; the first grant sync succeeds; the previous deploy is listed for rollback | Run the smoke test (runbook §4) and the checks in prerequisite 3 |
| 5 | Record the result | Owner / operator | This file, `GO_NO_GO_DECISION.md`, a comment on Issue #8 and ClickUp `86e2tjzyc` updated with the smoke evidence file | Record it; on a pass, change the decision to **PRODUCTION GO** |

Render deploys are manual (`autoDeployTrigger: off`). No agent triggers a production deploy, creates paid resources or records an approval on the owner's behalf.

## Recommendations (not blockers)

- Turn on branch protection for `main`, requiring the `CI` checks and one approving review. Agents and the owner work under the same account, so the review is the only way to tell an owner decision apart from an agent merge.
- Add a short Grant Studio and member-sign-in section to `tests/production-smoke.sh`, so production verification covers the new routes and not only CI. Use synthetic data and clean it up.
- Close stale PR [#36](https://github.com/ebyron357/agency-content-grants/pull/36). It conflicts with `main`, is 42 commits behind, and this record supersedes it.
- Update [#27](https://github.com/ebyron357/agency-content-grants/pull/27), the grant platform plan (proposed, not on `main`). It predates R1 steps 1–5 (#40–#45), so its "what is built" section needs refreshing before it can be accepted.
- Delete the stale `feat/grant-studio` branch, which holds the secret-scan false positive, and the merged feature branches. This is the owner's call.

## Known non-blocking findings

- `minimatch` 10.2.5 moderate advisory, dev/codegen only (above).
- One production UI chunk is over 500 kB (`ProjectDetail`). Vite warns; it is not a defect.
- Residual access risks, from [`SECURITY_AND_ACCESS_HANDOFF.md`](SECURITY_AND_ACCESS_HANDOFF.md):
  - The team password has no second factor.
  - There are no passkeys.
  - Content-side approvals are not separated from writing.
  - Audit entries and API keys created before PR #42 name no person.
- Not yet on the job queue: the publishing, performance and webhook schedulers ([`BACKGROUND_JOBS.md`](BACKGROUND_JOBS.md)).
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

Evidence: `src/__tests__/security-headers.test.ts`. The headers were observed on production on 26 October, and they pass in the 4 November rehearsal smoke runs.

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
- **Grant Studio limits.**
  - Grant Studio never submits an application, never records an approval on a person's behalf, and never presents a match as an eligibility decision.
  - AI drafting uses only confirmed facts and marks gaps `[Add: …]`.
  - Demo output stays labelled.
- **Access model.**
  - Workspaces own their data through their own principal user, and every ownership check scopes to the signed-in workspace.
  - Members sign in personally; the team password (`ADMIN_PASSWORD`) signs in to the agency workspace as owner.
  - Two-factor can be required per workspace.
  - Details: [`SECURITY_AND_ACCESS_HANDOFF.md`](SECURITY_AND_ACCESS_HANDOFF.md).
- **Deployment design.** A single instance, an in-process job worker and schedulers, and a persistent Render disk. Media and exports stay on disk. Backup and retention follow the runbooks.
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

This file supersedes the earlier 4 November version, which described `main` as `3221c7b`. That version is archived verbatim at [`history/PROJECT_STATUS_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md`](history/PROJECT_STATUS_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md). Earlier snapshots, including the [2 October](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md) one, remain historical.
