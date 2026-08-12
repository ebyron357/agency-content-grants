# Project Status

**Canonical status date:** 2026-08-12

**Repository:** `ebyron357/agency-content-grants`

**Current verified `main`:** `6eeead8ec49a04eb788597b75c1e6f326339608e`

**Lifecycle state:** Recovery complete; production closeout not complete

**Production decision:** **NO-GO**

This file is the canonical current status record. Recovery and governance documents remain valid historical evidence, but where a historical status statement conflicts with this file, this file governs current project status until it is deliberately replaced through an approved pull request.

## Current status at a glance

| Area | Status |
|---|---|
| GitHub recovery | **COMPLETE** |
| Canonical recovered application | **IDENTIFIED** |
| Stage 0 governance baseline | **ACTIVE** |
| Production-readiness audit | **COMPLETE; PR #6 is open and remains draft** |
| Product implementation closeout | **NOT STARTED / NOT AUTHORIZED by the audit** |
| Production infrastructure | **NOT READY / NOT DEPLOYED by this work** |
| Production launch | **NO-GO** |

## Completed recovery

GitHub was queried directly on 2026-08-12. The recovery sequence is complete:

- PR #5 is closed and merged.
- PR #5 final head is `f2a28e4c98c0f65eabd0d645509e8de8d88a21a5`.
- PR #5 merge commit is `6b118363b77724919408799f7f90bc9ce5774a7d`.
- PR #4 is closed and merged.
- PR #4 merge commit is `6eeead8ec49a04eb788597b75c1e6f326339608e`.
- Remote `main` is exactly `6eeead8ec49a04eb788597b75c1e6f326339608e` and contains stabilization commit `53fab703391edab15ad5da9c1403b7a47bf338cb` and final review-fix commit `f2a28e4c98c0f65eabd0d645509e8de8d88a21a5`.
- GitHub Actions run `31628469891` (“Recovery baseline validation”) completed successfully at the final review-fix commit.

PR #5 must not be reopened and the completed recovery review must not be repeated. The obsolete prior two-thread recovery blocker no longer applies.

## Current audit pull request

PR #6, [Correct post-recovery production-readiness audit](https://github.com/ebyron357/agency-content-grants/pull/6), is open as a draft against `main`. It changes exactly the audit, closeout plan, and this status record. It must not be merged until human review confirms that the evidence matrix, finding totals, architecture recommendation, validation distinctions, and closeout traceability are acceptable.

No PR #6 workflow checks are currently attached. The successful recovery workflow run `31628469891` belongs to PR #5's final review-fix commit and is historical application-validation evidence, not a PR #6 run.

## Governance and authorization

