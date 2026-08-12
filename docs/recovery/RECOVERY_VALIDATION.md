# Recovery Validation

Validation date: 2026-08-12  
Branch: `recovery/replit-content-machine-source`

## Environment

- Node.js: `v24.15.0`
- pnpm: `11.16.0`
- Platform: Windows x64

## Command results

| Command | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | PASS | All 9 workspace projects installed from the lockfile; pnpm supply-chain policy check passed; esbuild postinstall completed. |
| `pnpm run typecheck` | FAIL | API server and scripts passed. `artifacts/mockup-sandbox` failed with 8 TypeScript errors across two mockup templates; the recursive command stopped. |
| `pnpm --filter @workspace/content-os typecheck` | PASS | TypeScript exited 0 with no diagnostics. |
| `pnpm --filter @workspace/api-server test` | FAIL | 19 test files passed and 3 suites failed to load. 202 tests passed; no test assertion failures were reported. The three failed suites require `DATABASE_URL`, which was intentionally not invented or connected during recovery. |
| `pnpm --filter @workspace/content-os test` | PASS | 1 test file passed; 10 tests passed. |
| `bash tests/integration-tests.sh --skip-e2e` | BLOCKED | Requires a running API, configured database, seeded records, and performs application-data writes. Recovery did not create or mutate a database. |
| `pnpm run build` | FAIL | Root build stops at the same 8 `artifacts/mockup-sandbox` type errors before recursive package builds. |
| `pnpm --filter @workspace/api-server build` | PASS | esbuild produced the API distribution successfully. |
| `pnpm --filter @workspace/content-os build` | PASS WITH WARNINGS | Vite transformed 2,149 modules and produced `dist/public`; it reported three sourcemap warnings and a 602.95 kB JavaScript chunk warning. |

## Typecheck failures

`artifacts/mockup-sandbox/src/components/mockups/templates/MemphisMealKitLinkPage-LhU6mj/index.tsx`:

- Line 332: `TS2345`, number passed to state inferred as `null`.

`artifacts/mockup-sandbox/src/components/mockups/templates/WarmAPIContactPage-qao9Pa/App.tsx`:

- Line 85: two `TS7006` implicit-`any` parameters.
- Line 443: `TS7031` implicit-`any` destructured binding.
- Line 451: two `TS7006` implicit-`any` parameters.
- Line 454: two `TS7006` implicit-`any` parameters.

These recovered source errors were recorded, not suppressed or changed.

## API test blockers

The following suites failed during module import because `lib/db/src/index.ts`
requires `DATABASE_URL`:

- `src/lib/brand-brain.test.ts`
- `src/__tests__/performance-aggregation.test.ts`
- `src/__tests__/performance-recommendations.test.ts`

No production or local database URL was fabricated, discovered, or used.

## Recovery conclusion

The intended API and Content OS packages independently typecheck/build as
recorded above, and the frontend tests pass. The aggregate workspace gate is not
green because the preserved mockup sandbox fails typecheck, and the complete API
test suite requires an approved disposable PostgreSQL test environment.
