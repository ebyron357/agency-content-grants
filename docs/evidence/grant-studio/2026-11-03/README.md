# Grant Studio evidence — 3 November 2026

Branch `feat/grant-studio`. Local production build (`pnpm --filter @workspace/content-os build`, `pnpm --filter @workspace/api-server build`) served by the API on port 8080 against a local PostgreSQL 16 database. Opportunities are **live Grants.gov data** (public, keyless API). Organizations are **synthetic** and labelled "(synthetic demo)". No AI provider is configured, so drafting shows the labelled demo scaffold. Nothing was submitted anywhere, no paid resource was used and nothing was deployed.

## Live sync

- Search: 1,393 opportunities fetched across eligibility codes 12, 13, 22, 23, 25 and 99. 1,348 passed the publication gate.
- Details: 1,227 fetched in one sync (four at a time), and the rest on earlier runs or on open.

## Browser journey (Playwright Chromium, 1440×900 and Pixel 7)

| Step | Result | Screenshot |
|---|---|---|
| Add a 501(c)(3) literacy nonprofit (focus areas literacy, reading, early childhood, after-school) | Created | `02-add-organization.png` |
| Matches | 163 on its topics · 1,060 eligible of 1,348 · 288 excluded (eligibility, deadline or cost share), each with a reason | `03-nonprofit-matches.png` |
| Readiness | SAM/UEI, AOR and IRS letter set to ready and saved | `04-readiness.png` |
| Opportunity (top match: NEH Public Humanities Projects) | Official record, fit reasons and gaps | `05-opportunity.png` |
| Confirm eligibility and start | Application created; compliance matrix seeded and confirmed | `06-requirements.png` |
| Write | Draft with AI inserted the labelled demo scaffold | `07-write-demo-scaffold.png` |
| Budget | Personnel line $30,000, justification, ceiling check | `08-budget.png` |
| Review & package | 5 of 10 checks pass with a Fix link on each failure; final download locked; draft DOCX downloaded (`…-DRAFT.docx`, starting "DRAFT: not approved for submission") | `09-package.png` |
| Add a small business (technology, research, energy) | 783 on its topics · 1,026 eligible | `10-business-matches.png` |
| Hub, desktop and mobile | Organizations, applications, sync status, demo notice | `11-hub.png`, `m-hub.png`, `m-matches.png` |

axe (WCAG 2.0/2.1 A/AA) found no serious or critical violations on any step, the dialogs included. Mobile pages had no horizontal scroll.

## Finding fixed during the run

The first run ranked a cancer R01 first for the literacy nonprofit: broad focus areas scored almost flat, the mission was unused, and only 40 detail records were fetched per sync. As a result, cost sharing and award ranges were unknown for most matches. The fixes were tiered topic credit, distinctive mission terms, the **Only my topics** filter, relevance-first ordering, and detail fetches for every open opportunity. The second run surfaced the cost-share case: an opportunity requiring cost sharing that this organization cannot commit is now excluded from the list, with the reason given, instead of only on its detail page.

## Automated checks (local, Linux)

| Check | Result |
|---|---|
| `pnpm run format:check`, `pnpm run typecheck` | Pass |
| API unit (`test:unit`) | 168 passed (31 Grant Studio) |
| API database-backed (`test`) | 348 passed (4 Grant Studio integration) |
| Content OS (`test`) | 27 passed |
| Playwright, CI condition (`NODE_ENV=test`, empty opportunity store) | 6 passed, including `grant-studio.spec.ts` and the accessibility gate with `/grant-studio` |
| Playwright against the live-data demo | `grant-studio.spec.ts` and the accessibility gate pass |
| `pnpm run build` | Pass (existing chunk-size warning only) |

Hosted CI on the pull request is authoritative for the merge decision.

## Addendum, 4 November 2026: match alerts and broad focus areas

Branch `feat/grant-studio-alerts` (stacked on `feat/grant-studio-clean`). Migration `0017_grant_match_alerts`.

| Check | Result | Screenshot |
|---|---|---|
| Hub alert badges | New-match and closing-within-14-days counts per organization | `12-hub-alerts.png` |
| Matches with **Only new** | "162 new · 162 on your topics · 1,054 eligible of 1,342"; New chips; **Mark all as seen** stored the seen time | `13-matches-new.png` |
| Broad focus areas | The organization with "health, education, research, community" is told that "health" and "research" appear in most eligible opportunities | `14-broad-focus-areas.png` |

