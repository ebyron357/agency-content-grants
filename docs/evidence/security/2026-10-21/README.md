# Dependency security repair — 21 October 2026

Requested: remove every advisory remaining on `main` after the 13 October repair without disabling security checks. Baseline: `6dc15e9` (merge of PR #18). Branch: `fix/dependency-advisories-oct`.

Advisories published after PR #18 made `main` fail the existing `pnpm audit --audit-level=high` gate again: 2 high, 7 moderate, 3 low (`audit_before.json`).

| Package | Severity | Advisories | Fix |
|---|---|---|---|
| `vite` 7.0.0–7.3.6 (direct via catalog; transitive via `vitest`) | high, 3 moderate, low | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22, GHSA-9jrq-w75r-8gcw | catalog and override `^7.3.7` (resolves 7.3.7) |
| `markdown-it` < 14.3.3 (via `typedoc` / `orval`) | high, low | [GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c), GHSA-vfgh-jcmw-g37q | override `^14.3.3` (resolves 14.3.3) |
| `sanitize-html` < 2.18.0 (API server, direct) | 2 moderate, low | [GHSA-x3q4-9hxx-gx8m](https://github.com/advisories/GHSA-x3q4-9hxx-gx8m), GHSA-cv27-6wvh-8x7j, GHSA-374f-7chj-9948 | dependency `^2.18.0` (resolves 2.18.1) |
| `fast-copy` 4.0.x (via `pino-pretty`, dev) | moderate | [GHSA-jggr-w7fw-pc2j](https://github.com/advisories/GHSA-jggr-w7fw-pc2j) | override `^4.1.0` (resolves 4.2.0) |
| `postcss-selector-parser` < 7.1.6 (via `@tailwindcss/typography`, dev) | moderate | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | override `^7.1.6` (resolves 7.1.7) |

All resolved versions are within their existing major line and older than the repository's `minimumReleaseAge` (24 h). No application code, schema, authentication, tenant isolation, audit threshold or CI configuration changes.

## Local results (Windows 11, Node 24.15.0, pnpm 11.16.0)

| Check | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | — |
| `pnpm audit --audit-level=high --json` | PASS: 0 critical, 0 high, 0 moderate, 0 low | `audit.json` |
| `pnpm run build` (repository typecheck + workspace builds) | PASS | `build.log` |
| `pnpm --filter @workspace/content-os test` | PASS: 21 tests | `content_os_tests.log` |
| `pnpm --filter @workspace/mockup-sandbox test:discovery` | PASS: 2 tests | `discovery_test.log` |
| `pnpm --filter @workspace/api-server test:unit` | 17 Node tests PASS; Vitest 130/131 — `project-files.test.ts` expects POSIX paths and receives `C:\…` on Windows | `api_unit_tests.log` |
| `pnpm run format:check` | PASS on LF content; fails on this checkout only because `core.autocrlf=true` converts files to CRLF | — |

The Windows-only unit test and format results are environment effects, not regressions: this change touches no source or formatted files beyond `artifacts/api-server/package.json`, which passes Prettier. CI (Linux) is the authoritative run for both.

Not run locally (Docker daemon unavailable): database preparation, database-backed API tests (307), integration suite, Playwright accessibility. These are required CI steps and are not claimed here. Browser, production and Render verification are not claimed. Audit results are time-sensitive.