The repository remains in the Stage 0 governance posture described by `AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, the program charter, execution plan, governance baseline, branch/PR policy, and engineering standards.

Currently authorized work includes research, architecture, security, validation, planning, recovery evidence, and documentation on dedicated branches and pull requests. The production-readiness audit fits that authority.

Still prohibited without separate approval:

- feature implementation or a broader product-development program;
- deployment or modification of production services/data;
- direct commits to `main`, unreviewed merge, force push, history rewrite, or branch deletion;
- production credentials/customer data in tests;
- interpreting recovery completion as production approval.

## Canonical application and tree ownership

The canonical recovered application is:

- `artifacts/content-os` — React/Vite editorial frontend;
- `artifacts/api-server` — Express API and process entrypoint;
- `lib/db` — PostgreSQL/Drizzle schema and migrations;
- `lib/api-spec` — shared contract;
- `lib/api-client-react` and `lib/api-zod` — generated client and validation packages.

Other trees:

- `artifacts/mockup-sandbox` is mockup-only and is not proof of working product behavior.
- root `src` is an alternate, unresolved historical frontend outside the current pnpm workspace.
- Replit configuration/documentation is historical recovery/deployment evidence, not an approved production target.

No application tree was deleted or declared obsolete. Any archival/deletion requires a separate evidence-backed ownership decision and authorization.

## Production-readiness audit result

The complete audit is [Post-Recovery Production Readiness Audit](audits/POST_RECOVERY_PRODUCTION_READINESS.md). The ordered remediation program is [Content Machine Production Closeout Plan](plans/CONTENT_MACHINE_PRODUCTION_CLOSEOUT_PLAN.md).

Verdict: **NO-GO for production**.

The recovered codebase builds and its current automated baseline is green, but it does not meet the security, user-workflow, persistence, operations, deployment, media, citation, responsive, and accessibility evidence required for production.

Requirement results:

- VERIFIED COMPLETE: **2**
- PARTIAL: **26**
- MISSING: **8**
- BLOCKED: **0**
- NOT APPLICABLE: **0**

Issue register:

- P0: **0**
- P1: **16**
- P2: **14**
- P3: **5**

P1 closeout themes are identity/tenancy/RBAC, non-Replit routing, SSRF/file security, durable object/export storage, durable workers, full-document persistence, cross-resource authorization, server-enforced readiness, citations/media, observability, CI/CD/recovery, approved dependency scanning, and complete browser E2E.

## Validation record

Validation used synthetic credentials, demo-safe AI behavior, and disposable PostgreSQL 16 on `127.0.0.1:5433`; no production credentials or data were used.

| Check | Result |
|---|---|
| Frozen pnpm install | PASS — all 9 workspace projects |
| Typecheck | PASS — all workspace applications/packages |
| API tests | PASS — 24 files, 249 passed, 0 failed, 0 skipped |
| Content OS tests | PASS — 1 file, 10 passed, 0 failed, 0 skipped |
| Migration reset/replay | PASS twice through migration `0014` |
| Build | PASS; Content OS emitted a ~603 kB chunk warning |
| API health | PASS — HTTP 200, `{"status":"ok"}` |
| Secret-pattern scan | PASS in defined repository scope; only `.env.example` is tracked |
| Local integration shell suite | BLOCKED by missing Bash+`jq` runner and safety denial of the proposed disposable runner; not bypassed |
| Live recovery integration evidence | PASS — GitHub Actions run `31628469891`, 38 checks, 0 failed/skipped |
| Dependency advisory review | BLOCKED pending explicit approval to transmit dependency metadata to the npm advisory service |
| Browser smoke | PARTIAL/BLOCKED — login renders; repository lacks non-Replit same-origin API routing, so authentication journey cannot complete |

The passing totals are 259 locally executed automated tests plus 38 corroborating live integration checks. Blocked checks remain visible and are not counted as local passes.

## Recommended production architecture

The audit recommends Render for the always-on Express API, background worker, and paid managed PostgreSQL/PITR, with a same-origin frontend/API gateway and private S3-compatible object storage for source files, media, and exports. Durable queue workers replace detached/in-process work. Preview, staging, and production environments must have isolated domains, secrets, data, budgets, telemetry, backups, and promotion gates.

This is a recommendation, not an infrastructure purchase or deployment authorization. Vercel is suitable only as a possible frontend host in this design; Supabase or Neon can be components but do not by themselves host the current Express/worker runtime.

## Required human decisions

**Exact next human decision:** review the corrected PR #6 documentation and either accept it as the production-closeout planning baseline or request specific further corrections. Accepting or merging documentation does not authorize WP0 implementation, infrastructure purchase, deployment, or production launch.

Before implementation:

1. target user/tenant model, identity provider, roles, admin step-up, and account lifecycle;
2. data classification, residency, retention/deletion, RTO/RPO, and backup ownership;
3. citation style/quality/export gates and image/video product scope;
4. Render/object-store/queue/observability vendors, regions, and budget;
5. accessibility target and supported mobile/desktop matrix;
6. ownership/disposition of the alternate root frontend;
7. authorization for dependency metadata transmission to an approved SCA/advisory service.

Before production:

- every P1 must be closed;
- the complete browser journey must pass without manual API calls on mobile and desktop;
- approved security/SCA, restore, rollback, worker-recovery, migration, load, accessibility, and real-provider sandbox evidence must pass;
- product, editorial, accessibility, privacy/security, engineering, and operations owners must issue an explicit launch GO for the exact immutable release.

## Next execution sequence

1. Approve product/identity/data/media/platform decisions (WP0).
2. Rationalize the canonical tree and contract (WP1).
3. Implement identity/tenancy/RBAC and security defects (WP2–WP3).
4. Build platform-neutral routing, object storage, and durable workers (WP4–WP6).
5. Complete editor/citations/media/responsive workflows and production operations (WP7–WP11).
6. Run the final controlled production verification and launch gate (WP12).

Until those gates are satisfied, the only accurate status is:

> **Recovery complete. Audit complete. Production closeout required. Production NO-GO.**
