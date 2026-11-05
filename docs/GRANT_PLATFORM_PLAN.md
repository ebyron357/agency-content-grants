# Grant Platform Plan: one system from discovery to award closeout

**Status:** PROPOSED. It becomes the approved plan when the owner accepts it, and the decisions in §12 are recorded in `GO_NO_GO_DECISION.md`.
**Date:** 4 November 2026. **Owner:** Emmanuel Andre Byron (`ebyron357`). **Review date:** 4 December 2026.
**Supersedes:** the 3 November version of this file. It replaces that version completely, and keeps its repository audit, its submission gate and its risk controls. It extends the curated directory in [`GRANT_RESOURCES.md`](GRANT_RESOURCES.md); no part of that directory is replaced.

## 1. Outcome

A nonprofit or a small business opens one product and, without another tool or a spreadsheet:

1. **Knows what it can win.** Live federal and state opportunities from official sources, foundations that fund organizations like it (from their public tax filings), and the history of who won each program before.
2. **Writes a winning application.** It extracts the notice into a checklist, grounds every claim in the organization's own confirmed facts, follows the funder's limits and review criteria, and goes through team review and approval.
3. **Submits with confidence.** A complete, compliant package and a submission record. Grant Studio never submits on its own. Assisted submission is a gated later release (§10, R6).
4. **Manages the award.** Budget against actual spending, reporting deadlines, report drafts, and closeout.
5. **Gets faster every time.** Facts, approved writing, budgets and outcomes carry into the next application.

The plan counts as delivered only when all five work end to end for one pilot nonprofit and one pilot business, on production, with the evidence in §11.

## 2. Market: what exists and what is missing (researched 4 November 2026)

### 2.1 The landscape

