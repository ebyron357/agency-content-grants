# Upgrade rehearsal: production `d2250c3` to `main` `3635a0a` (6 November 2026)

Run by the coordinating Claude session at 18:10–18:17 UTC on 6 November, after PRs #58, #56, #57 and #55 merged. Local only: no production system was touched.

## What was run

| Step | Build | Result |
|---|---|---|
| 1. Baseline | `d2250c3bf2c3d76492d3078b9d8deec79c83e131` (the commit live on Render, confirmed through the Render API on 6 November) on an empty PostgreSQL 16 database | Migrations `0000`–`0024` applied. Seeded a `[REHEARSAL]` Grant Studio organization and a confirmed fact through the API |
| 2. Upgrade | `3635a0ac6eaaf7125e4e30ef86543bf53550f55b` (`main` after PR #55) on the same database | Migrations `0025`–`0033` applied (`[migrate] Migrations complete`, `Server listening`), 35 rows in `drizzle.__drizzle_migrations`. The organization and its fact read back unchanged. `grant_sources` holds Grants.gov and California as `active` feed rows; `billing_plans` holds the seeded plans; `/api/billing` and `/api/grants/foundations` answer 200 |
| 3. Smoke on the upgrade | `tests/production-smoke.sh` from `3635a0a` | **97 passed, 0 failed** ([log](smoke-upgrade-3635a0a.txt)); no `"level":50` log entries |
| 4. Rollback | `d2250c3` restarted on the `0033` schema | The organization still reads; its own smoke test **71 passed, 0 failed** ([log](smoke-rollback-d2250c3.txt)); no `"level":50` entries |

## Settings

`NODE_ENV=test` with `JOBS_WORKER_ENABLED=true` (so the worker runs as it does in production), `SMOKE_REQUIRE_READY=0`, `SMOKE_REQUIRE_GRANTS=0`, synthetic secrets, no AI key, billing off (no Stripe settings), foundation import off.

A first smoke run on the upgrade without `JOBS_WORKER_ENABLED=true` failed one check, "Background job worker is enabled", because test mode turns the worker off (`lib/jobs/worker.ts`). That is the rehearsal's setting, not a defect; the re-run with the worker on passed every check.

## Limits

- Node 22.23 locally; CI and Render use 24.15.
- Plain HTTP, not production mode behind TLS; the 4 November rehearsal covered production mode ([evidence](../2026-11-04/README.md)).
- Small data: one workspace, one organization, one fact. No members with two-factor were seeded this time; that path was rehearsed on 4 November and migrations `0030`–`0033` do not touch member or two-factor tables.
- Not exercised: real Stripe, real changedetection.io or Docling, real funder-graph data, a real AI provider.