**Simulated:** every demo opportunity was stored before the demo organizations were added, so none would be new. For screenshots 12 and 13, the literacy organization's `matches_seen_at` was set to just before the first sync in the demo database. The integration test checks the real path against a real database: an opportunity stored after the organization is added, one `grant.new_matches` webhook event and then none, mark as seen, and isolation.

axe found no serious or critical violations. Local checks: API unit tests 171 passed (34 Grant Studio); database-backed API tests 352 passed (5 Grant Studio integration); Content OS 27 passed; Playwright 6 passed under the CI condition and 3 against the live-data demo; format, typecheck and build pass.

## Addendum, 4 November 2026: fact library

Branch `feat/grant-studio-library` (stacked on `feat/grant-studio-alerts`). Migration `0018_grant_fact_library`.

| Check | Result | Screenshot |
|---|---|---|
| Fact library tab | Three synthetic facts, labelled synthetic: two confirmed, one unconfirmed and marked "Not confirmed, so drafting does not use it" | `15-fact-library.png` |
| Write step | The Statement of need lists only its confirmed need fact, with source, date and **Copy**; the programs fact stays with its own sections | `16-write-facts.png` |

axe found no serious or critical violations on either page. The integration test shows that the demo draft includes the confirmed fact with its source and leaves out the unconfirmed one. Local checks: API unit tests 37 Grant Studio; integration 6; Playwright 6 under the CI condition (now including adding a confirmed fact) and 3 against the live-data demo.

## Addendum, 4 November 2026: deadline calendars and reminders

Branch `feat/grant-studio-deadlines` (stacked on `feat/grant-studio-library`). Migration `0019_grant_deadline_reminders`.

- Integration test against a real database:
  - the application and opportunity `.ics` files carry the right all-day date, and come back as `text/calendar` attachments;
  - the combined calendar holds only the operator's own open applications;
  - another operator gets 404;
  - a closed opportunity gets 404;
  - at 10 days left, the 14-day reminder event fires once across two runs, and moving the closing date to 5 days left fires the 7-day one.
- Unit tests: RFC 5545 text escaping, 75-octet line folding that never splits a UTF-8 character, three alarms per event, unreadable dates skipped, and the threshold sequence.
- Local checks: API unit tests 40 Grant Studio; integration 7; Playwright under the CI condition and against the live-data demo (results in the pull request).

## Addendum, 4 November 2026: California Grants Portal

Branch `feat/grant-studio-california` (stacked on `feat/grant-studio-deadlines`). Migration `0020_grant_state_sources`.

**Source check:** data.ca.gov dataset `california-grants-portal`, "Grants Offered" (keyless, updated daily by the State). All 2,027 records were profiled on 4 November: 154 active, 3 forecast and 1,870 closed. Of the 157 open records, 125 have an "Ongoing" deadline. SBIR.gov's API answered 403 "Forbidden" from its own gateway, not from the network proxy, so it stays unconnected.

**Live sync (demo database):** 157 open California records fetched and stored. 150 passed the publication gate: 121 rolling and 29 dated. The other 7 were held back: 6 have no https program or agency link, and 1 deadline has passed although the portal still lists it as active. Of the published records, 112 are open to nonprofits, 22 to businesses, and 25 state a match percentage.

| Check | Result | Screenshot |
|---|---|---|
| Hub | "1,492 open opportunities from California Grants Portal (150) and Grants.gov (1,342)" | `17-hub-sources.png` |
| California nonprofit's matches (synthetic, state CA, food access) | CA state program badges; 1,236 eligible of 1,492 | `18-ca-matches.png` |
| California opportunity | "California Grants Portal · CA state program"; fit reasons say "Eligibility includes nonprofits" (the portal's own term) and "A CA state program, and this organization is in CA"; no SAM.gov or Grants.gov gaps | `19-ca-opportunity.png` |

axe found no serious or critical violations, and the mobile Matches page had no horizontal scroll. The integration test runs a fake portal through to a state application: rolling records published, an insecure link held back, residency and match-percentage exclusions, the `state_nonprofit` template with no SF-424 or SAM.gov rows, a readiness check that passes without federal registrations, closing of records that leave the open set, and failure recording.
