# Dependency security repair — 24 October 2026

Requested: close every remaining project issue before the next production deploy. Baseline: `4d7328d` (merge of PR #22). Branch: `fix/dependency-advisories-oct24`.

Advisories published after PR #19 made `main` fail the existing `pnpm audit --audit-level=high` gate again: 4 high, 7 moderate, 2 low (`audit_before.json`). Production (`d9a06e7`) runs the same vulnerable `body-parser`, `multer` and `zod` versions, so the next deploy must include this change.

| Package | Severity | Advisories | Fix |
|---|---|---|---|
| `body-parser` 2.0.0–2.3.x (via `express` 5, runtime) | high | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | override `^2.4.0` (resolves 2.4.0) |
| `multer` 2.0.0–2.4.x (API server, direct, runtime) | high | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) | dependency `^2.5.0` (resolves 2.5.0) |
| `zod` < 4.6.6 (catalog; `@workspace/api-zod`, `@workspace/db`, UI) | high | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | catalog `^4.6.7` (resolves 4.6.7) — see note |
| `undici` 8.0.0–8.12.1 (API server, direct; `jsdom`) | high, 2 moderate | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472 | dependency and override `^8.12.3` (resolves 8.12.3) |
| `ip-address` ≤ 10.7.3 (via `express-rate-limit`, runtime) | moderate | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) | override `^10.7.4` |
| `@vitest/mocker` < 4.1.12 (via `vitest`, dev) | 2 moderate | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), GHSA-xp26-3454-mjgp | `vitest` `^4.1.12` in API server and UI |
| `fast-uri` < 3.1.9 (via `orval`, dev/codegen) | moderate, 2 low | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp | override `^3.1.9` |

**`zod` note — the one major-version change.** The fix exists only in zod 4. The codebase already imports the v4 API through `zod/v4` in every hand-written schema (34 imports); the generated `lib/api-zod/src/generated/api.ts` imports bare `zod`, which now resolves to the same v4 API. Repository-wide typecheck and build pass with no source changes, and `drizzle-zod` 0.8.3 declares `zod ^3.25.0 || ^4.0.0`. Request validation behaviour is exercised by the database-backed API suite in CI.

**Also fixed:** the known `pnpm peers check` finding (`@tiptap/core` 3.31.3 wanting `@tiptap/pm` 3.31.3 while 3.30.0 was installed). All `@tiptap/*` packages and the `@tiptap/core` override are aligned on `^3.32.0`; `pnpm peers check` now reports no issues. Editor behaviour is covered by the UI tests and the Playwright accessibility gate in CI.

All resolved versions are older than the repository's `minimumReleaseAge` (24 h). No application code, schema, authentication, tenant isolation, audit threshold or CI configuration changes.

## Local results (Windows 11, Node 24.15.0, pnpm 11.16.0)

| Check | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | — |
| `pnpm audit --audit-level=high --json` | PASS: 0 critical, 0 high, 0 moderate, 0 low | `audit.json` |
| `pnpm peers check` | PASS: no peer dependency issues | — |
| `pnpm run build` (repository typecheck + workspace builds) | PASS | `build.log` |
| `pnpm --filter ./artifacts/content-os test` | PASS: 21 tests | `content_os_tests.log` |
| `pnpm --filter @workspace/mockup-sandbox test:discovery` | PASS: 2 tests | `discovery_test.log` |
| `pnpm --filter ./artifacts/api-server test:unit` | Node tests PASS; Vitest 136/137 — `project-files.test.ts` expects POSIX paths and receives `C:\…` on Windows (same known effect as 21 October) | `api_unit_tests.log` |

Not run locally (Docker daemon unavailable): database preparation, database-backed API tests, integration suite, Playwright accessibility, format check on LF content. These are required CI steps and are not claimed here; the PR's CI run is the authoritative result. Browser, production and Render verification are not claimed. Audit results are time-sensitive.
