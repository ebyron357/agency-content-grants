# Continuous Integration

## Canonical workflow

The required GitHub Actions gate for pull requests targeting `main` is:

- File: `.github/workflows/ci.yml`
- Workflow name: **CI**
- Triggers: `pull_request` to `main`, and `workflow_dispatch` (use it to re-validate `main` itself after a merge)

That workflow is the only pull-request validation contract for `main`. A green historical recovery run is not a substitute for this check.

## What the canonical workflow runs

Job **Format, typecheck, tests, build** (PostgreSQL 16 service container):

1. Locked install: `pnpm install --frozen-lockfile`
2. Formatting check: `pnpm run format:check`
3. Repository typecheck: `pnpm run typecheck`
4. Hermetic API unit tests: `pnpm --filter @workspace/api-server test:unit`
5. Explicit disposable PostgreSQL setup: `pnpm --filter @workspace/api-server test:db:prepare`
6. Full API test suite: `pnpm --filter @workspace/api-server test`
7. Content OS tests: `pnpm --filter @workspace/content-os test`
8. API and frontend builds, then an isolated API server
9. Integration tests: `bash tests/integration-tests.sh` (no skips allowed)
10. Authenticated accessibility gate: `pnpm --filter @workspace/content-os test:a11y` — Playwright + axe (WCAG 2.0/2.1 A/AA, serious and critical) on login, Create, Dashboard, Documents, Brands, Brand detail, Distribution, Performance, Settings, 404 and all nine Project workflow tabs, plus dark-shell token, 390px navigation and no-horizontal-overflow assertions
11. Production build: `pnpm run build`

Job **Secret scan, dependency audit, SBOM**:

1. gitleaks over the full history (`fetch-depth: 0`)
2. `pnpm audit --audit-level=high`
3. CycloneDX SBOM uploaded as the `sbom` artifact (90-day retention)

`.github/workflows/content-closeout.yml` (**Content Machine closeout validation**) is an additional fast check (typecheck, unit tests, build, secret-pattern scan) on the same pull requests.

## API test invocation

The API database steps require `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, and a PostgreSQL `DATABASE_URL` whose database name ends in `_test`. Destructive reset is refused unless those guards pass.

Do not run individual API Vitest files from the repository root. `@workspace/db` throws at import when `DATABASE_URL` is unset, and ESM imports are hoisted, so a missing environment surfaces as an import error instead of a setup error.

Use the package scripts:

```bash
pnpm --filter @workspace/api-server test:unit
pnpm --filter @workspace/api-server test:db:prepare
pnpm --filter @workspace/api-server test
```

`test` rejects extra file-path arguments so the full suite always runs through `vitest.config.ts` and its global database setup.

## Production verification

CI does not deploy. Production verification runs after a manual Render deploy with `tests/production-smoke.sh`; see `docs/DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`.

## Historical workflow

`.github/workflows/recovery-baseline-validation.yml` is historical recovery evidence. It targets `recovery/replit-content-machine-source` and `workflow_dispatch`. It is not the required check for pull requests to `main`.
