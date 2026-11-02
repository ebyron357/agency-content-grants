# Dependency security repair — 2 November 2026

Baseline: `main` at `6d62fba` (production runs `6d9f488`; the commits after it change documentation only). Branch: `fix/dependency-advisories-nov02`.

A re-audit of `main` on 2 November found two moderate advisories published after the clean audit of 26 October (`audit_before.json`). Neither is high, so the existing `pnpm audit --audit-level=high` gate still passed. The status record, however, requires a clean re-audit before each production deploy.

| Package | Severity | Path | Advisory | Fix |
|---|---|---|---|---|
| `qs` 6.7.0–6.16.0 (resolved 6.16.0) | moderate | `express` 5 → `body-parser` → `qs`: **runtime**, parses API request bodies and query strings | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) | override `^6.16.1` (resolves 6.17.1, same major) |
| `minimatch` < 11.0.1 (resolved 10.2.5) | moderate | `orval` → `@orval/core` → `typedoc` → `minimatch`: **development only**, used by API code generation | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | override `typedoc>minimatch: ^11.0.1` (resolves 11.0.3) — see note |

**`minimatch` note: the one major-version change.** The fix exists only in minimatch 11. The newest `typedoc` (0.28.20) still declares `minimatch ^10.2.5`, so the override is scoped to `typedoc` and changes nothing else. `typedoc` is reached only through `orval` when the API client and schemas are regenerated. Proof that it still works: `orval --config ./orval.config.ts` in `lib/api-spec` regenerated `lib/api-client-react` and `lib/api-zod` byte-for-byte identical to the committed files, both before and after the change (`git status` clean apart from the lockfile and workspace file).

No application code, schema, authentication, tenant isolation, audit threshold or CI configuration changes. The resolved versions are older than the repository's `minimumReleaseAge` (24 h).

## Local results (Linux container, Node 22.23.4, pnpm 11.16.0)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm audit --audit-level=high --json` | PASS: 0 critical, 0 high, 0 moderate, 0 low (`audit.json`) |
| `pnpm why -r qs` / `pnpm why -r minimatch` | only `qs@6.17.1` and `minimatch@11.0.3` are resolved |
| `orval` code generation (before and after) | output identical to the committed generated files |
| `pnpm run format:check` | PASS |
| `pnpm run build` (repository typecheck and workspace builds) | PASS. Vite still warns about the one chunk over 500 kB (known, non-blocking) |
| `pnpm --filter ./artifacts/api-server test:unit` | PASS: 20 files, 137 tests (including `project-files`, which fails only on Windows) |
| `pnpm --filter ./artifacts/content-os test` | PASS: 4 files, 21 tests |

Not run locally (no Docker daemon): database preparation, the database-backed API tests (which exercise request parsing end to end), the integration suite and Playwright accessibility. These are required CI steps, and the PR's CI run is the authoritative result. Production, browser and Render verification are not claimed. Audit results are time-sensitive.
