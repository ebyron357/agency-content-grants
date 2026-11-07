# Grant Source Registry and Page Watcher

Added 5 November 2026 (week 1 of the build the owner asked for on 5 November 2026). It implements `GRANT_PLATFORM_PLAN.md` §4 ("Opportunity sources ... a source registry table") and the "more states through the source registry" and "pages are monitored for change only where their terms allow" items of §8. Status and evidence: [`evidence/source-registry/2026-11-05/`](evidence/source-registry/2026-11-05/README.md).

## 1. What it does

Every place grant opportunities come from is a **row**, not a release:

| Connector type | What it is | How it is read |
|---|---|---|
| `feed` | An official structured feed with a connector in code: **Grants.gov** and the **California Grants Portal** | The existing daily `grant_sync` job, unchanged. The registry records each run's freshness |
| `portal_page` | A state grants portal page that lists many opportunities | Watched for change, then extracted into drafts |
| `watched_page` | One funder's open-call page: a foundation, a corporate program or a state agency | Watched for change, then extracted into drafts |

A watched page goes through four steps, and none of them publishes anything on its own:

1. **Check.** The page is fetched on its schedule (or when changedetection.io reports a change). Its text is hashed; an unchanged page only refreshes freshness.
2. **Extract.** When the text changed, a background job sends it to the AI provider layer on the cheap model tier and asks for the opportunities it announces: title, funder, deadline, amount range, eligibility summary and official URL.
3. **Validate.** Every field is checked against the page itself. A deadline, an amount, a funder, a quote or an official URL that the page does not contain is **left empty, with a note**: nothing is guessed. Without an AI key, extraction makes one clearly labelled **demo** draft with every field empty, which can never be approved.
4. **Review.** Drafts wait in the review queue (Settings, Sources). A person checks each one against its page, may correct it, and confirms before approving. An approved draft becomes a `grant_opportunities` row only if it passes the existing **publication gate** (`lib/grants/gate.ts`): a title, an https official URL, a fetch time, an open status and a closing date that has not passed, or a rolling deadline the page states.

Each draft keeps its **source URL** and the **checked-on time** of the page it came from; the approved opportunity's description says which page it was read from, when, and that a person reviewed it.

Foundation and corporate rows here are **open calls** a funder announces on its own page. Foundation **funding history** from tax filings is a different feature (§8 of the plan) and is never shown as an open call.

## 2. The registry row

| Field | Meaning |
|---|---|
| `name`, `key` | Display name and a stable key. For feeds the key equals `grant_opportunities.source`; approved page opportunities use `page:<key>` |
| `jurisdiction_kind`, `jurisdiction_code` | `federal`, `state` (with its two-letter code), `foundation` or `corporate`. Opportunities from a state row carry its code, so matching treats them as state programs, as California's are |
| `connector_type`, `connector` | `feed` (with its code connector), `portal_page` or `watched_page` |
| `urls` | The source's URLs; the first is the one read. https public host names only |
| `schedule_hours` | How often to check; at least 6 hours for pages |
| `owner` | Who keeps the row correct |
| `status` | `active`, `paused` or `disabled` (new rows default to disabled) |
| `terms_note`, `terms_checked`, `terms_permit_automation` | What the site's terms say and where; whether a person read them; whether they permit automated reading. **A source runs only when it is active, its terms were checked, and they permit automated reading.** The server refuses to activate any other source. Who checked them and when are recorded |
| `stale_after_days` | Days without a successful check before the source is stale; empty uses `SOURCE_STALE_DAYS` |
| `last_checked_at`, `last_success_at`, `last_changed_at`, `last_error` | Freshness, shown on the screen |

Migration `0031_source_registry` adds `grant_sources`, `grant_source_checks` (one row per check, with the page text kept only for changed pages) and `grant_source_drafts` (the review queue), and registers the two existing feeds as active rows with their terms recorded (§6). The feeds' connectors, schedule and switches (`GRANTS_SYNC_DISABLED`, `GRANTS_CA_DISABLED`) are unchanged; a feed row's connector, key, URLs and jurisdiction are locked on the screen, and a feed cannot be deleted.

**Week 2 (not in this change):** the state watch lists and the Illinois, North Carolina and Utah connectors. Each state page is one `portal_page` row with `jurisdiction_kind = state`; a new structured feed type needs its connector in code and a `feed` row.

## 3. Who can use it

