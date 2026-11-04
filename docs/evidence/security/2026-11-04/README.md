# Dependency audits — 4 November 2026

Two audits ran on 4 November. Both used a Linux cloud container, Node 22.23.4 and pnpm 11.16.0 (repository-pinned). Production served `6d9f488` throughout.

## 1. Pre-deploy audit of `3221c7b` (before PR #35)

Run against `main` `3221c7bcd150d1f88664d398f871d1f397e62afc` (PR #26 merge). The audit reads `pnpm-lock.yaml`; no dependency or code change was made. Raw output: `audit.json`.

| Command | Result |
|---|---|
| `pnpm audit --audit-level=high` (the CI gate) | **PASS** (exit 0): 0 critical, 0 high |
| `pnpm audit --json` (all severities, all dependencies) | 2 moderate, 0 low |
| `pnpm audit --prod` | 1 moderate (`qs`) |

750 dependencies audited (317 production, 430 development, 13 optional).

| Package | Severity | Advisory | Path | Patched | Assessment |
|---|---|---|---|---|---|
| `qs` 6.16.0 | moderate | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) — `qs.stringify` with `arrayFormat: 'comma'` throws on elements with a non-callable own `toString` (DoS) | runtime: `express` and `express` → `body-parser` (API server, also via `express-rate-limit`) | ≥ 6.16.1 | The `qs: ^6.16.0` override held the vulnerable version. The API server only calls `qs.parse` (`express.urlencoded({ extended: true })`); no code uses `arrayFormat`. Assessed not reachable (code inspection, not an exploit test) |
| `minimatch` 10.2.5 | moderate | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) — glob-pattern amplification DoS | dev/codegen only: `lib/api-spec` → `orval` → `@orval/*` → `typedoc` | ≥ 11.0.1 (major) | Not shipped in the production bundle or server. The fix is a major version under `typedoc` |

## 2. Post-merge audit of `0131ba3` (after PR #35)

Run against `main` `0131ba338af115ab5d8c7a5c11094550e948dc9f` (PR #34 merge, which follows the PR #35 merge `e1e7df1`) after a frozen install. Raw output: `audit-post-merge-0131ba3.json`.

| Command | Result |
|---|---|
| `pnpm audit --audit-level=high` (the CI gate) | **PASS** (exit 0): 0 critical, 0 high |
| `pnpm audit --json` | 1 moderate (`minimatch`), 0 low |
| `pnpm audit --prod` | **No known vulnerabilities found** |

750 dependencies audited (317 production, 430 development, 13 optional). The PR #35 override `qs: ^6.16.1` resolves `qs` 6.17.1 in `pnpm-lock.yaml`, clearing GHSA-6pq8-jhm2-2vcw.

The same session ran format check, workspace typecheck, API unit tests (137 passed), Content OS tests (27 passed) and the production build on `0131ba3`: all pass.

## Decisions

- `qs`: **RESOLVED** by PR #35. PR #25, an earlier fix for the same advisories, was closed as superseded.
- `minimatch`: **DEFER** until `typedoc`/`orval` release a compatible update, or override and verify `orval` code generation in a separate PR. Owner: program lead. Review: next pre-deploy audit.

Audit results are time-sensitive; re-run before each deploy.
