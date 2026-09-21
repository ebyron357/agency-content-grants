# Continuous Integration

## Canonical workflow

The required GitHub Actions gate for pull requests targeting `main` is:

- File: `.github/workflows/ci.yml`
- Workflow name: **CI**

That workflow is the only current pull-request validation contract for `main`. A green historical recovery run is not a substitute for this check.

## What the canonical workflow runs

1. Locked install: `pnpm install --frozen-lockfile`
2. Formatting check: `pnpm run format:check`
3. Repository typecheck: `pnpm run typecheck`
4. Hermetic API unit tests: `pnpm --filter @workspace/api-server test:unit`
5. Explicit disposable PostgreSQL setup: `pnpm --filter @workspace/api-server test:db:prepare`
6. Full API test suite: `pnpm --filter @workspace/api-server test`
7. Content OS tests: `pnpm --filter @workspace/content-os test`
8. Available integration tests: `bash tests/integration-tests.sh` against an isolated API
9. Production build: `pnpm run build`

The API database steps require `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, and a PostgreSQL `DATABASE_URL` whose database name ends in `_test`. Destructive reset is refused unless those guards pass.

## API test invocation

Do not run individual API Vitest files from the repository root. `@workspace/db` throws at import when `DATABASE_URL` is unset, and ESM imports are hoisted, so a missing environment surfaces as an import error instead of a setup error.

Use the package scripts:

```bash
pnpm --filter @workspace/api-server test:unit
pnpm --filter @workspace/api-server test:db:prepare
pnpm --filter @workspace/api-server test
```

`test` rejects extra file-path arguments so the full suite always runs through `vitest.config.ts` and its global database setup.

## Historical workflow

`.github/workflows/recovery-baseline-validation.yml` is historical recovery evidence. It still targets `recovery/replit-content-machine-source` and `workflow_dispatch`. It is not the required check for pull requests to `main`.