The Settings, Sources screen and its API (`/api/grant-sources*`, `/api/grant-source-drafts*`) are for **owners and admins of the agency workspace with admin access unlocked**, reads included:
- `lib/permissions.ts` requires `workspace.configure` for every method, so writers, reviewers, representatives, finance and viewers get 403 before the handler runs;
- the routes require the admin unlock (as the jobs screen does);
- sources and drafts are shared reference data, like opportunities, so a **client** workspace's owner gets 403 too.

`POST /api/watch-events/changedetection` is called by changedetection.io, not by a person, so it has no session. It checks a shared secret in the `x-watcher-secret` header (`CHANGEDETECTION_WEBHOOK_SECRET`, at least 24 characters, compared in constant time), is rate limited (120 a minute per address) and answers 503 when no secret is configured. Its body only names a watch: the check job then reads the page from changedetection.io's API with its API key, so a forged notification cannot inject page content. The permission coverage test lists it with the other routes that check their own credentials.

## 4. Watcher backends

`SOURCE_WATCHER_BACKEND` chooses how pages are read.

**`builtin` (default).** A plain HTTPS GET in the API process, so the system works with no extra service. It is a respectful reader: the User-Agent names the product and links to this document, with no personal email (`SOURCE_FETCH_USER_AGENT` overrides it; a value containing `@` is ignored); one request per host every 10 seconds (`SOURCE_FETCH_MIN_INTERVAL_MS`); pages at most every 6 hours; a 20-second timeout and a 2 MB limit; https only, at most 3 redirects, and only public addresses (the same check as webhook delivery). It does not run JavaScript, so pages that render their content in the browser need changedetection.io's browser fetcher.

