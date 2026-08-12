# Recovery Validation

Validation date: 2026-08-12

Recovery commit: `fba398e2945fc39405b9bdf2543b28df4aac65ee`

Stabilization branch: `fix/recovery-baseline-validation`

## Environment

- Local: Windows x64, Node.js `v24.15.0`, pnpm `11.16.0`
- Database validation: GitHub Actions Ubuntu runner with an isolated
  `postgres:16-alpine` service and database `content_machine_test`
- Database contents: migrations plus controlled seed/test records only; no
  customer data

## Repairs

The eight recovered TypeScript diagnostics were fixed without exclusions,
suppressions, or weaker compiler settings:

- `MemphisMealKitLinkPage-LhU6mj/index.tsx`: one `TS2345` caused by
  `useState(null)` inferring a null-only setter. The hover state now explicitly
  accepts `number | null`.
- `WarmAPIContactPage-qao9Pa/App.tsx`: seven implicit-`any` diagnostics
  (`TS7006`/`TS7031`) caused by an untyped curried form handler and feature-table
  component/data. The handler now uses `keyof` plus the concrete React change
  event union; feature values, rows, groups, and props now have explicit types.

The mockup Vite configuration now requires `PORT` only for serving and defaults
`BASE_PATH` to `/` for deterministic CI builds. It statically imports the
optional Cartographer plugin so the recovered Vite version's synchronous config
type remains valid.

## Disposable database contract

`assertDisposableTestDatabase` refuses reset/migration operations unless all of
these conditions hold:

1. `NODE_ENV=test`.
2. `ALLOW_TEST_DATABASE_RESET=true`.
3. `DATABASE_URL` uses PostgreSQL.
4. The host is exactly `localhost`, `127.0.0.1`, or the CI service name
   `postgres`.
5. The database name ends in `_test`.

The API Vitest global setup drops and recreates the guarded database's `public`
schema, removes the disposable database's Drizzle migration ledger, then runs
every migration. Clearing both is required so repeated resets cannot leave an
empty schema paired with stale migration records. The same guarded preparation
command runs before integration tests. Direct tests prove the accept and refusal
paths.

## Command evidence

| Command                                    | Result     | Evidence                                                                                                    |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`           | PASS       | All 9 workspace projects installed from the committed lockfile.                                             |
| `pnpm run typecheck`                       | PASS       | All library builds and all four typechecked workspace targets exited 0 with no diagnostics.                 |
| `pnpm --filter @workspace/content-os test` | PASS       | 1 file passed; 10 tests passed; 0 failed.                                                                   |
| `pnpm run build`                           | PASS       | Mockup Sandbox, API Server, and Content OS production builds completed after aggregate typecheck.           |
| `pnpm --filter @workspace/api-server test` | CI PENDING | Runs against isolated PostgreSQL; exact totals will replace this entry.                                     |
| `bash tests/integration-tests.sh`          | CI PENDING | Runs against the built API and isolated PostgreSQL with no skip flag; exact totals will replace this entry. |

## Build-warning investigation

The three reported Content OS sourcemap warnings came from Next.js-style
`'use client'` directives in `tooltip.tsx`, `label.tsx`, and `select.tsx`. Content
OS is a Vite client application, so those directives have no runtime function;
removing them is safe and removes the warnings.

Vite still reports that the minified Content OS entry chunk is approximately
602.95 kB (175.01 kB gzip), above its advisory 500 kB threshold. The root cause
is the recovered single-entry application bundling its React/UI/editor
dependencies together. This can increase initial parse/download time but does
not affect correctness or reproducibility. Route-level dynamic imports should be
evaluated in a separately authorized performance change; forcing manual chunks
during recovery would change runtime loading behavior. This advisory is not a
recovery release blocker.

## Secret scan

The post-change pattern scan found no private keys, provider tokens, or real
credentials. Matches are limited to conspicuously synthetic, isolated test
database/password values and the pre-existing `.env.example` placeholder. No
`.env` file or customer data is introduced.

## Gate

PENDING until the PostgreSQL-backed GitHub Actions run supplies complete API and
integration totals with zero failures and zero skips. No deployment or merge has
occurred.
