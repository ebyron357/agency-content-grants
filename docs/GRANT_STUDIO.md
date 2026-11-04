# Grant Studio

Updated 4 November 2026. Current document for Grant Studio's scope, data sources, rules and operation. Status and evidence are in [`PROJECT_STATUS.md`](PROJECT_STATUS.md). The curated directory at **Grants** is a separate feature, documented in [`GRANT_RESOURCES.md`](GRANT_RESOURCES.md).

## What it does

Grant Studio helps nonprofits and businesses take a federal grant from discovery to a reviewed, approved application package:

1. **Organizations.** Profiles for 501(c)(3) nonprofits, other nonprofits, small businesses and other for-profits: mission, focus areas, state, annual budget and the most cost share the organization can commit.
2. **Readiness.** The registrations and documents funders require, each with a status, an expiry date and a note: SAM.gov registration and UEI, a Grants.gov Authorized Organization Representative, the IRS determination letter (501(c)(3)), financial statements, a board list (nonprofits), a capability statement (businesses) and an indirect cost rate agreement. Matches flag a registration that expires before the closing date.
3. **Matches.** Every open and forecast Grants.gov opportunity, refreshed daily, ranked against each organization. Hard exclusions come first, and each one gives its reason: status, a passed deadline, eligibility type, or cost sharing the organization cannot commit. Then a 0–100 fit score, where every point traces to a stated reason: eligibility, focus areas, distinctive mission words, award size against budget, time to the deadline, and readiness. **Only my topics** (on by default when the profile has focus areas or a mission) hides eligible but off-topic opportunities. Both counts stay visible. A focus area found in more than 40% of eligible opportunities (judged once there are at least 50) is named as too broad, with a prompt to add specific areas.
4. **Alerts.** An opportunity stored after the organization was added, or after its matches were last marked seen, is **New**. The Grant Studio page shows each organization's new on-topic matches, and those closing within 14 days. The Matches tab adds **Only new**, a closing-soon notice and **Mark all as seen**. After each daily refresh, every organization with new on-topic matches gets one `grant.new_matches` webhook event (see [`automation-api.md`](automation-api.md)). Subscribe in **Settings → Automation** and route it to email, Slack or a CRM with any webhook tool.
5. **Opportunity.** The official record (award range, cost sharing, who can apply, description, assistance listings), the organization's fit, and a link to the official listing.
6. **Application workspace.** Four steps:
   - **Requirements.** A compliance matrix seeded from a template (federal nonprofit, federal business, or SBIR/STTR, chosen automatically) and the common federal forms (SF-424, SF-424A, Project/Performance Site, SF-LLL). The user can paste the notice to extract further requirements with AI, then add, edit and confirm rows.
   - **Write.** Each section shows its guidance, word, character or page limit and mapped requirements. Users write in the rich editor, can **Draft with AI** (it uses only the organization's facts and marks anything missing as `[Add: …]`), **Review** (score and notes) and **Approve**. Editing an approved section reopens it.
   - **Budget.** Lines in SF-424A categories with quantity, unit cost, match percentage and justification; an indirect rate applied to requested direct costs; the award-ceiling check; and an AI-drafted budget justification.
   - **Review & package.** Ten compliance checks, each with a **Fix** link. The authorized representative approves the package, which unlocks the final DOCX. A labelled draft DOCX is available at any time.

## What it does not do

- **It does not submit.** The owner chose assisted submission: Grant Studio prepares and checks the package, and the authorized representative submits it through Grants.gov Workspace (or the funder's portal), confirming the forms listed in that package.
- **It does not decide eligibility.** A match is a guide. Starting an application requires the user to confirm, against the official notice, that the organization meets the eligibility section; the confirmation is stored with the application.
- **It does not invent facts.** Drafting prompts forbid unstated statistics, partners and outcomes. With no AI provider configured, drafting inserts a labelled scaffold, extraction is unavailable and review runs rule checks only. The package cannot be approved while scaffold text remains.

## Data sources

| Source | Use | Notes |
|---|---|---|
| Grants.gov public API (`https://api.grants.gov/v1/api`, keyless) | `search2` per eligibility code (12, 13, 22, 23, 25, 99) with paging; `fetchOpportunity` for details | Search results carry no eligibility codes, so codes are merged from the per-code searches and replaced by the detail record's. Details are fetched for every open opportunity without one, or older than 7 days, four at a time (`GRANTS_DETAIL_MAX_PER_RUN`, default 2,000), and again when someone opens an opportunity more than 24 hours after the last fetch. Opportunities that leave the open searches are marked closed |
| SBIR.gov, SAM.gov, state and local portals | Not connected | SBIR.gov returned 403 and the SAM.gov endpoint 404 from the build environment on 3 November; both are to be verified. State and local portals have no common API and remain a planned connector |

**Publication gate.** An opportunity is shown only with a title, an `https` official URL, a fetch time, posted or forecast status and, when posted, a closing date that has not passed. The gate is re-evaluated on every sync and detail refresh.

## Rules

- Every organization, application and child record is owned by the signed-in operator; another operator's IDs return 404.
- Section HTML is sanitized on the server. AI routes are limited to 40 requests per 10 minutes, and manual sync to 4 per hour.
- Approvals (eligibility, section, package) record who approved and when. Any change to sections, requirements or budget withdraws the package approval and returns the application to draft.
- The final package is produced only when every compliance check passes and the package is approved. It is generated in memory and streamed with `Cache-Control: no-store`.

## Operation

| Setting | Effect |
|---|---|
| `GRANTS_SYNC_DISABLED=true` | Turns off the daily sync (first run 60 seconds after start). The sync is also off under `NODE_ENV=test` unless `GRANTS_SYNC_ENABLED=true` |
| `GRANTS_GOV_API_BASE` | Overrides the Grants.gov API base URL (tests use a fake fetch) |
| `GRANTS_DETAIL_MAX_PER_RUN` | Upper bound on detail fetches per sync |
| AI provider keys (`.env.example`) | Enable extraction, drafting and scored review. Without them Grant Studio runs in labelled demo mode |

**Refresh now** on the Grant Studio page starts a sync. The page shows the last sync time and the number of open opportunities. Migration `0017_grant_match_alerts` adds `matches_seen_at` and `alerted_at` to `grant_applicants`. Migration `0016_add_grant_studio` adds the tables `grant_applicants`, `grant_readiness_items`, `grant_opportunities`, `grant_sync_runs`, `grant_applications`, `grant_requirements`, `grant_sections`, `grant_budget_lines` and `grant_approvals`. Deleting an organization deletes its readiness items and applications, with everything under them. **Delete** on an application removes it with its requirements, sections, budget lines and approvals.

## Tests

- `artifacts/api-server/src/lib/grants/grants.unit.test.ts`: 34 hermetic tests covering normalization of recorded Grants.gov shapes, the gate, matching and relevance, match ordering and alert rules, budget, limits, templates, compliance and DOCX export.
- `artifacts/api-server/src/routes/grants.integration.test.ts`: 5 tests against a real database. They cover authentication, the full nonprofit flow from organization to final DOCX, cross-operator isolation, business matching and template choice, new-match alerts (one webhook event, then none; mark as seen; isolation), and sync with a fake Grants.gov.
- `artifacts/content-os/e2e/grant-studio.spec.ts`, plus `/grant-studio` in the accessibility gate: the real-session journey with axe (WCAG 2.0/2.1 A/AA) at desktop and 390 px, and no horizontal scroll.

Evidence: [`evidence/grant-studio/2026-11-03/`](evidence/grant-studio/2026-11-03/README.md).
