# Grant resource directory

Decision: **ADOPT — curated information directory**, authorized by the owner’s November 2, 2026 request: “we need all the top grant info in it.” Owner: ebyron357. Review date: December 2, 2026, or earlier when a funder changes a call.

## Delivered scope

The authenticated `/grants` screen adds 21 curated resources to Content OS without changing the existing visual system. It includes cash grants, grant-or-investment funding, partner-led grants, advertising/cloud credits, software grants, a fundraising platform and funding directories. This is a practical starting collection selected for community nonprofits and international work, not an exhaustive list or a ranking of funders. Search covers names, mission, expenses, topics and geographic descriptions. Funding-type, location and published-status filters combine.

Every resource records amount or benefit, geography, eligibility summary, supported uses, restrictions, timing, status, official sources and the source-check date. Dollar General’s four programs are separate entries because amounts, eligible expenses and cycles differ. The preparation checklist helps users assemble common application information; each funder controls its actual requirements.

Primary-source research was checked November 2, 2026. The canonical data and source links are in `artifacts/content-os/src/data/grants.ts`. This is hand-maintained information, not a live funding feed. No account-specific eligibility is inferred. Country coverage does not establish registration eligibility or project fit. Unknown amounts and deadlines remain unknown. Relative-cycle wording is accompanied by the check date. Dated deadlines are marked for review after their calendar day in UTC (conservative; users must confirm the actual funder timezone). Records older than 30 days are also marked for review.

## Important findings preserved in the product

- Google Ad Grants is advertising credit, not cash for operations.
- Walmart requires a project benefiting the selected U.S. facility’s community.
- The Pollination Project has volunteer, budget and use restrictions.
- Peace Development Fund’s next organizing application opening is January 2027.
- D-Prize is for distribution of accepted proven poverty interventions, not general aid or construction.
- DRK’s published regions exclude Haiti-only operations; its capital can be a grant or investment.
- Rotary applications require qualified club/district sponsors.
- Roddenberry reports no open programs; IAF’s applicant portal reports funding paused. Both remain visibly unavailable watchlist entries.
- AWS official pages describe differing credit amounts; the entry requires tier confirmation rather than selecting an unsupported figure.
- GlobalGiving is fundraising access, with no guaranteed grant or donor acquisition.
- Candid and Grants.gov are research/discovery resources, not direct awards to every user.

## Maintenance

1. Open every official source attached to a record.
2. Resolve conflicting terms with the program provider. If unresolved, retain “Verify terms” and explain the conflict.
3. Update eligibility, amount, use limits, status and timing together. Clear elapsed deadlines only when a new official cycle is confirmed.
4. Change `checkedOn` only after checking the sources. Keep exact dates in ISO format and the funder timezone in timing text.
5. Run the directory tests, workspace typecheck/build and browser accessibility checks through a focused PR.

The review date is a maintenance recommendation, not a scheduled automation. Do not describe this directory as continuously verified or automatically updated.

## Scope boundaries

The owner authorized grant information in the application. This package does not add applicant records, automated eligibility decisions, proposal generation, application submission, scraped databases, paid integrations or a new identity/storage model. Those advanced workflows remain deferred. The catalog contains public program summaries and links, with no funder-page snapshots or private applicant data.

## Validation and release

Validation results and release blockers are recorded in `PROJECT_STATUS.md` and the pull request. Browser tests in `e2e/grants.spec.ts` use an explicit authentication UI fixture; they do not establish server authentication security. The existing real-session accessibility gate now also visits `/grants`. No production claim is made by a local build or screenshot.
