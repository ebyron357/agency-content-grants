# Evidence: foundation matching, "accepts applications" flag, past federal awards (7 November 2026)

Branch `feat/foundation-matching-usaspending`, migration `0034_foundation_matching_past_awards` (journal `when` 1789555200000, 0033 + 1 day). Requested by the owner on 6 November 2026 in a Claude conversation (keep building the full plan toward the 4 December 2026 GrantCrest launch; plan: the Claude Doc "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan", build map week 2, on top of `docs/GRANT_PLATFORM_PLAN.md`). No written owner approval beyond that request is recorded. Feature documentation: `docs/GRANT_STUDIO.md` (Foundations: Accepts applications, Matched funders; Past federal awards), `docs/BACKGROUND_JOBS.md`, `docs/CLIENT_USER_MANUAL.md`.

All data in tests and screenshots is **synthetic**. Every funder, EIN, object id, recipient, award id and amount is invented. No real funder-graph, IRS or USAspending data was read.

## 1. Sources, licences and reachability

| Item | Finding | How checked |
|---|---|---|
| funder-graph rows | Do not carry Form 990-PF Part XIV line 2 (README "Published schema" columns, as recorded in `docs/evidence/foundations/2026-11-05`). The flag is therefore read from filing XML | Prior evidence; no new read |
| 990-PF element names | `OnlyContriToPreselectedInd` (variable `F9_15_PF_SIOCTPIND`, 2013 schemas on) and `OnlyContributesToPreselected` (`F9_15_PF_SUINONCOTOPR`, 2009–2012), plus line 2b–2d text elements, from the Nonprofit Open Data Collective IRS e-file master concordance (ISC), the field map IRSx (MIT) is built on. No code copied from either | Names written into `lib/foundations/applicationPolicy.ts` with their concordance variables; the live concordance file was **not re-read from this environment** |
| IRS e-file XML | Published only as zip batches on irs.gov. The importer reads `{objectId}_public.xml` from a directory or https location the operator sets (`FOUNDATIONS_XML_BASE_URL`); unset, the step is skipped and every funder stays **Unknown** | Unit and integration tests against two synthetic XML fixtures (`__fixtures__/irs-xml/`) |
| USAspending API | Public, no key. `api.usaspending.gov` **was blocked by this environment's egress proxy** (`curl: (56) CONNECT tunnel failed, response 403`, 7 Nov 2026), and a web fetch of the published API contract on raw.githubusercontent.com was not permitted. Request bodies and fixtures follow the `spending_by_award` and `spending_by_award_count` contracts as the previous build step recorded them; **no live response has been compared**. First production use should confirm one listing (owner or reviewer action) | Fixtures under `lib/grants/__fixtures__/usaspending/` are marked SYNTHETIC |

## 2. What is stored (256 MB database)

| Data | Bound | Measured / estimated |
|---|---|---|
| `foundation_funders` policy columns | 1 text flag, object id, tax year, period, checked-at; `application_info` at most 3 × 300 characters (lines 2b–2d, no contact names) | `pg_column_size` of a full 3 × 300-character object: 969 bytes. Lines 2b–2d are filed only when the box is not checked. Worst case at 50,000 funders all at the cap: about 48 MB; realistic (most 990-PF filers check the box; text usually shorter) a few MB. Owner should weigh this with the foundation import projection in the 5 November evidence |
| `usaspending_award_cache` | At most 100 awards per listing, at most `USASPENDING_MAX_LISTINGS` (default 500) listings; listings nobody asks for in 90 days are deleted | `pg_column_size` of 100 synthetic award objects: 25,605 bytes. 500 listings: about 12.8 MB before TOAST compression |

Nothing is called from a page view except the cache; USAspending is called at most once per listing per `USASPENDING_TTL_HOURS` (168).

## 3. Rules (each covered by a test)

- A suggestion is funding history and guidance, never an open call or eligibility decision; the label and note are on every response and screen.
- Score out of 100: state 30, cause (NTEE major groups) 30, grant size against request or budget 20, recency 10, consistency 10. Every component returns its points and the sentence behind it; each suggestion links its filings.
- The "accepts applications" flag never changes a score. **Invitation only** only when the box is checked; **Accepts applications** only when Part XIV is present and the box is not checked; otherwise **Unknown**. Always shown with the tax year of the filing it came from.
- Suggestions read only the caller's own organization (another workspace gets 404). Past awards use the caller's own organization for in-state awards only.
- Foundation import (and the XML step inside it) stays off until `FOUNDATIONS_IMPORT_ENABLED=true`.
- USAspending unreachable: last good copy with the date it was read, or a plain "unavailable" message; never an error page.

## 4. Validation run (7 November 2026, after rebase on `origin/main` 19aaf5e)

Linux, Node 22.23.4, pnpm 11.16.0, local PostgreSQL 16 (database `agent1_w2_test`), CI's environment variables (`docs/CI.md`). Not GitHub Actions and not Render.

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm run format:check` | pass |
| `pnpm run typecheck` | pass |
| API unit tests | 32 files, 353 tests passed |
| API database tests (`test:db:prepare`, then `test`) | 63 files, 617 tests passed (includes `foundations.integration.test.ts` 11, `past-awards.integration.test.ts` 7, permission coverage) |
| Content OS tests | 9 files, 39 tests passed |
| API and frontend builds | pass |
| `tests/integration-tests.sh` against the built server | 40 passed, 0 failed, 0 skipped |
| Playwright + axe gate (`test:a11y`) | 15 passed (1.9 min), including `foundations.spec.ts` and `past-awards.spec.ts` at 390 px and desktop width |
| `pnpm run build` (production) | pass |

Environment note: this worktree's path contains `.claude`, and Express `sendFile` refuses paths with a dot-directory, so the SPA fallback returned 404 when the server read the frontend from the worktree. For the browser gate the built frontend was copied to the session scratchpad and served with `FRONTEND_DIST_PATH`. CI paths have no dot-directory; no code was changed for this.
