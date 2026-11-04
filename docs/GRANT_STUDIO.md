# Grant Studio

Updated 4 November 2026. Current document for Grant Studio's scope, data sources, rules and operation. Status and evidence are in [`PROJECT_STATUS.md`](PROJECT_STATUS.md). The curated directory at **Grants** is a separate feature, documented in [`GRANT_RESOURCES.md`](GRANT_RESOURCES.md).

## What it does

Grant Studio helps nonprofits and businesses take a federal grant from discovery to a reviewed, approved application package:

1. **Organizations.** Profiles for 501(c)(3) nonprofits, other nonprofits, small businesses and other for-profits: mission, focus areas, state, annual budget and the most cost share the organization can commit.
2. **Fact library.** Reusable, sourced facts in nine categories: community need, programs, outcomes, history, staff, partners, finances, evaluation and other. Each fact has a label, the statement, its source and an "as of" date. A person confirms each fact against its source, and editing it withdraws the confirmation. Only confirmed facts reach drafting: up to 25 per section (8,000 characters), the section's own categories first (for example, community need for the Statement of need). The Write step lists a section's confirmed facts with **Copy**. In demo mode, the draft outline lists them.
   **Saved writing.** An approved section (never demo text) can be saved to the organization's library with **Save to library**. In a later application, **Reuse approved writing** beside the editor lists the saved texts for the same section, with **Show all** for the others. **Replace** or **Append** inserts one into the section, which reopens it like any edit, so it must be reviewed and approved again. Drafting also receives up to two saved texts for the same section as approved material to adapt. Saved writing outlives the application it came from and is deleted with the organization.
