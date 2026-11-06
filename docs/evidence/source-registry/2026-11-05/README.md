# Evidence: grant source registry, page watcher and review queue (5 November 2026)

Branch `feat/source-registry-page-watcher`, migration `0031_source_registry`. Design and operation: [`docs/SOURCE_REGISTRY.md`](../../../SOURCE_REGISTRY.md). Requested by the owner on 5 November 2026 in a Claude conversation (the full grant platform build; plan: Claude Doc "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan", building on `docs/GRANT_PLATFORM_PLAN.md`). No written owner approval of this PR exists yet.

## What was run, and the results

All runs were in the agent's worktree on Linux, Node 22.23.4, PostgreSQL 16 (a local disposable database whose name ends in `_test`), with the CI environment variables (`NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, `MIGRATIONS_DIR=lib/db/drizzle`, the test admin password).

| Step (as in `docs/CI.md`) | Command | Result |
|---|---|---|
| Frozen install | `pnpm install --frozen-lockfile` | Passed |
| Format check | `pnpm run format:check` | Passed |
| Typecheck | `pnpm run typecheck` | Passed (libs, api-server, content-os, mockup-sandbox, scripts) |
| Hermetic API unit tests | `pnpm --filter @workspace/api-server test:unit` | 27 files, 278 tests passed (node guard: 17 passed); includes the new `sources.unit.test.ts` (39 tests) |
| Test database | `pnpm --filter @workspace/api-server test:db:prepare` | Migrations through `0031` applied |
| Full API suite | `pnpm --filter @workspace/api-server test` | 54 files, 507 tests passed, none skipped; includes `grant-sources.integration.test.ts` (9 tests) and `permissions.coverage.test.ts` (5 tests, one new) |
| Content OS tests | `pnpm --filter @workspace/content-os test` | 7 files, 34 tests passed |
| Production build | `pnpm run build` | Passed |
| Integration script against the built API | `bash tests/integration-tests.sh` | 40 passed, 0 failed, 0 skipped |
| Accessibility gate (Playwright + axe) | `pnpm --filter @workspace/content-os test:a11y` | **Not run**: no Playwright browser is installed in this environment. CI runs it. The new Settings, Sources tab is not yet in the gate's screen list |
| Secret scan, audit, SBOM | CI job | **Not run here**; CI runs it. No secrets were added (env vars are documented, commented, in `.env.example`) |

A mutation check confirmed the extraction test catches a removed grounding rule: disabling the "deadline must appear on the page" check made `keeps what the page states and empties what it does not` fail; the file was restored.

Smoke test against the built server (`node dist/index.mjs`, test database): sign-in 200; `GET /api/grant-sources` without admin unlock 403; after unlock it lists the two feeds (`grants_gov`, `ca_grants_portal`, both active and running, freshness "never" because no sync has run on that database); `POST /api/watch-events/changedetection` with no secret configured 503; the jobs screen lists `source-sweep-hourly` (off under `NODE_ENV=test`, as designed).

## Acceptance checks

| Requirement | Result | Evidence |
|---|---|---|
| Registry table with name, jurisdiction, connector type, URLs, schedule, owner, status, terms note and "terms checked" | PASS | `lib/db/src/schema/grantSources.ts`, migration `0031` |
| Sources whose terms were not checked or forbid automated reading stay disabled | PASS | `validateSource` refuses to activate them; `mayRun` gates every check and the webhook; unit and integration tests |
| Admin screen, owner/admin only | PASS | Settings, Sources (`pages/SourcesTab.tsx`); `workspace.configure` for every method, admin unlock, agency workspace only; integration test covers writer, viewer, locked operator, client owner, unauthenticated |
| Existing Grants.gov and California registered without behaviour change | PASS | Seeded `feed` rows; their connectors and switches are untouched; the only change in `ingest.ts` records freshness after the sync, best-effort; all existing grant tests pass |
| changedetection.io REST integration, webhook with shared secret, or polling, by env vars | PASS (against a fake API) | `changedetection.ts`, `routes/watch-events.ts`; unit tests with a fake API; integration test of the webhook. **Not verified against a real instance** (none can run or be reached here) |
| changedetection.io not added to `render.yaml`; owner action documented; compose snippet | PASS | `render.yaml` unchanged; `docs/deploy/changedetection/docker-compose.yml`; `SOURCE_REGISTRY.md` §4 |
| Built-in fallback fetcher: HTTPS GET, content hash, rate limit, User-Agent with no personal email; selectable backend | PASS | `fetcher.ts`, `watcherSettings`; unit tests. Real fetches are blocked by this environment's network policy, so the integration test injects a fake fetch (and one real-fetcher check records the expected failure) |
| AI extraction job on the cheap tier, draft with source URL and checked-on time, never auto-published, review queue, publication gate | PASS | `source_extract` job, `extraction.ts`, `promote.ts`, `approveDraft`; tests show nothing reaches `grant_opportunities` before approval and approval re-runs the gate |
| Demo output without an AI key, clearly labelled | PASS | `demoDraft`; never approvable or editable |
| Never invent fields | PASS | Every field is checked against the page text and links; unsupported ones are emptied with a note (tested with invented funder, deadline, amount, URL and quote) |
| Freshness: last success, stale after configurable days, shown on the screen | PASS | `freshness()`, `SOURCE_STALE_DAYS`, per-row `stale_after_days`; tested |
| Tests: extraction parsing (mocked AI), registry CRUD, gate, webhook signature; route integration with tenant/role checks; permission coverage | PASS | As listed above |

## Not verified, and why

- **A real changedetection.io instance.** Docker and outbound access are not available; the client follows the project's API v1 documentation (read through Context7 from `docs/api_v1/index.html` in the project repository) and is tested against a fake. The GitHub page itself could not be fetched (its permission prompt timed out).
- **Real page fetches and real AI extraction.** No AI key is configured here, and the network policy blocks the hosts. Extraction is tested with recorded model answers; quality on real pages is unmeasured.
- **Accessibility gate and a browser pass of the new tab.** See above.
- **Source terms.** Grants.gov's API terms and the California dataset page were read through a web fetch tool on 5 November 2026; direct requests from this environment were refused by the proxy.

## Owner actions

1. Decide whether to run changedetection.io in production (a new service; on Render a private service with a disk is paid). Until then nothing is needed: the built-in fetcher is the default.
2. If it is run: set `SOURCE_WATCHER_BACKEND`, `CHANGEDETECTION_URL`, `CHANGEDETECTION_API_KEY` and, for webhooks, `CHANGEDETECTION_RECEIVER_URL` and `CHANGEDETECTION_WEBHOOK_SECRET` in Render's secret store (not `render.yaml`).
3. Grants.gov's terms require the notice "This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services" to be displayed prominently. It is not shown in the product yet (recorded in the Grants.gov registry row); add it, or approve adding it, in a follow-up.
4. Configure an AI provider key for real extraction (already an R0 owner action); without it extraction produces labelled demo drafts only.
