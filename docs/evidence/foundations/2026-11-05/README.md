# Evidence: foundation giving history (5 November 2026)

Branch `feat/foundation-giving-data`, migration `0030_foundation_giving`. Requested by the owner on 5 November 2026 in a Claude conversation, as part of the full grant platform build (plan: the Claude Doc "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan", building on `docs/GRANT_PLATFORM_PLAN.md` §8). No written owner approval beyond that request is recorded. Feature documentation: `docs/GRANT_STUDIO.md`, Foundations.

All figures below come from **synthetic data** made by `artifacts/api-server/scripts/make-foundation-fixture.mjs`. No real funder-graph data was read. Every name, EIN, object id and amount is invented.

## 1. Source, licence and data terms

| Item | Finding | How checked |
|---|---|---|
| funder-graph code | Apache-2.0 (`LICENSE` "Apache License Version 2.0"; `pyproject.toml` `license = "Apache-2.0"`; `NOTICE` "Copyright 2026 Egeria Corporation") | Read from `raw.githubusercontent.com/egeria-corporation/funder-graph/main` on 5 Nov 2026 |
| funder-graph schema | Column names and meanings used here are from the README "Published schema" table, including `object_id` (IRS OBJECT_ID), `amount_type` (`paid` / `approved_future`), `match_confidence` and tiers, `recipient_type` (`individual` excluded from the default view), and partitions `grants/filing_year=YYYY/part-0000.parquet` sorted by `funder_ein` | Same |
| Per-filing IRS link | funder-graph's `docs/research/data-sources.md` states "There is no per-filing URL anywhere" (verified there 2026-09-01). Profiles therefore show the object id, the IRS Form 990 downloads page, and ProPublica's page for the EIN | Same |
| **Hosted data terms** | **Not verified.** The README says the dataset is derived from US government works and the derived structure is Apache-2.0, but the terms of the hosted copy at `data.opengrants.io` were not reviewed | — |
| Hosted data reachability | `https://data.opengrants.io/funder-graph/latest/manifest.json` and the 2023 partition: **blocked from this build environment** (the egress proxy answered 403 to CONNECT; `curl: (56) CONNECT tunnel failed, response 403`). A fetch through the web tool also failed (permission not granted) | 5 Nov 2026 |
| Self-run option | The location is a setting, `FOUNDATIONS_DATA_BASE_URL` (default `https://data.opengrants.io/funder-graph/latest`), accepting an https URL or a local directory. The funder-graph pipeline (Apache-2.0) can be run independently and the importer pointed at its output | Covered by tests that read a local directory and a fake remote host |
| ProPublica organization link format | `https://projects.propublica.org/nonprofits/organizations/{ein}` — **not verified from here** (host blocked by the same proxy) | — |
| Parquet reader | `hyparquet` 1.31.4 (MIT, no dependencies) and `hyparquet-compressors` 1.1.2 (MIT; depends on `fzstd` MIT and `hysnappy` MIT). Test-only: `hyparquet-writer` 0.16.12 (MIT) writes the synthetic fixture. All published more than 24 hours earlier (the repo's `minimumReleaseAge`). No code was copied | `npm view … license`, `node_modules/*/LICENSE` |

## 2. What is stored, and why not the 15.3M rows

Production is a 256 MB PostgreSQL and a 512 MB web instance (`docs/GRANT_STUDIO.md`, Capacity). The import stores per funder: totals, giving by tax year, by recipient state (top 25 + "other"), by NTEE major group, how each cause was found, a log-scale size histogram (count, p25, median, p75, min, max estimated from it), the filing counted for each tax period, and its 5 largest grants to organizations in its latest three tax years. Rows are streamed 10,000 at a time, newest filing year first; funders are written 500 per transaction.

Rules applied (each tested): `amount_type = paid` only; individuals excluded and never stored; unknown-type recipients counted but never listed by name; recipient EIN and NTEE used only at `match_confidence >= 0.90`; one filing per tax period (the latest submitted, so amendments replace originals); a filing already counted is never counted again; Form 990-PF only by default.

## 3. Measurement (synthetic sample)

Sample: 2 filing years × 1,000,000 rows, 40,000 funders, one 1,000,000-row row group per file (as written by `make-foundation-fixture.mjs --sample 1000000 --funders 40000 --years 2024,2025 --row-group 1000000`), Snappy. Each funder's grants are spread over the 25 most populous states (average 15 states per funder stored), which is more spread than a typical foundation, so the per-funder size is a deliberately high estimate. The synthetic files are about 9 MB per million rows; funder-graph's published files are about 72 MB per million rows (1.1 GB / 15.3M, README), so real rows carry much more text.

Run: `scripts/measure-foundation-import.ts` (refuses anything but a `_test` database), PostgreSQL 16, Node 22.23.4, Linux. Not Render.

| Measure | Result |
|---|---|
| Rows read / kept | 2,000,000 / 1,779,923 (102,109 individuals, 117,968 approved-for-future excluded) |
| Filings counted / superseded | 103,245 / 23,251 |
| Funders / recent grants stored | 40,000 / 195,557 |
| Tables right after import (with VACUUM between years) | `foundation_funders` 96.2 MB, `foundation_grants` 71.5 MB: **167.7 MB** (4.4 KB per funder) |
| Same rows compacted (`VACUUM FULL`) | 61.8 MB + 44.9 MB: **106.7 MB** (2.8 KB per funder) |
| Time | 129 s with a 160 MB heap cap; 65 s uncapped |
| Peak memory, heap capped (`--max-old-space-size=160`, V8 limit 208 MB) | **329 MB RSS** for the whole process; the same process with the modules loaded and nothing run is 150 MB, so the import adds about 180 MB |
| Peak memory, uncapped (V8 limit 2,096 MB on this machine) | 968 MB RSS: V8 grows the heap when it is allowed to; the live set is far smaller |
| Reader only, 1M-row row group | 50,000-row windows: 232 MB heap with a 256 MB cap; failed with a 160 MB cap. 10,000-row windows: 172 MB heap with a 256 MB cap (hence the default of 10,000) |

## 4. Projection for the full import (owner decision)

The number of distinct funders in the full dataset is the main unknown: funder-graph's `funders` table and `manifest.json` could not be read from here. funder-graph's README reports 124,666 Form 990-PF filings in the 2023 posting alone, not all of which list grants. At the measured 2.8 KB (compacted) to 4.4 KB (right after an import) per funder:

| Distinct funders imported | Compacted | Right after import |
|---|---|---|
| 50,000 | 140 MB | 220 MB |
| 100,000 | 280 MB | 440 MB |
| 150,000 | 420 MB | 660 MB |
| 250,000 (with Form 990 Schedule I filers) | 700 MB | 1.1 GB |

Plus the rest of the application (13 MB measured on 4 November) and growth.

**Conclusion: the full Form 990-PF import does not fit the current 256 MB database.** It needs a database of **about 1 GB** (owner decision, cost not assessed here), or a subset: with the default budget `FOUNDATIONS_MAX_DB_MB=64` the tables hold roughly 15,000–24,000 funders, and `FOUNDATIONS_MIN_GIVING_USD` keeps larger funders first. These sizes must be re-measured on real data before relying on them.

**Memory: do not run the import inside the 512 MB web instance.** The web process idles at 233 MB (4 November), and the import adds about 180 MB on synthetic rows that are lighter than real ones. Run it on a separate worker instance (plan decision D9) with a heap cap, for example `NODE_OPTIONS=--max-old-space-size=256`. For this reason the import is **off on every server** until the owner sets `FOUNDATIONS_IMPORT_ENABLED=true`: the route answers 409, the job refuses to run, and its schedule is off.

## 5. Tests run (5 November 2026, this environment)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm run format:check` | Pass |
| `pnpm run typecheck` | Pass |
| `pnpm --filter @workspace/api-server test:unit` | Pass: 27 files, 259 tests (20 new in `lib/foundations/foundations.unit.test.ts`), plus 17 node tests |
| `pnpm --filter @workspace/api-server test` (PostgreSQL 16, disposable `_test` database) | Pass: 54 files, 488 tests (10 new in `routes/foundations.integration.test.ts`) |
| `pnpm --filter @workspace/content-os test` | Pass: 7 files, 34 tests |
| `bash tests/integration-tests.sh` against the built API | Pass: 40 passed, 0 failed, 0 skipped |
| `pnpm --filter @workspace/content-os test:a11y` (Playwright + axe, real server) | Pass: 12 of 12, including the new `foundations.spec.ts` and `/grant-studio/foundations` in the gate; `jobs.spec.ts` updated to tell the two schedules apart |
| `pnpm run build` | Pass |
| `pnpm audit --audit-level=high` | Pass (one moderate advisory, `minimatch` under `orval`, existed before this change) |

The browser test checks the Foundations page against the real server in its empty state; the populated search, suggestions and profile use synthetic API responses, because the CI server imports no data. The routes with real data are covered by the integration tests. To serve the frontend locally the build was copied outside the `.claude` worktree path (Express `sendFile` refuses dot-directories); CI is not affected.

## 6. Not verified

- Any real funder-graph data: the hosted files were unreachable, so the importer has never read a real partition. The column names come from the README; real types (for example `DATE` columns, `BIGINT` amounts) are handled in code and covered with synthetic values only.
- The layout of `manifest.json` (only "dataset version, build timestamp, row counts per partition" is documented); the reader looks for a version and `filing_year=` paths and otherwise falls back to 2019 through this year.
- The hosted data's terms, the ProPublica link format, and the real number of funders.
- Memory and timing on Render.
