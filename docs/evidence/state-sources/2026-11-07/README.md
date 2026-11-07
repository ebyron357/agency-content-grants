# Evidence: state feed connectors (IL, NC, UT) and state watch lists (7 November 2026)

Branch `feat/state-connectors-week2`, migration `0035_state_sources`. Design and the per-state table: [`docs/SOURCE_REGISTRY.md` §7](../../../SOURCE_REGISTRY.md). Requested by the owner on 6 November 2026 in a Claude conversation (keep building the full plan toward the 4 December 2026 launch; plan: Claude Doc "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan", build map week 2, on top of `docs/GRANT_PLATFORM_PLAN.md`). No written owner approval of this PR exists.

## Outcome against the build map

Build map item: "Copy the Illinois, North Carolina and Utah connectors; watch lists for the 10 largest states." Done when: 13 states show listings.

**That "done when" is not met, and cannot be met by code alone.** After this PR, 11 states have a registry row (CA live; IL, NC, UT feeds; TX, FL, NY, PA, OH, GA, MI watch lists), but only **California shows listings**. Every new row is registered disabled because no state's terms were confirmed as permitting automated reading by a paid product:

| State | Blocked on |
|---|---|
| IL | Terms not confirmed: the State legal notice is silent on automated reading; `omb.illinois.gov/robots.txt` leads to an "Unauthorized access is prohibited" gateway. Needs Illinois OMB (GATA) confirmation. |
| NC | Terms read and **do not cover this product**: copying is permitted "for non-commercial use". Needs written permission from NC DIT. |
| UT | Terms not confirmed (GOPB page states none; Google's terms not opened) **and** a browser renderer is needed; the API server has none. |
| TX, FL, NY (3 pages), PA, OH, GA, MI | Terms pages named in each row's note, not yet read and recorded. OH's page could not be opened. GA's page listed no active opportunities. |

The 10 largest states by population are CA, TX, FL, NY, PA, IL, OH, GA, NC, MI; with UT that is 11 states, so "13" would also need two more states beyond this item's scope.

## What was run, and the results

Linux, Node 22.23.4, PostgreSQL 16 (disposable database `agent2_states_test`), CI environment variables (`NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, `MIGRATIONS_DIR=lib/db/drizzle`, test session secret and admin password). Rebased on `origin/main` `19aaf5e`.

| Step | Command | Result |
|---|---|---|
| Frozen install | `pnpm install --frozen-lockfile` | Passed |
| Format check | `pnpm run format:check` | Passed |
| Typecheck | `pnpm run typecheck` | Passed |
| Hermetic API unit tests | `pnpm --filter @workspace/api-server test:unit` | 31 files, 350 tests passed (node guard 17 passed); includes the new `states.unit.test.ts` (15 tests) |
| Test database | `test:db:prepare` | Migrations through `0035` applied; 13 state rows present, 12 new ones `disabled` with terms not checked |
| Full API suite | `pnpm --filter @workspace/api-server test` | 61 files, 607 tests passed; includes the new state-feed test in `grants.integration.test.ts` |
| Content OS tests | `pnpm --filter @workspace/content-os test` | 9 files, 39 tests passed |
| Production build | `pnpm -r --if-present run build` | Passed |
| Integration script against the built API | `tests/integration-tests.sh` (port changed to 8095 in a scratch copy, since another agent's server held 8080) | 40 passed, 0 failed, 0 skipped |
| Accessibility gate (Playwright + axe) | `pnpm --filter @workspace/content-os test:a11y` with `E2E_BASE_URL=http://127.0.0.1:8095` | 13 passed, 1 skipped (`notice.spec.ts`, which skips itself in this environment). The frontend was served from a copy outside the `.claude/` worktree path via `FRONTEND_DIST_PATH`, because Express `sendFile` refuses paths with a dot-directory; a first run without that failed 13 tests on a 404 sign-in page, which is this environment, not the code. No new screen was added. |

## Sources read (7 November 2026)

Pages were read through the Firecrawl and web fetch tools; this sandbox blocks direct requests to the state hosts. Illinois and North Carolina fixtures are recorded pages, trimmed, markup unchanged, each with one row marked synthetic in the older markup granted matched. The Utah fixture is entirely synthetic (the report renders only in a browser). All database test data is synthetic.

## Third-party code

KurtLehnardt/granted, MIT License, commit `d6e143a`: `scaffold/scripts/1-fetch-il-grants.mjs`, `1-fetch-nc-grants.mjs`, `1-fetch-ut-grants.mjs`, `scaffold/scripts/lib/normalizeNewSources.mjs`. Notice kept at `artifacts/api-server/src/lib/grants/states/LICENSE-granted.txt`. granted's hand-entered Utah additions were not copied.
