> **Historical — superseded on 4 November 2026.** This is the PROJECT_STATUS record as it stood before the post-Grant Studio reconciliation (it describes `main` as `3221c7b`). The current record is [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md); see [`../DOCUMENT_OWNERSHIP_MAP.md`](../DOCUMENT_OWNERSHIP_MAP.md). Do not act on its instructions.

# Content Machine — current project status

Status updated: **4 November 2026**. Production observations below remain dated **26 October 2026** and have not been reverified since. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. Governing issue: [#8](https://github.com/ebyron357/agency-content-grants/issues/8). ClickUp control task: `86e2tjzyc`.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Grant resource directory | **Merged to `main` as `3221c7bcd150d1f88664d398f871d1f397e62afc` ([PR #26](https://github.com/ebyron357/agency-content-grants/pull/26), 2 November 2026); not deployed.** 21 primary-source resources, filters, source dates and review indicators. Owner authorized November 2. See [scope and maintenance](../GRANT_RESOURCES.md) | Owner triggers the Render manual deploy of `3221c7b` when ready; production verification then uses that SHA |
| Previously delivered Content Machine scope | Historical closeout evidence is retained; new advisories do not reopen unrelated accepted functionality | Preserve accepted scope |
| Production | **LIVE — deployed `main` `6d9f4887a28d8caec52e2e32c11e61d4a74059f4` (PR #23 merge).** Agent re-check on 26 October 2026 (anonymous, no credentials): `/api/healthz` reports commit `6d9f488` (SHA parity with `main`), `/api/readyz` 200, anonymous `/api/projects` 401, and `/` returns every header from PR #22 with no `x-powered-by`. The authenticated `tests/production-smoke.sh` run and Render log review are **not recorded here**. `main` is now one merge ahead (`3221c7b`, grant directory) | Recommended: owner deploys `3221c7b`, confirms `/api/healthz` reports it, then an operator holding `ADMIN_PASSWORD` runs `tests/production-smoke.sh` with `EXPECTED_SHA=3221c7bcd150d1f88664d398f871d1f397e62afc`, reviews Render logs and records the result. Without a deploy, run it with `EXPECTED_SHA=6d9f4887a28d8caec52e2e32c11e61d4a74059f4` (the run must then be repeated after the next deploy) |
| HTTP security headers | **DEPLOYED.** [PR #22](https://github.com/ebyron357/agency-content-grants/pull/22) (`4d7328d`); observed on production 26 October. Header set and decisions below | — |
| Dependency security | **PASS — merged and deployed.** [PR #23](https://github.com/ebyron357/agency-content-grants/pull/23) merged 24 October as `6d9f488` by `ebyron357` after CI passed on head `2a37fae` ([run 40117653812](https://github.com/ebyron357/agency-content-grants/actions/runs/40117653812): format, typecheck, API unit and DB-backed tests, UI tests, integration, accessibility, build, secret scan, audit, SBOM). It cleared 4 high, 7 moderate and 2 low advisories and the `@tiptap/pm` peer mismatch. Re-audit of `main` on 26 October: no known vulnerabilities. **Pre-deploy re-audit of `main` `3221c7b` on 4 November: CI gate (`--audit-level=high`) PASS — 0 critical, 0 high; 2 moderate** (`qs` 6.16.0 runtime, assessed not reachable; `minimatch` 10.2.5 dev/codegen only). Evidence: [2026-10-24](../evidence/security/2026-10-24/README.md), [2026-11-04](../evidence/security/2026-11-04/README.md) | Recommended: raise the `qs` override to `^6.16.1` in a focused PR before or with the next deploy; `minimatch` DEFER. Re-audit before each production deploy |
| October 26 local validation | Frozen install, typecheck, content-os tests, build and high-severity audit pass on Windows. One API unit test (`project-files`, POSIX paths) and the format check fail only from Windows path/CRLF effects and pass in Linux CI. Docker is unavailable locally, so database-backed API, integration and Playwright accessibility suites run in CI only | — |

## Grant directory validation — November 2, 2026

Baseline: `6d62fbaf58426a4cdacbee24765e327b629a96f7`. Dedicated branch: `feat/grant-resource-directory`. No database migrations, backend changes, new dependencies or paid integrations.

- Frozen install passed (Node 24.22.1, pnpm 11.25.0; CI retains the repository-pinned versions).
- Workspace typecheck and full production build passed. Existing ProjectDetail bundle-size warning remains.
- Content OS tests: 27 passed, including six new grant tests.
- Hermetic API tests: 137 passed, plus 17 database-environment guard tests.
- Formatting and `git diff --check` passed.
- Grant browser tests: 3 passed at 1440px and 390px, covering discovery, combined filters, empty-state recovery, the sign-in UI and axe checks (no serious/critical findings). These use an explicit auth UI fixture. The real-session route check is added to the existing hosted accessibility gate.
- Local browser fallback: pinned Playwright Chromium 153 download failed (invalid archive); runtime Chromium 151 also failed. Chromium Headless Shell 134 downloaded successfully and ran the browser suite using an uncommitted local config. Full Chrome hit a container Unix-socket restriction; Vite and the test browser were started in the same process tree. No repository dependency pins or CI requirements were changed for this fallback.
- Hosted CI [41564319136](https://github.com/ebyron357/agency-content-grants/actions/runs/41564319136) passed on source commit `bf7f37e7dc74657b2c1a22843cbcf055e1ba9886`, including database-backed API tests, integration, the real-session accessibility gate, security and production build. Closeout validation [41564319258](https://github.com/ebyron357/agency-content-grants/actions/runs/41564319258) also passed. No local PostgreSQL/Docker is available. Any later documentation-only commit must still pass required checks; the PR check list is authoritative for its current head.
- `pnpm audit --audit-level=high` passed but reported two moderate advisories. No high/critical advisories were reported. This is a new dated result, not the October 26 zero-advisory claim.

Screenshots and reproducible commands: [grant directory evidence](../evidence/grants/2026-11-02/README.md). PR #26 was merged on 2 November as `3221c7b` (merge of documentation head `8b7aa9b`). No production deployment, smoke result or new production GO is claimed.

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

Evidence: `src/__tests__/security-headers.test.ts` (hermetic API unit test over real HTTP: baseline headers, 404s, HSTS only in production, `x-powered-by` absent, route-level CSP override). A local production-mode server rendered YouTube and Vimeo embeds and an external image with the new headers and no CSP console errors, and served the built SPA assets. `tests/production-smoke.sh` now checks the headers on `/` and `/api/healthz`, and production now serves them.

## Repair and evidence

**13 October (PR #18, merged):** pinned patched `proxy-addr` (2.0.8), `source-map-js` (1.2.2) and `prosemirror-view` (1.42.3), and replaced the `fast-glob` chain (unpatched `braces`) with Node 24's native filesystem glob. Evidence: [2026-10-13](../evidence/security/2026-10-13/README.md).

**21 October (PR #19, merged as `4e7f157`):** a fresh audit of `main` found new advisories in `vite` (high), `markdown-it` (high), `sanitize-html`, `fast-copy` and `postcss-selector-parser`. The branch raises the `vite` catalog entry and adds a `vite` override to `^7.3.7` (covering the copy `vitest` pulls in), raises the `markdown-it` override to `^14.3.3`, raises the API server's `sanitize-html` to `^2.18.0`, and adds overrides `fast-copy ^4.1.0` and `postcss-selector-parser ^7.1.6`. All stay within their current major versions. The final audit reports **zero advisories at every severity**. Evidence: [2026-10-21](../evidence/security/2026-10-21/README.md).

**24 October ([PR #23](https://github.com/ebyron357/agency-content-grants/pull/23), merged as `6d9f488` and deployed):** override `body-parser ^2.4.0`; API server `multer ^2.5.0` and `undici ^8.12.3` (override too); catalog `zod ^4.6.7` (the only major change — the code already uses the `zod/v4` API, typecheck and build pass unchanged); overrides `ip-address ^10.7.4` and `fast-uri ^3.1.9`; `vitest ^4.1.12`; all `@tiptap/*` aligned on `^3.32.0`. Audit reports **zero advisories at every severity** and `pnpm peers check` is clean. Evidence: [2026-10-24](../evidence/security/2026-10-24/README.md).

**4 November (pre-deploy re-audit, no change made):** `main` `3221c7b` passes the `--audit-level=high` gate with two moderate advisories. `qs` 6.16.0 ([GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), `stringify` with `arrayFormat: 'comma'`) is a runtime dependency of `express`/`body-parser` and is held at that version by the `qs: ^6.16.0` override; the API server only calls `qs.parse` (`express.urlencoded({ extended: true })`) and no code uses `arrayFormat`, so the path is assessed as not reachable (code inspection, not an exploit test). `minimatch` 10.2.5 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) is reached only through `orval` → `typedoc` codegen and its fix is a major version. Evidence: [2026-11-04](../evidence/security/2026-11-04/README.md).

`sanitize-html` strips unsafe editor HTML on the server; the database-backed API tests covering rich-content sanitisation passed in CI before merge. The security threshold, secret scanning, database guards, tenant controls and CI checks are unchanged.

## Blockers and required decisions

| Item | Evidence | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| Deploy the grant directory | `main` is `3221c7b`; production serves `6d9f488`; 4 November audit passes the high gate | Owner | `/api/healthz` reports `3221c7b` after a Render manual deploy | Optionally merge the `qs` override fix first, then trigger the deploy (runbook) |
| Authenticated production verification | Production serves `6d9f488`; anonymous checks pass (above) | Owner / operator holding `ADMIN_PASSWORD` | `tests/production-smoke.sh` passes with `EXPECTED_SHA` set to the deployed `main` SHA (`3221c7b…` after the deploy above, otherwise `6d9f488…`); Render logs clean during the run; previous deploy listed for rollback | Run the smoke test (runbook §4) and review Render logs |
| Close Issue #8 and ClickUp `86e2tjzyc` | Issue #8 still describes production as not provisioned; ClickUp not updated by the agent (connector not authorised) | Owner / operator | Smoke result recorded here, in `GO_NO_GO_DECISION.md`, Issue #8 and ClickUp | Record the result and close |

Render deploys are manual (`autoDeployTrigger: off`). No agent creates paid resources or triggers a production deploy without explicit owner authorization.

## Known non-blocking findings

- The `@tiptap/pm` peer mismatch recorded on 22 October is fixed by PR #23.
- Two moderate dependency advisories (`qs`, `minimatch`) found on 4 November; neither fails the CI gate. Details and recommendations above and in [2026-11-04](../evidence/security/2026-11-04/README.md).
- The production UI bundle has one chunk over 500 kB (`ProjectDetail`, 171 kB gzip). Vite warns; it is not a defect and does not block release.

## Preserved product and operating constraints

- Approved scope includes the delivered Content Machine plus the November 2 owner-authorized curated grant information directory. Automated eligibility, applicant data, proposal generation and submissions remain deferred.
- One shared operator account; access is revoked by password rotation. No new identity or tenant model is introduced.
- Single instance, in-process schedulers, and persistent Render disk remain the deployment design. Media and exports remain on disk; backup and retention procedures remain in the existing runbooks.
- AI providers, Typefully, and production credentials are owner-managed external dependencies. Demonstration output must stay labelled.
- Production verification must demonstrate repository/deployment SHA parity, authentication and isolation, persistence, export, accessibility, runtime health, and applicable rollback evidence.
- Previously verified gates are reused only where relevant code and environments remain unchanged. Each change requires its normal security and compatibility checks; it does not justify reopening unrelated completed scope.

## Governing documents and history

`AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, `docs/DOCUMENT_OWNERSHIP_MAP.md`, `docs/CI.md`, `docs/PROJECT_COMPLETION_STANDARD.md`, and the deployment, security/access, data lifecycle, admin, client, troubleshooting, and acceptance manuals remain in force. This status update changes observed facts, not their security or approval policies. The October 2 GO/NO-GO record's historical gate results must not be interpreted as a current clean vulnerability audit.

The complete prior status, evidence matrix, known limitations, document index, and release history are retained in [the superseded October 2 snapshot](../history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md). Earlier recovery records remain historical. This file supersedes the 2 November version as the single current status; it does not overwrite or fabricate prior evidence.