3. **Readiness.** The registrations and documents funders require, each with a status, an expiry date and a note: SAM.gov registration and UEI, a Grants.gov Authorized Organization Representative, the IRS determination letter (501(c)(3)), financial statements, a board list (nonprofits), a capability statement (businesses) and an indirect cost rate agreement. Matches flag a registration that expires before the closing date.
4. **Matches.** Every open and forecast Grants.gov opportunity, refreshed daily, ranked against each organization. Hard exclusions come first, and each one gives its reason: status, a passed deadline, eligibility type, or cost sharing the organization cannot commit. Then a 0–100 fit score, where every point traces to a stated reason: eligibility, focus areas, distinctive mission words, award size against budget, time to the deadline, and readiness. **Only my topics** (on by default when the profile has focus areas or a mission) hides eligible but off-topic opportunities. Both counts stay visible. A focus area found in more than 40% of eligible opportunities (judged once there are at least 50) is named as too broad, with a prompt to add specific areas.
5. **Alerts.** An opportunity stored after the organization was added, or after its matches were last marked seen, is **New**. The Grant Studio page shows each organization's new on-topic matches, and those closing within 14 days. The Matches tab adds **Only new**, a closing-soon notice and **Mark all as seen**. After each daily refresh, every organization with new on-topic matches gets one `grant.new_matches` webhook event (see [`automation-api.md`](automation-api.md)). Subscribe in **Settings → Automation** and route it to email, Slack or a CRM with any webhook tool. **Deadlines:** an application, or an opportunity, can be added to a calendar (`.ics`, an all-day event with reminders 14, 7 and 2 days before, and a note to confirm the closing time in the notice). **Deadline calendar** on the Grant Studio page downloads every open application in one file. After each refresh, an application that is not yet exported gets one `grant.deadline_approaching` event as its closing date crosses 14, 7 and 2 days.
6. **Opportunity.** The official record (award range, cost sharing, who can apply, description, assistance listings), the organization's fit, and a link to the official listing.
7. **Application workspace.** Four steps:
   - **Requirements.** A compliance matrix seeded from a template (federal nonprofit, federal business, or SBIR/STTR, chosen automatically) and the common federal forms (SF-424, SF-424A, Project/Performance Site, SF-LLL). The user can paste the notice to extract further requirements with AI, then add, edit and confirm rows.
   - **Write.** Each section shows its guidance, word, character or page limit and mapped requirements. Users write in the rich editor, can **Draft with AI** (it uses only the organization's facts and marks anything missing as `[Add: …]`), **Review** (score and notes) and **Approve**. Editing an approved section reopens it.
   - **Budget.** Lines in SF-424A categories with quantity, unit cost, match percentage and justification; an indirect rate applied to requested direct costs; the award-ceiling check; and an AI-drafted budget justification.
   - **Review & package.** Ten compliance checks, each with a **Fix** link. The authorized representative approves the package, which unlocks the final DOCX. A labelled draft DOCX is available at any time.

**Outcomes and pipeline.** After the final package is downloaded, the Outcome panel on the package step records what happened. Grant Studio never submits, so these are a person's records:
- **Submitted**, with a date and the funder's tracking number. The requested amount is captured at that moment.
- **Awarded** with the awarded amount, **Declined**, or **Withdrawn**, each with a date and a note.

**Undo last step** walks back one step. A recorded submission stops deadline reminders and removes the application from the deadline calendar. Later edits no longer reset the application to draft. The Grant Studio page shows the pipeline: in progress (and due within 30 days), awaiting decision (and total requested), awarded dollars, and the win rate (awarded divided by awarded plus declined).

## What it does not do

- **It does not submit.** The owner chose assisted submission: Grant Studio prepares and checks the package, and the authorized representative submits it through Grants.gov Workspace (or the funder's portal), confirming the forms listed in that package.
- **It does not decide eligibility.** A match is a guide. Starting an application requires the user to confirm, against the official notice, that the organization meets the eligibility section; the confirmation is stored with the application.
- **It does not invent facts.** Drafting prompts forbid unstated statistics, partners and outcomes, and supply only the organization's profile and its confirmed library facts, each with its source. With no AI provider configured, drafting inserts a labelled scaffold, extraction is unavailable and review runs rule checks only. The package cannot be approved while scaffold text remains.

## Data sources

| Source | Use | Notes |
|---|---|---|
| Grants.gov public API (`https://api.grants.gov/v1/api`, keyless) | `search2` per eligibility code (12, 13, 22, 23, 25, 99) with paging; `fetchOpportunity` for details | Search results carry no eligibility codes, so codes are merged from the per-code searches and replaced by the detail record's. Details are fetched for every open opportunity without one, or older than 7 days, four at a time (`GRANTS_DETAIL_MAX_PER_RUN`, default 2,000), and again when someone opens an opportunity more than 24 hours after the last fetch. Opportunities that leave the open searches are marked closed |
| California Grants Portal (`data.ca.gov` dataset `california-grants-portal`, "Grants Offered", keyless CKAN datastore, updated daily by the State) | Every active and forecast California state grant, in one daily read (157 open of 2,027 records on 4 November) | Each record is complete, so there is no detail fetch. Mapping: active → posted; "Ongoing" deadlines → a rolling deadline (no closing date); "Between $A and $B" → award floor and ceiling; "25%" matching → required match of 25%; Nonprofit → codes 12 and 13 (the portal does not distinguish 501(c)(3)), Business → 22 and 23, Other Legal Entity → 25. Public agencies, tribal governments and individuals are not Grant Studio applicant types; they stay in the eligibility text. Records are marked `jurisdiction = CA`. The program page is the official link (the agency page when the program link is not https). Records that leave the open set are closed |
| SBIR.gov, SAM.gov, other states and local portals | Not connected | SBIR.gov's API answered 403 "Forbidden" from its own gateway on 3 and 4 November (not the network proxy). SAM.gov assistance listings need an API key, which is an owner action. Other states have no common API; each needs its own connector |

**Publication gate.** An opportunity is shown only with a title, an `https` official URL, a fetch time, posted or forecast status and, when posted, a closing date that has not passed or a rolling deadline the source states explicitly. The gate is re-evaluated on every sync and detail refresh.

**State programs.** A California record is a state program. Matching excludes an organization recorded in another state, and asks an organization with no state recorded to add one and confirm the program's geography. A stated match percentage is compared with what the organization can commit. A rolling deadline earns time credit and is labelled "Rolling: open until funds run out". Federal registrations (SAM.gov, the Grants.gov representative) are not required for state programs, either in matching or in the readiness compliance check. Applications use the state templates (`state_nonprofit`, `state_business`): the same sections, with state portal and form rows instead of SF-424 and SAM.gov. The package says to confirm forms on the state program's portal.

## Rules

- Every organization, application and child record is owned by the signed-in operator; another operator's IDs return 404.
- Section HTML is sanitized on the server. AI routes are limited to 40 requests per 10 minutes, and manual sync to 4 per hour.
- Approvals (eligibility, section, package) record who approved and when. Any change to sections, requirements or budget withdraws the package approval and returns the application to draft.
- The final package is produced only when every compliance check passes and the package is approved. It is generated in memory and streamed with `Cache-Control: no-store`.

## Operation

| Setting | Effect |
|---|---|
| `GRANTS_SYNC_DISABLED=true` | Turns off the daily sync, which runs as the `grant_sync` background job (`BACKGROUND_JOBS.md`): once a day, the first run 60 seconds after start if the day has none, retried with backoff. The schedule is also off under `NODE_ENV=test` unless `GRANTS_SYNC_ENABLED=true` |
| `GRANTS_GOV_API_BASE` | Overrides the Grants.gov API base URL (tests use a fake fetch) |
| `GRANTS_DETAIL_MAX_PER_RUN` | Upper bound on detail fetches per sync |
| `GRANTS_CA_DISABLED=true` | Skips the California Grants Portal in the daily sync. `CA_GRANTS_API_BASE` and `CA_GRANTS_RESOURCE_ID` override the endpoint and resource |
| AI provider keys (`.env.example`) | Enable extraction, drafting and scored review. Without them Grant Studio runs in labelled demo mode |

**Refresh now** on the Grant Studio page starts a sync. The page shows the last sync time and the number of open opportunities. Migration `0022_grant_outcomes` adds the outcome columns to `grant_applications`. Migration `0021_grant_saved_writing` adds the `grant_snippets` table (at most 200 per organization). Migration `0020_grant_state_sources` adds `cost_share_percent`, `rolling_deadline` and `jurisdiction` to `grant_opportunities`. Migration `0019_grant_deadline_reminders` adds `deadline_alert_days` to `grant_applications`. Migration `0018_grant_fact_library` adds the `grant_facts` table (at most 300 facts per organization). Migration `0017_grant_match_alerts` adds `matches_seen_at` and `alerted_at` to `grant_applicants`. Migration `0016_add_grant_studio` adds the tables `grant_applicants`, `grant_readiness_items`, `grant_opportunities`, `grant_sync_runs`, `grant_applications`, `grant_requirements`, `grant_sections`, `grant_budget_lines` and `grant_approvals`. Deleting an organization deletes its readiness items, fact library, saved writing and applications, with everything under them. **Delete** on an application removes it with its requirements, sections, budget lines and approvals.

## Capacity (measured 4 November 2026)

Production runs on Render's `0.5c-512mb` web instance and `0.1c-256mb` database (`render.yaml`). These figures come from the production build (`node ./dist/index.mjs`) on Linux with Node 22 (Render runs Node 24.15), against PostgreSQL 16 and live Grants.gov and California data. That is not Render itself, so treat them as estimates and re-measure after the first deploy.

| Measure | Result |
|---|---|
| Web process at idle (whole app) | 233 MB resident |
| First sync into an empty database (1,387 Grants.gov records with 1,342 details, then 156 California records) | 89 s; peak 248 MB resident (about 15 MB above idle) |
| Grant tables after that sync (1,543 opportunities) | 4.0 MB; the whole test database was 13 MB. Later syncs update rows in place |
| Matches page for one organization (100 results) | 0.23–0.32 s, 393 KB |
| Grant Studio page with 20 organizations | 2.5 s per load before the summary cache; 2.6 s on the first load and about 15 ms after, with the cache |
| Highest resident memory seen during the matching runs | 294 MB (before the cache); 261 MB with it |

The web instance has about 220 MB of headroom over the observed peak, and grant data adds about 4 MB to the database. The plans fit at this scale. Re-measure if the opportunity count or the number of organizations grows by an order of magnitude. Changing plans is an owner cost decision.

The Grant Studio page's alert summaries are cached in process. The deployment is a single instance, which the runbooks require. An entry is reused until the organization, its readiness, the opportunity store or the date changes.

## Tests

- `artifacts/api-server/src/lib/grants/grants.unit.test.ts`: 49 hermetic tests covering normalization of recorded Grants.gov shapes, the gate, matching and relevance, match ordering and alert rules, fact selection and the demo outline, calendar files and reminder thresholds, California normalization from a recorded record, the rolling-deadline gate, state matching and state templates, plain-text extraction and the saved-writing note in the demo outline, outcome transitions and the pipeline summary, budget, limits, templates, compliance and DOCX export.
- `artifacts/api-server/src/routes/grants.integration.test.ts`: 11 tests against a real database. They cover authentication, the full nonprofit flow from organization to final DOCX, cross-operator isolation, business matching and template choice, new-match alerts (one webhook event, then none; mark as seen; isolation), the fact library (validation, isolation, confirmed-only drafting, re-confirmation after edits), deadline calendars and once-per-threshold reminders, a California sync with a fake portal through to a state application (residency, match percentage, no federal registrations, closing records that leave the open set, failure recording), the summary cache (reuse, invalidation by readiness and by a new opportunity), saved writing (approved-only and non-demo saving, isolation, replace and append, no insertion into an approved section, survival after the source application is deleted), outcomes (export required, decisions after submission, isolation, reminders and calendar stop, edits keep the record, undo, pipeline totals), and sync with a fake Grants.gov.
- `artifacts/content-os/e2e/grant-studio.spec.ts`, plus `/grant-studio` in the accessibility gate: the real-session journey with axe (WCAG 2.0/2.1 A/AA) at desktop and 390 px, and no horizontal scroll.

Evidence: [`evidence/grant-studio/2026-11-03/`](evidence/grant-studio/2026-11-03/README.md).
