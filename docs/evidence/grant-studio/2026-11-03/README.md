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
