# Release-candidate validation of `main` `997b735`, 4 November 2026

Candidate: `main` `997b7356b29f9d0a47028d82569c62d8d854c5ef` (merge of PR #45). Production at the time: `6d9f4887a28d8caec52e2e32c11e61d4a74059f4` (last observed 26 October). This is local and rehearsal evidence. It is **not** production evidence and does not change the production decision.

Environment: Linux container, Node 22.23.4 (CI and Render use Node 24.15), pnpm 11.16.0, PostgreSQL 16 local cluster. All data is synthetic and every record is prefixed `[SMOKE]` or `[REHEARSAL]`.

## 1. CI-equivalent gates on `997b735`

The same steps as `.github/workflows/ci.yml`, with the CI test environment variables:

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm run format:check` | Pass |
| `pnpm run typecheck` | Pass |
| API hermetic unit tests (`test:unit`) | 25 files, 209 passed, 0 skipped |
| `test:db:prepare` (migrations 0000–0026 on an empty database) | Pass |
| API database-backed tests (`test`) | 50 files, 426 passed |
| Content OS tests | 6 files, 31 passed |
| `pnpm run build` (production build) | Pass. Known warning: one chunk over 500 kB |
| `tests/integration-tests.sh` against the built API | 40 passed, 0 failed, 0 skipped |
| Playwright accessibility and end-to-end gate (`test:a11y`, Chromium 1243) | 10 passed: accessibility of the login and every primary route, accounts and invitations, Grant Studio, grant directory at 1440 and 390 px, background jobs, two-factor and audit log, templates |
| `pnpm audit --audit-level=high` | Pass. 0 critical, 0 high, **1 moderate**: `minimatch` 10.2.5 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)), reached only through `orval` → `typedoc` codegen (dev only). The `qs` advisory recorded on 4 November is gone (PR #35). Raw output: `audit.json` |

The secret scan and SBOM steps were not repeated locally. They ran green in CI on the head of every merged PR except #31 and #33 (see `docs/PROJECT_STATUS.md`).

## 2. Upgrade rehearsal: production version → candidate on the same database

Purpose: prove that the 11 new forward-only migrations (`0016`–`0026`) apply over data written by the version now in production, and that existing records stay reachable afterwards.

Setup: `NODE_ENV=production`, a dedicated empty database, a scratch disk for uploads, sources and exports, `SESSION_SECRET`, `ADMIN_PASSWORD` and `MFA_ENCRYPTION_KEY` set, and no AI provider key. A local TLS proxy sets `X-Forwarded-Proto: https` so the `Secure` session cookie works, as on Render.

1. **`6d9f488` started** (migrations up to `0015`) and reported `commit 6d9f488…`. Signed in with the team password and created one brand and one guide project.
2. **Stopped it and started `997b735`** on the same database and disk. The log shows `[migrate] Migrations complete` and `Server listening` with no error entries. The background job worker started.
3. **The records from step 1 survived.** After signing in with the team password, both records were readable by id. `/api/auth/me` reports role `owner` in the `Agency workspace` (the `agency` workspace created at first sign-in).
4. **`tests/production-smoke.sh` with `EXPECTED_SHA=997b735…`: 75 passed, 0 failed.** It covers SHA parity, security headers, anonymous rejection, sign-in, persistence, media, video validation, export, ownership probes, logout and cleanup. Log: `smoke-upgrade-997b735.txt`.

## 3. Rollback rehearsal: candidate → production version on the migrated database

5. **Stopped `997b735` and restarted `6d9f488`** on the migrated database. The older code started cleanly (`Migrations complete`, `Server listening`, no error entries), signed in, and read the step 1 records.
6. **The `6d9f488` smoke test passed 75/75** on the migrated schema. Log: `smoke-rollback-6d9f488.txt`.

A code rollback from `997b735` to `6d9f488` therefore works on the newer schema, at this data volume. Data written in the new tables (workspaces, members, Grant Studio, jobs, templates) is ignored by the older code. Members cannot sign in on `6d9f488`, only the team password works there.

## Limits of this evidence

- `/api/readyz` returned 503 throughout, solely because no AI provider key was set (`configuration` check). Database and storage were `ok`. Production has a provider key configured (readyz 200 on 26 October).
- No Grants.gov or California Grants Portal sync ran: the container has no route to those hosts. The first live sync in production is unverified.
- Node 22 was used locally, while Render runs Node 24.15. CI on each PR head ran Node 24.15.
- The smoke script covers the Content Machine flows only. Grant Studio, member sign-in, two-factor and jobs are covered by the CI suites above, not by a production probe.