**`changedetection`.** A self-hosted [changedetection.io](https://github.com/dgtlmoon/changedetection.io) (Apache-2.0) through its REST API v1 (`x-api-key`). Each active page source gets a watch with its own schedule (`time_between_check`, not the instance default) and the same User-Agent header as the built-in fetcher (`POST`/`PUT /api/v1/watch`). Changes arrive one of two ways:
- **webhook** (when `CHANGEDETECTION_RECEIVER_URL` and `CHANGEDETECTION_WEBHOOK_SECRET` are set): each watch's notification is an Apprise `posts://` URL to `/api/watch-events/changedetection` carrying the secret as a header, and a JSON body naming the watch;
- **poll** (`CHANGEDETECTION_MODE=poll`, or no receiver): the hourly sweep reads each due watch's state.
Either way the page text comes from `GET /api/v1/watch/{uuid}/history/latest`. A changedetection backend that is not fully configured falls back to `builtin`, and the screen says why.

| Variable | Default | Effect |
|---|---|---|
| `SOURCE_WATCHER_BACKEND` | `builtin` | `builtin` or `changedetection` |
| `CHANGEDETECTION_URL`, `CHANGEDETECTION_API_KEY` | unset | The instance and its API key (a secret) |
| `CHANGEDETECTION_MODE` | `webhook` when a receiver and secret are set, else `poll` | `webhook` or `poll` |
| `CHANGEDETECTION_RECEIVER_URL` | unset | This API's `/api/watch-events/changedetection` as the instance reaches it |
| `CHANGEDETECTION_WEBHOOK_SECRET` | unset | Shared secret, 24+ characters (a secret) |
| `SOURCE_STALE_DAYS` | `3` | Days without a successful check before a source is stale (1–90) |
| `SOURCE_FETCH_USER_AGENT` | product name and this document's URL | Built-in fetcher User-Agent (no email addresses) |
| `SOURCE_FETCH_MIN_INTERVAL_MS` | `10000` | Built-in fetcher: least time between requests to one host |
| `SOURCE_EXTRACT_MODEL` | the provider's cheapest model | Overrides the extraction model |
| `SOURCE_WATCH_DISABLED` | unset | `true` stops the hourly sweep |
| `SOURCE_WATCH_ENABLED` | unset | Under `NODE_ENV=test` the sweep is off unless this is `true` |

**Running changedetection.io (owner decision).** It is a new service and is **not** in `render.yaml`. To try it locally, or as the reference for a later deployment, use [`deploy/changedetection/docker-compose.yml`](deploy/changedetection/docker-compose.yml) (the published image, port 5000 bound to localhost, a data volume and one fetch worker; pin the image to a reviewed release tag before any shared deployment). On Render it would be a private service with a persistent disk, which is a paid resource: the owner decides whether to add it, its plan, and where the API key and webhook secret are stored. Until then the built-in fetcher is the backend.

## 5. Jobs

| Kind | Label | Attempts | Timeout | Runs at once | When |
|---|---|---|---|---|---|
| `source_sweep` | Check watched pages that are due | 2 | 5 min | 1 | Hourly (first run 2 min after start); queues a check for each active page whose schedule has come round |
| `source_check` | Check a watched page | 2 | 2 min | 1 | From the sweep, a changedetection.io notification, or **Check now**; one per source at a time |
| `source_extract` | Extract opportunities from a changed page | 2 | 3 min | 1 | After a check finds a change |

A page problem (an HTTP error, a timeout, a page with no text) is recorded on the check and the source (`last_error`) and does not fail the job. Extraction prompts are on the `utility` stage: a model set for Utility in Settings, Model Configuration is used; otherwise the active provider's cheapest model (OpenAI `gpt-4o-mini`, Anthropic `claude-3-5-haiku-20241022`, Gemini `gemini-2.0-flash-lite`), or `SOURCE_EXTRACT_MODEL`. A page sends at most 40,000 characters and yields at most 25 drafts. A draft already in the queue (same title and official URL) is refreshed while pending; an approved or rejected one keeps the reviewer's decision.

## 6. Terms of the two existing feeds (read 5 November 2026)

- **Grants.gov API** ([terms](https://grants.gov/api/terms-conditions)): the API may be used to search, display, analyze and retrieve its data; content must not be modified or misrepresented; HHS may limit or end access. Services that use it must prominently display: "This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services." **That notice is not yet shown in the product**; adding it is an owner action recorded in the PR.
- **California Grants Portal** ([data.ca.gov dataset](https://data.ca.gov/dataset/california-grants-portal)): license "Other (Public Domain)", rights "No restrictions", updated daily.

Both pages were read through a web fetch tool; this build environment's network policy blocks direct requests to either host.

## 7. State sources (week 2, migration 0035)

Migration `0035_state_sources.sql` adds three state **feed** connectors and watch lists for the ten most populous states. Every new row is registered `disabled` with `terms_checked = false` and `terms_permit_automation = false`; nothing in it publishes an opportunity, and `ON CONFLICT ("key") DO NOTHING` keeps a row a person has already edited. Each row's `terms_note` records what its terms page said and where it is.

**Feed connectors** live in `artifacts/api-server/src/lib/grants/states/` (`illinois.ts`, `northCarolina.ts`, `utah.ts`, shared helpers in `common.ts`). They are adapted from [KurtLehnardt/granted](https://github.com/KurtLehnardt/granted) (`scaffold/scripts/1-fetch-il-grants.mjs`, `1-fetch-nc-grants.mjs`, `1-fetch-ut-grants.mjs` and `scaffold/scripts/lib/normalizeNewSources.mjs`, commit `d6e143a`), MIT License; the notice is kept in `states/LICENSE-granted.txt` and each file's header says what changed. The daily `grant_sync` job runs a state feed **only while its registry row may run** (active, terms checked and permitting automated reading, the same rule as pages); a feed whose row is missing or disabled is skipped. Records go through the same store and publication gate as California (`syncStateFeed` in `lib/grants/ingest.ts`): a record that leaves the listing is closed, and a page that parses fewer rows than the connector's floor (Illinois 20, North Carolina 20, Utah 100) fails the run and changes nothing.

- **Illinois** reads the CSFA opportunity list table. The application window sets the status (`forecasted` before it opens, `posted` while open, `closed` after it ends); "No end date" is a rolling deadline. Rows can pass the gate.
- **North Carolina** reads the NC.gov directory. It states no deadline, amount or eligibility, so rows are stored as `listed`, which the gate never publishes.
- **Utah** parses the Looker Studio report's rendered cards, but the report renders only in a browser two cross-origin iframes deep. The API server has no renderer, so the connector fails with a plain reason even if enabled. Rows would be `listed`.

**Watch lists** are `portal_page` (a page listing many opportunities) or `watched_page` (one agency's page) rows, checked by the page watcher (§4) and extracted into drafts for review once enabled. URLs are official `.gov` pages; aggregators were used only to find them, never as the source. States a feed covers (CA, IL, NC) get no watch-list row.

| State | Source | URL | Connector type | Terms status (read 7 Nov 2026) |
|---|---|---|---|---|
| CA | California Grants Portal (existing) | https://data.ca.gov/dataset/california-grants-portal | `feed` (`ca_grants_portal`), active | Public domain, no restrictions (§6) |
| IL | Illinois CSFA opportunity list | https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx | `feed` (`il_csfa`), disabled | Not confirmed. The State of Illinois legal notice (https://www.illinois.gov/about/privacy.html) says nothing about automated reading and does not name omb.illinois.gov; `omb.illinois.gov/robots.txt` redirects to a gateway reading "Unauthorized access is prohibited." Confirm with Illinois OMB (GATA). |
| NC | NC.gov grant opportunities directory | https://www.nc.gov/your-government/all-nc-state-services/grant-opportunities | `feed` (`nc_grant_directory`), disabled | Not permitted for this product as read. https://www.nc.gov/disclaimer-terms-use permits copying "for non-commercial use" only; GrantCrest is paid. Ask NC DIT for written permission. |
| UT | Utah Funding Opportunities Portal (Looker Studio) | https://lookerstudio.google.com/u/0/reporting/ef90555b-7a4d-4b8e-898e-c427c996bf65/page/WFAzC | `feed` (`ut_funding_portal`), disabled | Not confirmed. The linking page (https://gopb.utah.gov/funding-resources/) states no terms; Google's terms could not be opened. Also needs a browser renderer. |
| TX | Office of the Governor eGrants funding opportunities | https://egrants.gov.texas.gov/apps/egrants/fundopp.aspx | `portal_page`, disabled | Not checked; the page links no terms. |
| FL | Florida DEP grants (Protecting Florida Together) | https://protectingfloridatogether.gov/Grants | `watched_page`, disabled | Not checked; read https://floridadep.gov/disclaimer and https://floridadep.gov/privacy-statement. |
| NY | Statewide Financial System funding search | https://esupplier.sfs.ny.gov/psp/fscm/SUPPLIER/ERP/c/NY_SUPPUB_FL.AUC_RESP_INQ_AUC.GBL | `portal_page`, disabled | Not checked; read https://grantsmanagement.ny.gov/website-disclaimer. Needs JavaScript. |
| NY | Department of State funding opportunities | https://dos.ny.gov/funding-bid-opportunities | `watched_page`, disabled | Not checked; read https://dos.ny.gov/disclaimer. |
| NY | Agriculture and Markets funding opportunities | https://agriculture.ny.gov/funding-opportunities | `watched_page`, disabled | Not checked; read https://agriculture.ny.gov/disclaimer. |
| PA | Pennsylvania state grants | https://pa.gov/en/grants | `portal_page`, disabled | Not checked; read https://www.pa.gov/privacy-policy. |
| OH | Ohio Grants Partnership funding opportunities | https://www.grants.ohio.gov/fundingopportunities.aspx | `portal_page`, disabled | Not checked, and the page could not be opened. |
| GA | Governor's Office of Planning and Budget grant opportunities | https://opb.georgia.gov/node/13841 | `portal_page`, disabled | Not checked; read https://georgia.gov/privacysecurity. The page said "There are currently no active grant opportunities available." |
| MI | Michigan Department of Education grants | https://michigan.gov/mde/Services/financial-management/grants | `watched_page`, disabled | Not checked; read https://www.michigan.gov/policies. |

To turn a state on, a person reads its terms page, records the result in the registry (Sources screen: terms checked, permits automated reading) and sets the row active. Until then only California shows state listings.

## 8. Tests

- `artifacts/api-server/src/lib/grants/sources/sources.unit.test.ts` (hermetic): registry validation and the terms rule, URL rules, schedule and freshness, page text and links, date and amount grounding, extraction parsing and validation with a recorded (mocked) AI answer including invented fields, the cheap-model choice, demo output, approval through the publication gate, reviewer edits, the webhook secret and notification parsing, the changedetection.io client against a fake API, backend selection, and the fetcher's User-Agent and per-host rate limit.
- `artifacts/api-server/src/routes/grant-sources.integration.test.ts` (real database and router): the two feeds registered unchanged; role and tenant checks (writer, viewer, locked operator, client-workspace owner, unauthenticated); registry CRUD; a page checked, extracted, queued, approved through the gate and rejected, with nothing published before approval; demo output never approvable; failure and staleness; a check through the job queue; the webhook's secret, validation and dedupe.
- `routes/permissions.coverage.test.ts` classifies every new route.
- `artifacts/api-server/src/lib/grants/states/states.unit.test.ts` (hermetic): the Illinois and North Carolina parsers against pages recorded on 7 November 2026 (`states/__fixtures__/`, trimmed, markup unchanged, plus one synthetic row in granted's older markup each), Utah against a synthetic card page, dates, amounts and statuses, the row floors, and the gate never publishing a `listed` row.
- `artifacts/api-server/src/routes/grants.integration.test.ts` (real database): migration 0035's rows are disabled with terms not checked; a state feed becomes runnable only once its terms are recorded and it is active; the Illinois and North Carolina connectors sync through the gate with synthetic pages, close rows that leave the listing, and fail without changing anything on a broken page; Utah fails plainly without a renderer.
