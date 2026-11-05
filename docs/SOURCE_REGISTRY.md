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

## 7. Tests

- `artifacts/api-server/src/lib/grants/sources/sources.unit.test.ts` (hermetic): registry validation and the terms rule, URL rules, schedule and freshness, page text and links, date and amount grounding, extraction parsing and validation with a recorded (mocked) AI answer including invented fields, the cheap-model choice, demo output, approval through the publication gate, reviewer edits, the webhook secret and notification parsing, the changedetection.io client against a fake API, backend selection, and the fetcher's User-Agent and per-host rate limit.
- `artifacts/api-server/src/routes/grant-sources.integration.test.ts` (real database and router): the two feeds registered unchanged; role and tenant checks (writer, viewer, locked operator, client-workspace owner, unauthenticated); registry CRUD; a page checked, extracted, queued, approved through the gate and rejected, with nothing published before approval; demo output never approvable; failure and staleness; a check through the job queue; the webhook's secret, validation and dedupe.
- `routes/permissions.coverage.test.ts` classifies every new route.