The grant software market has two sides. Funder-side platforms (Fluxx, Submittable, Foundant GLM) run grant programs for foundations, and are the wrong tool for applicants ([OpenGrants comparison](https://opengrants.io/grant-management-software-comparison-what-to-buy-when/), [Guideflow](https://www.guideflow.com/blog/grant-management-software)). Applicants assemble several tools:

| Need | Typical tool | Reported price | What it leaves out |
|---|---|---|---|
| Discovery and tracking | Instrumentl | Discover ~$299/mo; full lifecycle ~$999/mo (figures conflict across sources) ([Grantcue](https://www.grantcue.com/blog/instrumentl-vs-candid-vs-grantstation), [GrantOrb](https://grantorb.com/blog/best-ai-grant-writing-tools-compared/)) | Writing tools are reported as limited compared with proposal platforms; AI drafting only on the $499 tier |
| Funder research | Candid (Foundation Directory) | Premium from ~$1,199/yr; often used through libraries | No writing or award management |
| Research membership | GrantStation | $699/yr | A membership, not workflow software |
| AI drafting | Grantable, Grant Assistant, others | Grantable from $0, paid from ~$50–150/mo | Discovery is reported to screen historical IRS 990s rather than verify live opportunities; AI use is metered |
| Post-award federal compliance | GrantVantage, GrantPipe, accounting add-ons (Aplos, QuickBooks Nonprofit, WiseCost) | Varies | Separate from pre-award; aimed at mid-sized federal recipients |

These are vendor and affiliate sources, so they are directional, and prices must be confirmed with each vendor ([Software Advice](https://www.softwareadvice.com/nonprofit/grant-management-comparison/), [Vercor on 2 CFR 200 tools](https://vercor.ai/resources/compliance/2-cfr-200-grant-compliance-software)).

### 2.2 The gaps

| # | Gap | Evidence | Grant Studio's answer |
|---|---|---|---|
| G1 | **Fragmentation.** Discovery, writing and post-award live in separate tools, so finances, deliverables and status sit in spreadsheets | Buyers' most frequent complaint, per comparison sites ([Software Advice](https://www.softwareadvice.com/nonprofit/grant-management-comparison/)) | One system across all five stages (§1) |
| G2 | **Discovery trust.** Listings drawn from historical 990s are not live, verified opportunities | Reviews of Grantable's discovery ([GrantOrb](https://grantorb.com/blog/best-ai-grant-writing-tools-compared/)) | Official feeds, a publication gate, freshness and official links (built). Foundation data is labelled as funding history, never as an open call |
| G3 | **AI trust.** No published accuracy or hallucination measurements for grant AI tools | No independent tests found in this research | Drafting limited to confirmed, sourced facts (built). Next: claim-level citations, an unsupported-claim detector, and a published evaluation harness (§6, R3) |
| G4 | **Post-award for small organizations.** 2 CFR 200 asks for per-award tracking against budget (200.302), drawdowns, reporting and time and effort records (200.430). Small organizations patch accounting tools with add-ons | [Vercor](https://vercor.ai/resources/compliance/2-cfr-200-grant-compliance-software), [WiseCost](https://www.usewisecost.com/blog/uniform-guidance-compliance-nonprofits), [Kleer](https://www.getkleercard.com/blogs/nonprofit-accounting-software) | An awards workspace (§7, R4) |
| G5 | **Businesses and state economic development** are poorly covered. Tools focus on nonprofits and federal research | The research found few state economic development finders | Business applicant types, SBIR/STTR and state templates (built); a source registry for more states (§4) |
| G6 | **Built for big teams.** Tools are overbuilt and costly for small nonprofits, with a learning curve and clunky reporting | [Software Advice](https://www.softwareadvice.com/nonprofit/grant-management-comparison/), [GivingData](https://www.givingdata.com/insights/what-to-watch-out-for-in-grant-management-software-reviews) | Guided flows in plain language, no-setup onboarding, readability checks, and a quality bar (§5) |
| G7 | **Price.** The full lifecycle costs about $1,000/month at the leader | As above | Pricing for small organizations (§12, D10) |

### 2.3 Open, official data that makes this possible (verified 4 November 2026 from the build environment)

| Source | Use | Check |
|---|---|---|
| Grants.gov Search and Fetch APIs (keyless) | Live federal opportunities | ✅ Ingested daily (built) |
| California Grants Portal (data.ca.gov, keyless) | Live state opportunities | ✅ Ingested daily (built) |
| IRS Form 990 e-file XML (`apps.irs.gov/pub/epostcard/990/xml/2026/`) | Foundation funders: 990-PF grants paid, giving by place and purpose, application instructions | ✅ The 2026 index lists about 472,000 returns, about 85,000 of them 990-PF. Batches are about 70 MB zip files |
| ProPublica Nonprofit Explorer API v2 (keyless) | Organization lookup by EIN or name, to prefill profiles and identify funders | ✅ 200; for example 1,147 North Carolina foundations |
| USAspending.gov API (keyless) | Past federal awards per assistance listing: winners, amounts, in-state awards | ✅ 200 on `spending_by_award_count` |
| SAM.gov Assistance Listings | Program rules behind each listing | Needs a free API key (owner, §12) |
| SBIR.gov API | Small-business research solicitations | ❌ 403 "Forbidden" from SBIR.gov's own gateway on 3 and 4 November |
| Other states | — | No state other than California publishes an official, keyless opportunities feed found in this research; Oregon's datasets are empty placeholders |

## 3. What is built (4 November 2026, open pull requests, not merged or deployed)

| Area | Built | PR |
|---|---|---|
| Discovery | Grants.gov daily sync with detail for every open record; California Grants Portal; publication gate; closing of records that leave the open set | #29, #33 |
| Matching | Nonprofit and business types; readiness with expiry; hard exclusions with reasons; explained 0–100 score; on-topic filter; broad-topic warning; state residency; stated match percentage; human eligibility confirmation | #29, #30, #33 |
| Alerts | New and closing-soon counts; `grant.new_matches` and `grant.deadline_approaching` webhook events; deadline calendars (`.ics`) | #30, #32 |
| Writing | Compliance matrix (template plus AI extraction); federal, SBIR/STTR and state templates; fact library with confirmation; grounded drafting; limits; reviewer scoring; approved-writing reuse | #29, #31, #38 |
| Budget and package | SF-424A budget, justification, ceiling check, ten compliance checks, approvals, DOCX package | #29 |
| Outcomes | Submission, award, decline and withdrawal records; pipeline and win rate | #39 |
| Capacity | Measured: first full sync peaks at 248 MB; grant data is 4 MB; cached hub summaries | #37 |

Every PR has unit tests, integration tests against a real database, a browser journey with accessibility checks, and evidence in `docs/evidence/grant-studio/2026-11-03/`.

## 4. Architecture rules: configuration over code

"No hardcoding" is a design rule, not a slogan. Anything that varies by funder, state, program type or customer is **data with an admin screen**, versioned and tested, not code:

| Thing | Today | Target (R1) |
|---|---|---|
| Opportunity sources | Two connectors in code (Grants.gov, California) | A **source registry** table: connector type, endpoint, schedule, field mapping, eligibility mapping, terms of use, owner and status. Code holds connector *types* (CKAN, Socrata, REST JSON, XML bulk); a new state on an existing type is a registry row and a mapping, not a release |
| Templates and requirements | Five templates in `templates.ts` | A **template registry**: sections, guidance, limits and requirement rows as versioned data, with an editor. Applications pin the template version they started from |
| Readiness items | Seven kinds in `eligibility.ts` | A **readiness registry** by jurisdiction and applicant type (federal, each state, foundations) |
| Eligibility mappings | Grants.gov codes, plus the California mapping in code | Mapping tables per source, shown on the source's admin page |
| Interface text | English strings in components | A message catalog (English, then Spanish), so no user-facing text is hardcoded |
| Limits and thresholds | Constants (14-day reminders, 40% broad-topic share, cache size) | Settings with defaults, per organization where it makes sense |
| Feature rollout | Branches | Feature flags per organization, so pilots get features first |

Two further rules:
- **Heavy work leaves the web process.** Syncs, IRS 990 parsing and report generation run in a background worker with a database-backed job queue (retries, idempotency, visibility). The web instance stays inside its 512 MB.
- **Every number has a source.** Any figure shown to a user links to its record (an official listing, a filing, an award, or a fact the organization confirmed).

## 5. Quality bar: what "platform-grade" means here

The bar the owner set ("prepared like Microsoft and Apple system software") is defined as checks that can pass or fail:

| Area | Requirement | Check |
|---|---|---|
| Accounts and security | Organization accounts; invites; roles (owner, writer, reviewer, authorized representative, finance); passwords hashed with the existing scheme; optional TOTP two-factor; session list and sign-out everywhere; audit log of approvals, outcomes, exports and permission changes | Cross-tenant tests generated for **every** route; an audit entry for each listed action |
| Reliability | Background worker and job queue; retries with backoff; no work lost on restart; daily backups (existing runbook) | Kill-and-restart test of the worker mid-sync; restore drill recorded |
| Performance | p95 under 300 ms for common API reads; Grant Studio pages interactive in under 2 s on a mid-range phone; memory under 70% of the plan at peak | Timings in CI against the seeded dataset; the capacity measurement repeated each release |
| Accessibility | WCAG 2.1 AA; full keyboard use; screen reader labels; no horizontal scroll at 390 px | The existing axe gate on every screen, plus a manual screen reader pass per release |
| Interface quality | Every screen has loading, empty, error and success states; destructive actions confirm or undo; autosave with version history for sections; consistent design tokens | A screen checklist in the PR template; browser journeys for each flow |
| Help | An onboarding checklist; contextual help on each step; a help center; plain-language copy with a readability check | Readability grade under 9 for help text |
| Privacy | Organization data export and deletion; no cross-organization model training; terms, privacy policy and data processing terms reviewed by counsel | Export and deletion tested; documents signed off by counsel |
| Operations | Error tracking, an uptime monitor and a status page | Alerts tested monthly |

## 6. Writing studio 2.0 (what moves the win rate)

1. **Read the notice itself.** Upload or fetch the notice PDF. Text is extracted with [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), with OCR deferred. The requirement checklist is extracted with page citations, and a person confirms it.
2. **Claim-level grounding.** Every sentence that states a number, a name, a result or a partner links to a confirmed fact or a cited source. An **unsupported-claim detector** flags the rest before approval.
3. **Reviewer simulation.** Each section is scored against the notice's own criteria and points, with specific fixes.
4. **Plain-language and readability checks** with [retext](https://github.com/retextjs/retext) plugins (MIT), so they work even without an AI key.
5. **Collaboration.** Assign sections, comment, compare versions, and lock approved text.
6. **Letters of support tracker.** Who was asked, the request template, status and due date, linked to its requirement row.
7. **Package.** DOCX and PDF (reusing the existing exporter), the Grants.gov forms checklist from the opportunity package, and a pre-submission check.
8. **Evaluation harness.** A fixed set of synthetic notices and organizations, scored on requirement coverage, limit compliance and unsupported claims for each AI provider, with the results published in the evidence folder. This answers G3 with numbers rather than claims.

## 7. Awards workspace (post-award)

When an outcome is **Awarded**, the application becomes an award:

- **Award record:** award number, period, amount, terms, program officer and the documents from the award letter.
- **Budget against actual spending:** a CSV import from any accounting system first, then QuickBooks and Xero connections (each needs a developer account, §12). Spending is shown per budget line and category, with alerts when a line drifts.
- **Reporting calendar** from the award terms: interim and final narrative reports, financial reports, and federal SF-425 data preparation.
- **Report builder:** narrative reports drafted from the application's objectives and the organization's confirmed outcome facts, with the same grounding rules.
- **Time and effort records** for staff charged to federal awards (2 CFR 200.430), and subrecipient tracking where it applies.
- **Closeout checklist** and a lessons-learned note that feeds the next application.

## 8. Discovery 2.0

- **Foundation intelligence from IRS 990-PF filings.** A worker job reads the e-file XML index and batches, and builds funder profiles:
  - total giving, and giving by state and by purpose;
  - grant size distribution and recent grantees;
  - the filing's application instructions and deadlines (990-PF Part XV).
  Matching suggests foundations that have funded organizations like this one. These are always labelled **funding history from tax filings, not an open call**, with a link to the filing.
- **Past federal awards (USAspending).** For each federal opportunity's assistance listing: the number of awards, the median and range of award sizes, and the in-state winners in recent years. This informs the budget and the go/no-go decision.
- **Profile prefill (ProPublica).** Look up the organization by EIN or name. Its legal name, address, NTEE code and revenue prefill the profile, and the person confirms them.
- **More states through the source registry,** as each state publishes structured data. Pages are monitored for change only where their terms allow.
- **SAM.gov assistance listings,** once a key is provided.
- **Saved searches** and a weekly digest (in the app, then email once a provider is approved).

## 9. Commercial readiness

- **Billing:** plans and limits, a trial, invoices and receipts, through a payment processor (owner decision; for example Stripe).
- **Onboarding:** a wizard (EIN lookup, then readiness, then first matches) that reaches the first match in under five minutes.
- **Legal:** terms of service, privacy policy, data processing terms, and a statement that matches are guidance, not eligibility decisions. All are reviewed by counsel before launch.
- **Support:** a help center, an in-app contact, a status page and a defined response time.
- **Go-to-market:**
  1. Start as an **agency-run service**, which works today with one operator account.
  2. Run the pilots (HRI Foundation plus one business).
  3. Open self-serve after R1 and R5.

## 10. Releases

Each release is a set of focused PRs. A release is done only when its acceptance checks pass on production.

| Release | Delivers | Accepted when |
|---|---|---|
| **R0. Ship what is built** | Merge #29–#39 in order and deploy; production smoke test; branch protection on `main`; an AI key | `/api/healthz` shows the merged commit; the smoke test passes; a real Grants.gov and California sync runs on production; the AI drafting path works |
| **R1. Platform foundation** | Organization accounts, invites, roles, two-factor, audit log; generated cross-tenant tests; background worker and job queue; source, template and readiness registries with admin screens; message catalog | A second organization signs in and can see none of the first's data on any route; a new California-style source is added as a registry row with no code change; the worker survives a restart mid-sync |
| **R2. Discovery 2.0** | 990-PF foundation intelligence; USAspending past awards; ProPublica prefill; saved searches; SAM.gov (with a key) | Foundation suggestions for a pilot organization, each linked to its filing; past-award panels on federal opportunities; a profile prefilled from an EIN |
| **R3. Writing 2.0** | Notice PDF ingestion with page citations; claim-level grounding and the unsupported-claim detector; reviewer simulation; readability; collaboration; letters tracker; PDF package; evaluation harness | One synthetic federal application and one state application go from uploaded notice to approved package with 100% requirement coverage, 0 limit violations and 0 unsupported claims; harness results published |
| **R4. Awards workspace** | Award record; budget against actual spending (CSV, then accounting connections); reporting calendar; report builder; time and effort; closeout | A synthetic award moves from award letter to final report, with spending imported and reminders delivered |
| **R5. Commercial readiness** | Billing, onboarding wizard, legal pages (counsel), help center, email delivery, status page | A new organization signs up, pays, onboards and reaches a first match without help; counsel sign-off recorded |
| **R6. Assisted submission (gated)** | Grants.gov system-to-system submission after the §12 D6 pre-conditions | Conformance in the Grants.gov training environment; legal review on file; an authorized representative approves each submission |

## 11. Success measures (reviewed for each pilot)

- Hours from "match found" to "package approved", compared with the organization's previous process.
- Requirement coverage at approval: 100%. Limit violations: 0. Unsupported claims at approval: 0.
- Matching precision: the share of matches the organization confirms as eligible.
- Applications submitted, the win rate and dollars awarded, from the outcome records.
- For awards: reports delivered on time, and spending variance caught before a report is due.
- Platform: p95 latency, error rate, peak memory, and accessibility gate results each release.

## 12. Owner decisions

| # | Decision | Recommendation | Label |
|---|---|---|---|
| D1 | Approve Grant Studio's scope for nonprofits and businesses, and amend `AGENTS.md` and the charter | Approve | ADOPT |
| D2 | Port Veteran-Hub's domain layer | Grant Studio built its own gate and provenance; revisit only if the registry needs it | DEFER |
| D3 | Pilots: HRI Foundation, plus one named business | Approve, after the 501(c)(3) wording is reconciled | PILOT |
| D4 | Next state source | California is built; add states as they publish structured data | ADOPT |
| D5 | Organization accounts and roles (a security boundary change) | Approve as R1 | ADOPT |
| D6 | Assisted Grants.gov system-to-system submission | Approve the pre-conditions: legal review, applicant authorization, per-submission approval by the authorized representative, conformance testing | DEFER (gated) |
| D7 | An email delivery provider for alerts and digests | Approve a transactional email service in R2 or R5 | ADOPT (cost) |
| D8 | A paid foundation database licence | Not needed: IRS 990-PF data covers the core need | REJECT |
| D9 | A background worker instance (Render) for syncs and 990 processing | Approve for R1; measure first to confirm the size | ADOPT (cost) |
| D10 | Pricing and a payment processor | Decide plans before R5; recommended for small organizations: a free tier with paid plans well below the market leader's full lifecycle | DEFER to R5 |
| D11 | SAM.gov API key (free), and accounting connection developer accounts | Register them | ADOPT |
| D12 | Counsel review of terms, privacy policy and data processing terms | Required before self-serve | ADOPT |

## 13. Risks and controls

- **Wrong eligibility or deadlines.** Prevented by official links, the publication gate, freshness marks and human confirmation before applying. Grant Studio never guarantees eligibility.
- **AI fabrication.** Prevented by confirmed-fact grounding, claim-level citations, the unsupported-claim detector, labelled demo output and per-section approval. Measured by the evaluation harness.
- **Cross-organization exposure.** Prevented by organization-scoped data from day one, cross-tenant tests generated for every route, the audit log, and no shared model training.
- **Foundation data misread as open calls.** Prevented by labelling, linking each profile to its filing, and keeping foundation data out of "open opportunity" counts.
- **Source terms.** Only official APIs and permitted pages are used. Each source's terms are recorded in its registry row.
- **Capacity and cost.** Heavy jobs run in the worker; each release repeats the capacity measurement; every new paid service needs owner approval.
- **Scope creep.** One release at a time, each with acceptance checks on production. Nothing is marked complete without traceable evidence (`PROJECT_COMPLETION_STANDARD.md`).

## 14. Repository audit (3 November 2026, unchanged)

All 54 of the owner's repositories were searched. Only `Veteran-Hub` (provenance and publication-gate design) and `Haiti` (HRI Foundation, the first pilot nonprofit) were relevant; the others are unrelated (investment, housing, sourcing or stubs). Grant Studio applied Veteran-Hub's principle ("no evidence, no publication") without porting its code (D2).
