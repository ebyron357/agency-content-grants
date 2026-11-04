# Content Machine — current project status

Status updated: **4 November 2026 (post-merge audit)**. Production was re-checked anonymously on **4 November 2026 at 10:08 UTC**. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. Governing issue: [#8](https://github.com/ebyron357/agency-content-grants/issues/8) (closed as completed by the owner on 24 October 2026). ClickUp control task: `86e2tjzyc`.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| `main` | **`0131ba338af115ab5d8c7a5c11094550e948dc9f`** ([PR #34](https://github.com/ebyron357/agency-content-grants/pull/34) merge, 4 November). Three merges ahead of production: the grant directory ([PR #26](https://github.com/ebyron357/agency-content-grants/pull/26), `3221c7b`), the `qs` override fix ([PR #35](https://github.com/ebyron357/agency-content-grants/pull/35), `e1e7df1`) and status records (PR #34). Documentation-only merges after `0131ba3` do not change the release candidate's code | Owner deploys the current `main` head (runbook) |
| Production | **LIVE — serving `6d9f4887a28d8caec52e2e32c11e61d4a74059f4`** (PR #23 merge). Anonymous re-check on 4 November: `/api/healthz` 200 reporting `6d9f488`; `/api/readyz` 200 (`configuration`, `storage`, `database` ok); anonymous `/api/projects` 401; `/` serves every PR #22 security header with no `x-powered-by`; `/grants` returns the SPA shell only because the directory is not deployed. The authenticated `tests/production-smoke.sh` run and Render log review are **not recorded** | Owner deploys `main`; an operator holding `ADMIN_PASSWORD` runs the smoke test with `EXPECTED_SHA` set to the deployed commit and reviews Render logs |
| Grant resource directory | **Merged (`3221c7b`, 2 November); not deployed.** 21 primary-source resources, filters, source dates and review indicators. Owner authorized November 2. See [scope and maintenance](GRANT_RESOURCES.md) | Ships with the next deploy of `main` |
| Previously delivered Content Machine scope | **GO — VERIFIED COMPLETE.** Historical closeout evidence is retained; new advisories do not reopen unrelated accepted functionality | Preserve accepted scope |
| HTTP security headers | **DEPLOYED** ([PR #22](https://github.com/ebyron357/agency-content-grants/pull/22)); observed on production 26 October and 4 November. Header set and decisions below | — |
| Dependency security | **PASS.** Post-merge audit of `0131ba3` on 4 November: CI gate (`--audit-level=high`) PASS; `pnpm audit --prod` reports **no known vulnerabilities**; all dependencies: **1 moderate** (`minimatch` 10.2.5, dev/codegen only). `qs` now resolves to 6.17.1 through the `^6.16.1` override (PR #35), clearing GHSA-6pq8-jhm2-2vcw. Evidence: [2026-11-04](evidence/security/2026-11-04/README.md) | `minimatch` DEFER (below). Re-audit before each production deploy |
| Local validation of `0131ba3` (4 November, Linux, Node 22.23.4, pnpm 11.16.0) | Frozen install, format check, workspace typecheck, hermetic API unit tests (137 passed), Content OS tests (27 passed) and production build pass. Existing `ProjectDetail` chunk-size warning remains. No PostgreSQL is available in the agent container, so database-backed API, integration and Playwright accessibility suites run in hosted CI only | — |
| Repository controls | **GAP — `main` has no branch protection.** `docs/CI.md` and `BRANCH_AND_PR_POLICY.md` treat CI as the required merge gate, but GitHub does not enforce it | Owner: enable branch protection on `main` requiring the CI checks (below) |
| Open pull requests | [PR #25](https://github.com/ebyron357/agency-content-grants/pull/25) closed 4 November as superseded by PR #35. Open: [PR #27](https://github.com/ebyron357/agency-content-grants/pull/27) (grant platform plan) and the stacked Grant Studio series [#29](https://github.com/ebyron357/agency-content-grants/pull/29) → [#30](https://github.com/ebyron357/agency-content-grants/pull/30) → [#31](https://github.com/ebyron357/agency-content-grants/pull/31) → [#32](https://github.com/ebyron357/agency-content-grants/pull/32) → [#33](https://github.com/ebyron357/agency-content-grants/pull/33) | Owner scope decision (below) |

## Grant Studio (open PRs #29–#33) — owner decision required

- **Scope:** about 7,600 added lines, five migrations (`0016`–`0020`), a daily in-process Grants.gov sync (1,348 opportunities on 3 November, each with a detail fetch), California Grants Portal ingestion, eligibility matching and AI-assisted application drafting. This exceeds the approved scope: `AGENTS.md` keeps automated eligibility decisions, applicant data and proposal generation deferred. It cannot merge without an explicit owner scope decision.
- **CI:** hosted CI passed on #29 (`af702d8`).
- **Merge state:** every PR in the series, and #25 before closing, conflicts with `main` in `docs/PROJECT_STATUS.md` and `docs/GO_NO_GO_DECISION.md`. A rebase onto current `main` is required before merge. #27 merges cleanly.
- **Capacity risk:** the Render plan is a 512 MB web instance and a 256 MB database ($20/month baseline, PR #21). The sync's memory, run time and database growth must be measured before deploying Grant Studio; a plan change is a cost decision for the owner.
- **Recommendation:** decide approve or park. If approved, rebase the series, merge in order with CI green, measure sync memory and database size, and deploy separately from the current release.

## Grant directory validation — November 2, 2026

Baseline: `6d62fbaf58426a4cdacbee24765e327b629a96f7`. Dedicated branch: `feat/grant-resource-directory`. No database migrations, backend changes, new dependencies or paid integrations.

- Frozen install passed (Node 24.22.1, pnpm 11.25.0; CI retains the repository-pinned versions).
- Workspace typecheck and full production build passed. Existing ProjectDetail bundle-size warning remains.
- Content OS tests: 27 passed, including six new grant tests.
- Hermetic API tests: 137 passed, plus 17 database-environment guard tests.
- Formatting and `git diff --check` passed.
- Grant browser tests: 3 passed at 1440px and 390px, covering discovery, combined filters, empty-state recovery, the sign-in UI and axe checks (no serious/critical findings). These use an explicit auth UI fixture. The real-session route check is added to the existing hosted accessibility gate.
- Local browser fallback: pinned Playwright Chromium 153 download failed (invalid archive); runtime Chromium 151 also failed. Chromium Headless Shell 134 downloaded successfully and ran the browser suite using an uncommitted local config. Full Chrome hit a container Unix-socket restriction; Vite and the test browser were started in the same process tree. No repository dependency pins or CI requirements were changed for this fallback.
- Hosted CI [41564319136](https://github.com/ebyron357/agency-content-grants/actions/runs/41564319136) passed on source commit `bf7f37e7dc74657b2c1a22843cbcf055e1ba9886`, including database-backed API tests, integration, the real-session accessibility gate, security and production build. Closeout validation [41564319258](https://github.com/ebyron357/agency-content-grants/actions/runs/41564319258) also passed.
- `pnpm audit --audit-level=high` passed with two moderate advisories, since resolved or deferred (dependency section above).

Screenshots and reproducible commands: [grant directory evidence](evidence/grants/2026-11-02/README.md). No production deployment, smoke result or new production GO is claimed.

## HTTP security headers (deployed)

`artifacts/api-server/src/middleware/securityHeaders.ts` is applied first in `app.ts`, so it covers API routes, static assets, the SPA shell and 404s:

- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
- `X-Frame-Options: DENY` (legacy browsers)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin` (YouTube embeds need a referrer, so `no-referrer` is not used)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`, only when `NODE_ENV=production` (Render terminates TLS); no `preload`
- `x-powered-by` removed

**Decision: hand-written middleware — ADOPT; `helmet` — REJECT for now.** The needed set is six fixed headers. A local middleware adds no dependency, lockfile or supply-chain change, and makes every header explicit and test-asserted. Helmet's defaults (a strict CSP, `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`) would need opting out or browser verification for the editor's embeds. Revisit if the header set grows.

**CSP decision: no source allowlist yet — DEFER.** The editor renders user-supplied `https` images and `youtube-nocookie.com` / `player.vimeo.com` iframes, and the UI loads Google Fonts and uses inline styles. An enforced `default-src`/`img-src`/`frame-src`/`style-src` policy could break authoring and has not been browser-verified, so only directives that cannot affect rendering are enforced. Next step for a full policy: ship it as `Content-Security-Policy-Report-Only`, collect violations from real authoring sessions, then enforce. Routes that already set a stricter per-response CSP (image file download) keep it.

Evidence: `src/__tests__/security-headers.test.ts` (hermetic API unit test over real HTTP: baseline headers, 404s, HSTS only in production, `x-powered-by` absent, route-level CSP override). `tests/production-smoke.sh` checks the headers on `/` and `/api/healthz`, and production serves them.

## Repair and evidence

**13 October (PR #18, merged):** pinned patched `proxy-addr` (2.0.8), `source-map-js` (1.2.2) and `prosemirror-view` (1.42.3), and replaced the `fast-glob` chain (unpatched `braces`) with Node 24's native filesystem glob. Evidence: [2026-10-13](evidence/security/2026-10-13/README.md).

**21 October (PR #19, merged as `4e7f157`):** raised `vite` (catalog and override `^7.3.7`), `markdown-it` (`^14.3.3`) and `sanitize-html` (`^2.18.0`); added overrides `fast-copy ^4.1.0` and `postcss-selector-parser ^7.1.6`. All within current major versions; zero advisories at every severity. Evidence: [2026-10-21](evidence/security/2026-10-21/README.md).

**24 October ([PR #23](https://github.com/ebyron357/agency-content-grants/pull/23), merged as `6d9f488` and deployed):** override `body-parser ^2.4.0`; API server `multer ^2.5.0` and `undici ^8.12.3`; catalog `zod ^4.6.7`; overrides `ip-address ^10.7.4` and `fast-uri ^3.1.9`; `vitest ^4.1.12`; all `@tiptap/*` aligned on `^3.32.0`. Zero advisories and `pnpm peers check` clean. Evidence: [2026-10-24](evidence/security/2026-10-24/README.md).

**4 November, pre-merge (`3221c7b`):** high gate PASS with two moderate advisories, `qs` 6.16.0 (runtime, assessed not reachable) and `minimatch` 10.2.5 (dev/codegen only).

**4 November ([PR #35](https://github.com/ebyron357/agency-content-grants/pull/35), merged as `e1e7df1`):** `qs` override raised to `^6.16.1`; the lockfile resolves `qs` 6.17.1. Post-merge audit of `0131ba3`: production dependencies clean; one moderate (`minimatch`) remains. Evidence: [2026-11-04](evidence/security/2026-11-04/README.md), `audit-post-merge-0131ba3.json`.

`sanitize-html` strips unsafe editor HTML on the server; the database-backed API tests covering rich-content sanitisation pass in CI. The security threshold, secret scanning, database guards, tenant controls and CI checks are unchanged.

## Blockers and required decisions

| Item | Evidence | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| Deploy `main` | Production serves `6d9f488`; `main` is `0131ba3` (or a later documentation-only merge); post-merge audit passes | Owner | `/api/healthz` reports the deployed `main` head after a Render manual deploy | Trigger the manual deploy (runbook) |
| Authenticated production verification | Anonymous checks pass on 4 November | Owner / operator holding `ADMIN_PASSWORD` | `tests/production-smoke.sh` passes with `EXPECTED_SHA` set to the full SHA `/api/healthz` reports; Render logs clean during the run; previous deploy (`6d9f488`) listed for rollback | Run the smoke test (runbook §4), review Render logs, record the result here, in `GO_NO_GO_DECISION.md` and ClickUp `86e2tjzyc` |
| Branch protection on `main` | GitHub reports `main` unprotected | Owner | `main` requires a PR and the CI checks **Format, typecheck, tests, build** and **Secret scan, dependency audit, SBOM** | GitHub → Settings → Branches → add a rule for `main` |
| Grant Studio scope | PRs #29–#33 open; outside approved scope | Owner | Approve (then rebase, merge and capacity-check) or park (close the PRs) | Record the decision on PR #29 |

Render deploys are manual (`autoDeployTrigger: off`). No agent creates paid resources, changes repository settings or triggers a production deploy without explicit owner authorization.

## Repository hygiene — 4 November 2026

- PR #25 (`fix/dependency-advisories-nov02`) closed as superseded by PR #35; its branch is retained.
- **Pending owner action — not yet deleted:** 23 remote branches whose content is fully contained in `main` (`git merge-base --is-ancestor`), so deleting them loses nothing: `chore/render-postgres-20-dollar-baseline`, `claude/clever-thompson-k8nnle`, `claude/implement-content-machine-closeout`, `claude/pensive-archimedes-249zds`, `claude/qs-override-6-16-1`, `copilot/audit-repo-content-machine`, `copilot/audit-repository-content-machine`, `copilot/bounded-foundation-implement`, `copilot/finish-rich-authoring-inline-media`, `copilot/foundation-implementation-baseline`, `copilot/resolve-merge-conflict`, `docs/record-pr19-merge`, `docs/record-pr23-merge-and-deploy`, `engineering/ci-test-lane-hardening`, `feat/grant-resource-directory`, `fix/dependency-advisories-oct`, `fix/dependency-advisories-oct24`, `fix/http-security-headers`, `fix/recovery-baseline-validation`, `governance/authorize-production-closeout`, `manus/content-machine-closeout`, `portfolio/security-dependency-remediation-20261013`, `release/final-closeout`. The agent's deletion attempt was blocked by the session's permission controls; the owner deletes them on GitHub (Branches page) or authorizes an agent to.
- Keep: `main`; the agent branch for this record; `recovery/replit-content-machine-source` (named in `RECOVERY_PROVENANCE.md` and `recovery-baseline-validation.yml`); every branch with commits not in `main` (the open-PR branches, `fix/dependency-advisories-nov02`, `feat/grant-studio`, `release/consolidated-closeout`, `claude/auditpost-recovery-production-readiness`, `claude/generate-repository-documentation`, `claude/resolve-merge-conflicts-in-vitest-unit-config`, `claude/website-design-dev-workflow-laf8v6`, `docs/retroactive-project-wiki`, `evidence/ui-proof-e66260b`, `feat/business-outcomes-tracking`, `agent/stage-0-governance-foundation`, `agent/wp00-wp01-baseline`, `agent/wp02-licensing-sbom`). Deleting any of these needs owner review because it would discard unmerged commits.

## Known non-blocking findings

- `minimatch` 10.2.5 moderate advisory ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)), reached only through `orval` → `typedoc` codegen; the fix is a major version. DEFER until a compatible `typedoc`/`orval` release, or override and verify code generation in a separate PR. Review at the next pre-deploy audit.
- The production UI bundle has one chunk over 500 kB (`ProjectDetail`, 171 kB gzip). Vite warns; it is not a defect and does not block release.

## Preserved product and operating constraints

- Approved scope is the delivered Content Machine plus the November 2 owner-authorized curated grant information directory. Automated eligibility, applicant data, proposal generation and submissions remain deferred unless the owner approves Grant Studio.
- One shared operator account; access is revoked by password rotation. No new identity or tenant model is introduced.
- Single instance, in-process schedulers and persistent Render disk remain the deployment design. Media and exports remain on disk; backup and retention procedures remain in the existing runbooks.
- AI providers, Typefully and production credentials are owner-managed external dependencies. Demonstration output must stay labelled.
- Production verification must demonstrate repository/deployment SHA parity, authentication and isolation, persistence, export, accessibility, runtime health and applicable rollback evidence.
- Previously verified gates are reused only where relevant code and environments remain unchanged. Each change requires its normal security and compatibility checks; it does not justify reopening unrelated completed scope.

## Governing documents and history

`AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, `docs/DOCUMENT_OWNERSHIP_MAP.md`, `docs/CI.md`, `docs/PROJECT_COMPLETION_STANDARD.md`, and the deployment, security/access, data lifecycle, admin, client, troubleshooting and acceptance manuals remain in force. This status update changes observed facts, not their security or approval policies. The October 2 GO/NO-GO record's historical gate results must not be interpreted as a current clean vulnerability audit.

The complete prior status, evidence matrix, known limitations, document index and release history are retained in [the superseded October 2 snapshot](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md); earlier November versions remain in git history. Earlier recovery records remain historical. This file supersedes every previous version as the single current status; it does not overwrite or fabricate prior evidence.
