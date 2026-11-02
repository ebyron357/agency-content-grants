# Content Machine — current project status

Status date: **2 November 2026**. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. Governing issue: [#8](https://github.com/ebyron357/agency-content-grants/issues/8) (closed by the owner on 24 October 2026; see Blockers). ClickUp control task: `86e2tjzyc`.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Previously delivered Content Machine scope | Historical closeout evidence is retained; new advisories do not reopen unrelated accepted functionality | Preserve accepted scope |
| Production | **LIVE: deployed `main` `6d9f4887a28d8caec52e2e32c11e61d4a74059f4` (PR #23 merge).** The agent re-checked it on 26 October and again on 2 November 2026, both times anonymously, with no credentials. `/api/healthz` reports commit `6d9f488` (SHA parity with the deployed code; the later `main` commits change documentation only). `/api/readyz` returns 200, anonymous `/api/projects` returns 401, and `/` returns the PR #22 headers (`content-security-policy`, `x-frame-options`, `strict-transport-security`). The authenticated `tests/production-smoke.sh` run and Render log review are **not recorded here** | An operator holding `ADMIN_PASSWORD` runs `tests/production-smoke.sh` with `EXPECTED_SHA` set to the deployed commit, reviews Render logs, and records the result |
| HTTP security headers | **DEPLOYED.** [PR #22](https://github.com/ebyron357/agency-content-grants/pull/22) (`4d7328d`); observed on production on 26 October and 2 November. Header set and decisions below | — |
| Dependency security | **IN PROGRESS: 2 moderate advisories, fix on branch `fix/dependency-advisories-nov02`.** A re-audit of `main` on 2 November found two advisories published after the clean audit of 26 October. `qs` 6.16.0 ([GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)) is in the runtime path (`express` → `body-parser`), so production is affected until the fix is deployed. `minimatch` 10.2.5 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) is reached only through `orval` → `typedoc` during code generation. The branch overrides `qs ^6.16.1` (resolves 6.17.1) and `typedoc>minimatch ^11.0.1` (resolves 11.0.3), and the audit then reports zero advisories at every severity. The existing `--audit-level=high` gate passed throughout, because both advisories are moderate. Evidence: [2026-11-02](evidence/security/2026-11-02/README.md). Previous repair: [PR #23](https://github.com/ebyron357/agency-content-grants/pull/23), merged and deployed as `6d9f488` on 24 October ([evidence](evidence/security/2026-10-24/README.md)) | Merge the branch's PR once CI is green; include it in the next production deploy; re-audit before each deploy |
| Local validation (2 November, Linux) | Frozen install, format check, repository typecheck and build, API unit tests (137, including `project-files`, which fails only on Windows), UI tests (21), audit and identical API code generation all pass on the advisory branch. Docker is unavailable locally, so the database-backed API, integration and Playwright accessibility suites run in CI only | — |

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

Evidence: `src/__tests__/security-headers.test.ts` (hermetic API unit test over real HTTP: baseline headers, 404s, HSTS only in production, `x-powered-by` absent, route-level CSP override). A local production-mode server rendered YouTube and Vimeo embeds and an external image with the new headers and no CSP console errors, and served the built SPA assets. `tests/production-smoke.sh` checks the headers on `/` and `/api/healthz`, and production serves them.

## Repair and evidence

**13 October (PR #18, merged):** pinned patched `proxy-addr` (2.0.8), `source-map-js` (1.2.2) and `prosemirror-view` (1.42.3), and replaced the `fast-glob` chain (unpatched `braces`) with Node 24's native filesystem glob. Evidence: [2026-10-13](evidence/security/2026-10-13/README.md).

**21 October (PR #19, merged as `4e7f157`):** a fresh audit of `main` found new advisories in `vite` (high), `markdown-it` (high), `sanitize-html`, `fast-copy` and `postcss-selector-parser`. PR #19:
- raised the `vite` catalog entry and added a `vite` override to `^7.3.7`, covering the copy `vitest` pulls in;
- raised the `markdown-it` override to `^14.3.3`;
- raised the API server's `sanitize-html` to `^2.18.0`;
- added overrides `fast-copy ^4.1.0` and `postcss-selector-parser ^7.1.6`.

All stayed within their current major versions, and the final audit reported **zero advisories at every severity**. Evidence: [2026-10-21](evidence/security/2026-10-21/README.md).

**24 October ([PR #23](https://github.com/ebyron357/agency-content-grants/pull/23), merged as `6d9f488` and deployed):**
- override `body-parser ^2.4.0`;
- API server `multer ^2.5.0` and `undici ^8.12.3` (override too);
- catalog `zod ^4.6.7`: the only major change; the code already used the `zod/v4` API, and typecheck and build passed unchanged;
- overrides `ip-address ^10.7.4` and `fast-uri ^3.1.9`;
- `vitest ^4.1.12`;
- all `@tiptap/*` aligned on `^3.32.0`.

The audit reported **zero advisories at every severity**, and `pnpm peers check` was clean. Evidence: [2026-10-24](evidence/security/2026-10-24/README.md).

**2 November (branch `fix/dependency-advisories-nov02`, not merged):**
- override `qs ^6.16.1` (resolves 6.17.1, same major);
- scoped override `typedoc>minimatch ^11.0.1` (resolves 11.0.3). This is the only major change. The newest `typedoc` still declares `minimatch ^10.2.5`, and `orval` code generation produces output identical to the committed generated files.

The audit reports **zero advisories at every severity**. Evidence: [2026-11-02](evidence/security/2026-11-02/README.md).

`sanitize-html` strips unsafe editor HTML on the server; the database-backed API tests covering rich-content sanitisation passed in CI before merge. The security threshold, secret scanning, database guards, tenant controls and CI checks are unchanged.

## Blockers and required decisions

| Item | Evidence | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| Runtime `qs` advisory in production | Production `6d9f488` resolves `qs` 6.16.0. The fix is on `fix/dependency-advisories-nov02` | Agent (PR and CI); owner (merge and deploy) | PR CI green and merged; the deploy includes it; post-deploy audit and smoke test pass | Merge the PR, then deploy it together with the smoke-test run below |
| Authenticated production verification | Production serves `6d9f488`; anonymous checks pass (above) | Owner, or an operator holding `ADMIN_PASSWORD` | `tests/production-smoke.sh` passes with `EXPECTED_SHA` set to the deployed commit; Render logs clean during the run; the previous deploy listed for rollback | Run the smoke test (runbook §4) and review Render logs |
| Records: Issue #8 and ClickUp `86e2tjzyc` | The owner closed Issue #8 as completed on 24 October 2026, before the authenticated production verification. ClickUp has not been updated by the agent (connector not authorised) | Owner, or an operator | Smoke result recorded here, in `GO_NO_GO_DECISION.md`, as a comment on Issue #8, and in ClickUp | Record the result; Issue #8 needs no further state change |

Render deploys are manual (`autoDeployTrigger: off`). No agent creates paid resources or triggers a production deploy without explicit owner authorization.

## Known non-blocking findings

- The production UI bundle has one chunk over 500 kB (`ProjectDetail`, 171 kB gzip). Vite warns; it is not a defect and does not block release.

## Preserved product and operating constraints

- Approved scope is the delivered Content Machine. Grant/proposal intelligence remains deferred under existing owner decisions.
- One shared operator account; access is revoked by password rotation. No new identity or tenant model is introduced.
- Single instance, in-process schedulers, and persistent Render disk remain the deployment design. Media and exports remain on disk; backup and retention procedures remain in the existing runbooks.
- AI providers, Typefully, and production credentials are owner-managed external dependencies. Demonstration output must stay labelled.
- Production verification must demonstrate repository/deployment SHA parity, authentication and isolation, persistence, export, accessibility, runtime health, and applicable rollback evidence.
- Previously verified gates are reused only where relevant code and environments remain unchanged. Each change requires its normal security and compatibility checks; it does not justify reopening unrelated completed scope.

## Governing documents and history

`AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, `docs/DOCUMENT_OWNERSHIP_MAP.md`, `docs/CI.md`, `docs/PROJECT_COMPLETION_STANDARD.md`, and the deployment, security/access, data lifecycle, admin, client, troubleshooting, and acceptance manuals remain in force. This status update changes observed facts, not their security or approval policies. The October 2 GO/NO-GO record's historical gate results must not be interpreted as a current clean vulnerability audit.

The complete prior status, evidence matrix, known limitations, document index, and release history are retained in [the superseded October 2 snapshot](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md). Earlier recovery records remain historical. This file supersedes the 26 October version as the single current status; it does not overwrite or fabricate prior evidence.
