# Pre-deploy dependency audit — 4 November 2026

Purpose: the re-audit `PROJECT_STATUS.md` requires before each production deploy, run against `main` `3221c7bcd150d1f88664d398f871d1f397e62afc` (PR #26 merge, the candidate for the next deploy). Production still runs `6d9f488`.

Environment: Linux cloud container, Node 22.23.4, pnpm 11.16.0 (repository-pinned). The audit reads `pnpm-lock.yaml`; no install, dependency change or code change was made.

## Results

| Command | Result |
|---|---|
| `pnpm audit --audit-level=high` (the CI gate) | **PASS** (exit 0): 0 critical, 0 high |
| `pnpm audit --json` (all severities, all dependencies) | 2 moderate, 0 low — `audit.json` |
| `pnpm audit --prod` | 1 moderate (`qs`) |

750 dependencies audited (317 production, 430 development, 13 optional).

| Package | Severity | Advisory | Path | Patched | Assessment |
|---|---|---|---|---|---|
| `qs` 6.16.0 | moderate | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) — `qs.stringify` with `arrayFormat: 'comma'` throws on elements with a non-callable own `toString` (DoS) | runtime: `express` and `express` → `body-parser` (API server, also via `express-rate-limit`) | ≥ 6.16.1 | The repository's `qs: ^6.16.0` override pins the vulnerable version in the lockfile. The API server uses `express.urlencoded({ extended: true })`, which calls `qs.parse`; no application code imports `qs` or uses `arrayFormat`. The vulnerable `stringify` path is therefore not believed reachable from request handling. This is a code-inspection assessment, not an exploit test |
| `minimatch` 10.2.5 | moderate | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) — glob-pattern amplification DoS | dev/codegen only: `lib/api-spec` → `orval` → `@orval/*` → `typedoc` | ≥ 11.0.1 (major) | Not shipped in the production bundle or server. The fix is a major version under `typedoc`, so an override needs a codegen compatibility check |

Both advisories were also reported (as "two moderate") during the 2 November grant-directory validation. They do not fail the CI gate and no high/critical advisory exists.

## Recommendation

- `qs`: raise the override to `^6.16.1` (or later patch) in a focused PR; same major, low risk. **Recommended before or with the next deploy**, though the assessed exposure is low.
- `minimatch`: **DEFER** until `typedoc`/`orval` release a compatible update, or override and verify `orval` code generation in a separate PR. Owner: program lead. Review: next pre-deploy audit.

Audit results are time-sensitive; re-run before each deploy.
