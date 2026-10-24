# Content Machine — current project status

Status date: **22 October 2026**. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. Governing issue: [#8](https://github.com/ebyron357/agency-content-grants/issues/8). ClickUp control task: `86e2tjzyc`.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Previously delivered Content Machine scope | Historical closeout evidence is retained; new advisories do not reopen unrelated accepted functionality | Preserve accepted scope |
| Production | **LIVE** at `https://agency-content-grants.onrender.com`, running `main` `d9a06e715ed0cbb0ad399addd7cb6ba0b02cf0ef` (PR #21 merge). Operator verification on 22 October 2026 covered health, readiness, SHA parity, anonymous 401s and the CORS allowlist; `/api/healthz` (commit `d9a06e7`) and `/api/readyz` (200) were re-checked during the security-headers work | Owner triggers manual Render deploys; operator runs `tests/production-smoke.sh` after each |
| HTTP security headers | **IN REVIEW — not deployed.** Production responses currently lack HSTS, framing protection, `nosniff` (except two download routes) and `Referrer-Policy`, and expose `x-powered-by: Express`. The security-headers PR adds them (see below) | Review and merge the PR; owner deploys; operator confirms with `tests/production-smoke.sh` |
| Dependency security | **PASS — merged.** [PR #19](https://github.com/ebyron357/agency-content-grants/pull/19) (`4e7f157`) removed every advisory published after PR #18. On 22 October `pnpm audit --audit-level=high` passes (2 moderate advisories reported, none high or critical) | Re-audit before each production deploy, since audit results are time-sensitive |
| Local validation | Frozen install, typecheck, content-os tests, build and high-severity audit pass on Windows. One API unit test (`project-files`, POSIX paths) and the format check fail only from Windows path/CRLF effects and pass in Linux CI. Docker is unavailable locally, so database-backed API, integration and Playwright accessibility suites run in CI only | — |

## HTTP security headers (in review)

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

Evidence: `src/__tests__/security-headers.test.ts` (hermetic API unit test over real HTTP: baseline headers, 404s, HSTS only in production, `x-powered-by` absent, route-level CSP override). A local production-mode server rendered YouTube and Vimeo embeds and an external image with the new headers and no CSP console errors, and served the built SPA assets. `tests/production-smoke.sh` now checks the headers on `/` and `/api/healthz`, so it will fail against production until the change is deployed.

## Repair and evidence

**13 October (PR #18, merged):** pinned patched `proxy-addr` (2.0.8), `source-map-js` (1.2.2) and `prosemirror-view` (1.42.3), and replaced the `fast-glob` chain (unpatched `braces`) with Node 24's native filesystem glob. Evidence: [2026-10-13](evidence/security/2026-10-13/README.md).

**21 October (PR #19, merged as `4e7f157`):** a fresh audit of `main` found new advisories in `vite` (high), `markdown-it` (high), `sanitize-html`, `fast-copy` and `postcss-selector-parser`. The branch raises the `vite` catalog entry and adds a `vite` override to `^7.3.7` (covering the copy `vitest` pulls in), raises the `markdown-it` override to `^14.3.3`, raises the API server's `sanitize-html` to `^2.18.0`, and adds overrides `fast-copy ^4.1.0` and `postcss-selector-parser ^7.1.6`. All stay within their current major versions. The final audit reports **zero advisories at every severity**. Evidence: [2026-10-21](evidence/security/2026-10-21/README.md).

`sanitize-html` strips unsafe editor HTML on the server; the database-backed API tests covering rich-content sanitisation passed in CI before merge. The security threshold, secret scanning, database guards, tenant controls and CI checks are unchanged.

## Blockers and required decisions

| Item | Evidence | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| Deploy security headers | Security-headers PR (in review) | Product owner / Render account holder | PR merged with CI green; manual Render deploy of the merged `main` SHA; `tests/production-smoke.sh` passes including header checks | Review and merge, then trigger the deploy |

Render deploys are manual (`autoDeployTrigger: off`). No agent creates paid resources or triggers a production deploy without explicit owner authorization.

## Known non-blocking findings

- `pnpm peers check` reports `@tiptap/core` 3.31.3 wanting `@tiptap/pm` 3.31.3 while 3.30.0 is installed. This is present on `main` before this change and is not altered here.

## Preserved product and operating constraints

- Approved scope is the delivered Content Machine. Grant/proposal intelligence remains deferred under existing owner decisions.
- One shared operator account; access is revoked by password rotation. No new identity or tenant model is introduced.
- Single instance, in-process schedulers, and persistent Render disk remain the deployment design. Media and exports remain on disk; backup and retention procedures remain in the existing runbooks.
- AI providers, Typefully, and production credentials are owner-managed external dependencies. Demonstration output must stay labelled.
- Production verification must demonstrate repository/deployment SHA parity, authentication and isolation, persistence, export, accessibility, runtime health, and applicable rollback evidence.
- Previously verified gates are reused only where relevant code and environments remain unchanged. Each change requires its normal security and compatibility checks; it does not justify reopening unrelated completed scope.

## Governing documents and history

`AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, `docs/DOCUMENT_OWNERSHIP_MAP.md`, `docs/CI.md`, `docs/PROJECT_COMPLETION_STANDARD.md`, and the deployment, security/access, data lifecycle, admin, client, troubleshooting, and acceptance manuals remain in force. This status update changes observed facts, not their security or approval policies. The October 2 GO/NO-GO record's historical gate results must not be interpreted as a current clean vulnerability audit.

The complete prior status, evidence matrix, known limitations, document index, and release history are retained in [the superseded October 2 snapshot](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md). Earlier recovery records remain historical. This file supersedes the 21 October version as the single current status; it does not overwrite or fabricate prior evidence.
