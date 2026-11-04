# Grant Platform Plan: discover, match, write, apply

**Status:** PROPOSED. It becomes the approved plan when the owner accepts it, and the decisions in §11 are recorded in `GO_NO_GO_DECISION.md`.
**Date:** 3 November 2026. **Owner:** Emmanuel Andre Byron (`ebyron357`). **Review date:** 3 December 2026.
**Supersedes:** nothing. It extends the curated directory in [`GRANT_RESOURCES.md`](GRANT_RESOURCES.md) (PR #26) and replaces no part of it.

## Implementation status (4 November 2026)

At the owner's request ("system software that operates end to end"), the first phases were built as Grant Studio. Nothing below is merged or deployed. The pull requests are open for owner review, and their scope is recorded in [`GRANT_STUDIO.md`](GRANT_STUDIO.md) on those branches.

| Phase | State | Where |
|---|---|---|
| 0. Decide | **Open.** D1 is effectively requested by the owner's 3 November instruction; it is recorded as pending owner approval of the pull requests | This PR, #29 |
| 1. Registry foundation | **Not done; built differently.** Grant Studio has its own publication gate, provenance fields (source, source reference, fetch times, checksum, connector version) and gate tests, instead of a Veteran-Hub port. The 21 curated records stay in `/grants`, unchanged. D2 should be revisited: ADOPT → DEFER unless a second source needs the shared registry | #29 |
| 2. Live federal discovery | **Built for Grants.gov.** Per-code search, daily sync, detail for every open opportunity, publication gate, failure recording, and contract tests with a fake Grants.gov. SBIR.gov (403) and SAM.gov (404) are still blocked from the build environment | #29 |
| 3. Profiles and matching | **Built.** Profiles for nonprofits and businesses, readiness with expiry, hard exclusions with reasons, an explained score, on-topic filtering, broad-topic warnings, and human eligibility confirmation. New-match and closing-soon alerts, plus a `grant.new_matches` webhook event | #29, #30 |
| 4. Writing studio | **Built.** Compliance matrix (template plus AI extraction), section blueprints including SBIR/STTR and state templates, grounded drafting from a confirmed, sourced fact library, limits, SF-424A budget, reviewer scoring, approvals and DOCX package export | #29, #31, #33 |
| 5. Pilots and state | **Mostly built.** In-app alerts and the webhook event (#30), the deadline calendar and reminders (#32), and the first state source: the California Grants Portal, chosen over D4's North Carolina because California publishes keyless, structured open data and North Carolina has no comparable feed (#33). Still open: pilots, which need the owner and the pilot organizations' consent | #30, #32, #33 |
| 6. Accounts and assisted submission | **Not started** (gated, D5 and D6) | — |

D7 (email digests): the `grant.new_matches` webhook event lets the owner route alerts to email through existing automation, with no email service added. In-product email stays deferred.

## 1. Outcome

Two kinds of applicant use one workspace to apply for grants:

- **nonprofits** (501(c)(3) and others);
- **businesses** (small businesses and other for-profits).

For each applicant, the platform does five things:

1. **Knows what is available.** Live federal opportunities, the curated directory and, later, state programs. Each listing is linked to its official source and shows its freshness.
2. **Shows what fits.** Opportunities the applicant is eligible for, with the reasons, the deadline, the award range and any readiness gaps, such as an expired SAM.gov registration.
3. **Writes the application.** Professional grant writing tools:
   - a compliance matrix built from the funding notice;
   - section drafting grounded in the applicant's own facts;
   - a budget and budget justification;
   - scoring against the funder's review criteria;
   - review and approval before anything leaves the platform.
4. **Applies.** First, a complete, export-ready submission package that the applicant submits. Later, assisted submission through Grants.gov's system-to-system interface, after the applicant's Authorized Organization Representative (AOR) approves (§8, gated).
5. **Keeps going after the award.** Deadlines, reporting dates and a reusable content library, so each application is faster than the last.

A product that only lists grants, or only drafts text, does not meet this plan. All five stages must work end to end for one pilot nonprofit and one pilot business before the plan counts as delivered (§10).

## 2. What already exists (verified 3 November 2026)

| Capability | Where | Reuse |
|---|---|---|
| Research plans and questions, sources with storage, claims with citations, citation and freshness scoring | `research.ts`, `sources.ts`, `claims.ts`, tables `research_plans`, `research_questions`, `sources`, `claims` | The evidence layer for need statements and cited facts |
| Outlines and sections, documents with section revisions, rich editor, images and video | `outlines.ts`, `documents.ts`, tables `outlines`, `outline_sections`, `documents`, `document_sections`, `section_revisions` | Each application section is a document section with revision history |
| Quality evaluation and issues | `quality.ts`, tables `quality_evaluations`, `quality_issues` | Extended into reviewer-criteria scoring |
| Brand Brain: audience profiles, brand facts, knowledge entries | `brand-brain.ts`, `brands.ts` | Becomes the applicant's **boilerplate library**: mission, history, capacity, past performance |
| Content blueprints | `blueprints.ts`, `content_blueprints` | Grant section blueprints (§5) |
| AI router for Anthropic, OpenAI and Gemini, with labelled demo output | `lib/ai/router.ts` | Drafting, requirement extraction and critique. Demo output stays labelled |
| DOCX, PDF, HTML, Markdown and TXT exports | `exports.ts`, `lib/exporters` | Package export (§6) |
| Webhooks, automation API, idempotency | `webhooks.ts`, `automation.ts` | Deadline and new-match events |
| Curated grant directory: 21 primary-source resources for nonprofits and international work | `/grants`, `artifacts/content-os/src/data/grants.ts`, `GRANT_RESOURCES.md` | Kept as the curated tier (§4.3) |
| Single shared operator account; per-project ownership checks | `auth.ts` | **Gap:** applicants cannot sign in as their own organization (§7) |

### Related repositories audited 3 November 2026

All 54 of the owner's repositories were searched.

| Repository | Decision | Reason |
|---|---|---|
| `Veteran-Hub` | **ADOPT** (port the domain layer) | Its records for source, organization, opportunity, evidence and claim carry provenance: source, canonical URL, fetch time, parser version, checksum and confidence. It has freshness classes, including `grant_scholarship`, and a tested publication gate that blocks unverified, date-sensitive records. It also has CSV/JSON import. It is TypeScript, and its ingestion design already lists Grants.gov and SAM.gov. Port `src/lib/domain/*` and `src/lib/import/*` with their tests, not its Next.js app |
| `Haiti` (HRI Foundation) | **PILOT** (first nonprofit) | A real nonprofit with donor, partner and international work. Its "registered non-profit initiative" and "501(c)(3)" wording must be reconciled before federal applications |
| `source-intelligence-engine` | **REJECT as code; keep as reference** | Its domain is liquidation sourcing. Only its rule carries over: "verify the source; no evidence means unverified" |
| `DAffordableHomes-Platform` | **REJECT** | It covers homebuyer assistance for individuals, not organizational grants |
| `Terracecapitalfund`, `market-intelligence-platform`, the remaining 46 | **REJECT** | They contain investment-fund content, a 4-file stub, or false matches (SQL `GRANT`, OAuth grants) |

## 3. Applicants and their readiness

**Applicant organization profile.** Each organization is its own tenant (§7) and records:

- Legal name, type and EIN.
- Organization type, using Grants.gov applicant-type codes, for example `12` (501(c)(3) nonprofit), `13` (non-501(c)(3) nonprofit), `23` (small business) and `22` (other for-profit). The codes come from the Grants.gov `search2` eligibility facets, verified 3 November 2026.
- State, counties and service area.
- NAICS codes (for businesses) and mission areas.
- Annual budget or revenue, and headcount.
- For businesses: ownership categories, recorded only when the applicant states them.
- **Readiness records**, each with a document, an expiry date and who confirmed it:
  - UEI and SAM.gov registration status and expiry. Federal awards require an active registration (2 CFR Part 25).
  - Grants.gov roles. A submission needs an Authorized Organization Representative (AOR).
  - IRS determination letter for 501(c)(3) status.
  - Most recent financial statements or audit, and the indirect cost rate agreement if there is one.
  - Board list, key staff résumés, a capability statement and past awards.
- **Readiness score** with blocking gaps. For example: "SAM.gov registration expires before this deadline: renew now; renewal can take weeks". The platform states each gap with its source. It never asserts eligibility as a legal conclusion (charter, Boundaries).

## 4. Discovery: what is available

All sources go into one opportunity registry, which uses the Veteran-Hub provenance and publication-gate model. No opportunity reaches an applicant unless it has an official source URL, a fetch time and a passing publication gate. Deadlines and award amounts always link back to the primary source (charter, grant-research source policy).

### 4.1 Federal (Phase 2, free, authoritative)

| Source | Use | Status |
|---|---|---|
| **Grants.gov Search API** (`POST https://api.grants.gov/v1/api/search2`) | Posted and forecast opportunities, with filters for eligibility, agency, category and status | **Verified 3 November 2026.** No key needed. A nonprofit keyword search returned 446 hits; eligibility `23` (small businesses) returned 390 posted opportunities |
| **Grants.gov Fetch Opportunity** (`POST /v1/api/fetchOpportunity`) | Details for each opportunity: synopsis, assistance listings (CFDA), packages and forms, documents | **Verified to respond.** The field coverage of each opportunity must be mapped in Phase 2, because some return empty synopsis or form lists |
| **SBIR/STTR** (sbir.gov public API) | Small-business research and development solicitations | **To verify.** The endpoint returned `403 Forbidden` from the agent environment. Confirm the access terms and endpoint before building |
| **SAM.gov Assistance Listings** | Program descriptions behind each assistance listing number, such as eligibility, matching requirements and use restrictions | **To verify.** It needs an API key, and the tested endpoint returned 404. Confirm the current endpoint |
| **USAspending.gov API** | Past awards for the same assistance listing: typical award size, prior recipients in the applicant's state, for competitive context | Planned; to verify in Phase 2 |

### 4.2 State and local (Phase 4)

- Starts with one state the owner chooses. North Carolina is suggested because the agency's work is in the Carolinas.
- Grows one state at a time.
- Each state portal is a registered source with its own connector or monitored page.
- Change monitoring follows Veteran-Hub's ingestion design: checksum and last-meaningful-change, with no unauthorized scraping.
- Each program record needs a human verification before it is published.

### 4.3 Curated and private (continuing)

- **The curated directory stays.** Its 21 records move into the registry as the curated tier and keep the `checkedOn` dates and maintenance rules in `GRANT_RESOURCES.md`.
- **Business-focused curated records** are added the same way: corporate small-business grant programs and state economic development grants, each sourced and dated.
- **Private foundation databases** such as Candid are licensed products. **DEFER** until a licence is accepted (§11). Public IRS Form 990-PF data, which identifies foundation funders, is a free candidate for Phase 5.

### 4.4 Cadence and cost

- Grants.gov is ingested daily and fetched on demand when a match is opened.
- Curated records are reviewed monthly.
- State sources have their own cadence.
- The scheduler is the existing single-instance, in-process scheduler (operating constraint). There are no new paid services.

## 5. Matching and alerts: what fits

1. **Hard filters**, applied first, with each exclusion explained:
   - applicant type against the opportunity's eligibility codes;
   - geography;
   - status (posted or forecast);
   - a deadline that has not passed;
   - any cost share the applicant marked as not possible.
2. **Fit score** (0–100), with every factor shown:
   - mission and NAICS match against the synopsis and category;
   - award range against the applicant's budget;
   - past awards in the same assistance listing;
   - time left before the deadline;
   - readiness gaps.
3. **The applicant sees:**
   - an "Available for you" list, newest and most urgent first;
   - the reasons for each match and the readiness gaps;
   - the official link;
   - one action: **Start application**.
4. **Alerts.** In-app alerts come first. A weekly email digest follows only after the owner approves outbound email (charter: external communications need approval) and the applicant opts in.
5. **Human confirmation.** Before an application starts, the applicant confirms the eligibility reasons. That confirmation is recorded (charter: grant eligibility conclusions need human approval).

## 6. Writing studio: the core

Each application is a project with a fixed workflow. Every step uses existing Content Machine components.

1. **Read the funding notice.** The platform fetches or uploads the notice (NOFO, RFA or solicitation) and its attachments into Sources. AI extracts a **compliance matrix**: every requirement, required section, page or character limit, formatting rule, attachment, eligibility condition, cost-share rule, deadline and review criterion with its points. Each row cites the page it came from. A person confirms the matrix before writing starts.
2. **Plan the application.** A grant blueprint creates the outline from the matrix. Standard section blueprints:
   - abstract or summary, within its limit;
   - statement of need;
   - project description;
   - goals and SMART objectives;
   - logic model;
   - work plan and timeline;
   - evaluation plan;
   - organizational capacity and key personnel;
   - sustainability;
   - budget justification;
   - letters of support and commitment;
   - for SBIR/STTR: the technical volume and commercialization plan.
3. **Ground every claim.** Drafts use the applicant's boilerplate library (Brand Brain) and cited evidence (research, sources and claims). Examples are community data for the need statement and outcomes from past awards. An unsupported statistic is flagged by the existing citation and claim checks, never invented.
4. **Draft and edit.** AI drafts each section in the rich editor against its matrix rows and limits. The writer edits, and every revision is kept. Live counters show page, word and character limits, and each section shows which matrix rows it covers.
5. **Budget builder.** Line items use the standard federal cost categories from the SF-424A budget form: personnel, fringe, travel, equipment, supplies, contractual, construction, other and indirect. It handles cost share and match. The budget justification is generated from the line items, and its totals are checked against the narrative and the award ceiling.
6. **Review like a reviewer.** The quality engine scores each section against the funder's own review criteria and points, and lists gaps and fixes. The process ends with a compliance check that every matrix row is covered, every limit is met and every attachment is present.
7. **Approvals.** The writer drafts, the reviewer approves sections, and the AOR approves the final package (charter: proposal submission packages need human approval). Approvals are recorded and audited.
8. **Package.** Exports each section as DOCX or PDF within its limits, the budget workbook, the attachment checklist and a forms checklist from the Grants.gov package (SF-424 family and agency forms). The applicant submits the package through Grants.gov Workspace or the funder's portal.
9. **Reuse.** Approved sections go back into the boilerplate library, tagged by topic, so the next application starts further along.

## 7. Accounts, tenancy and data

- **The gap.** The product has one shared operator account (operating constraint). Applicants signing in as their own organization needs organization accounts, users, roles (owner, writer, reviewer, AOR) and per-organization isolation for every applicant record, document and upload. This is a **security-boundary change**. It needs owner approval (charter, Human approvals) and its own PR, with cross-tenant rejection tests, before any outside organization signs in.
- **Until then**, the agency operator runs the workflow on behalf of pilot applicants (agency-managed mode). The data model is still keyed by organization from day one.
- **Data class.** EINs, financial statements, budgets and application content are "financial or grant-application data" (charter). They are encrypted at rest through the existing storage, kept out of logs, follow per-organization retention and deletion (`DATA_LIFECYCLE_AND_OFFBOARDING.md`), and are never used across organizations or to train models.

## 8. Assisted submission (owner decision: "assisted")

Planned as Phase 6 and **gated**. Nothing is submitted automatically.

- **Route.** Grants.gov system-to-system (S2S) submission on behalf of an applicant. It needs:
  - the applicant's active SAM.gov registration and UEI;
  - an applicant AOR who approves each submission in the platform;
  - Grants.gov S2S certificate registration;
  - conformance testing in the Grants.gov training environment.
- **Pre-conditions:**
  - organization accounts (§7);
  - a legal review of acting as the applicant's submitting system;
  - written applicant authorization;
  - the owner's approval to change the charter boundary "must not autonomously submit a grant application". The boundary is amended to allow submission only after an AOR approval for each application, never without it.
- **Until those are met**, the package-export path (§6.8) is the delivered "apply" experience.

## 9. Architecture

- **Server (`artifacts/api-server`):**
  - new modules `grants/registry` (ported Veteran-Hub domain), `grants/connectors/grantsgov`, `grants/matching`, `grants/applications` and `grants/budget`;
  - typed routes under `/api/grants/*` with the existing auth, rate limits, validation and idempotency;
  - the scheduler job `grants-ingest`.
- **Database (`lib/db`)**, with migrations and the existing destructive-test guards. New tables:
  - `applicant_orgs`, `applicant_readiness_items`;
  - `opportunity_sources`, `opportunities`, `opportunity_evidence`, `opportunity_claims`;
  - `matches`;
  - `applications`, `application_requirements` (the compliance matrix), `application_approvals`;
  - `budgets`, `budget_lines`;
  - `deadlines`.
  - Application sections reuse `documents` and `document_sections`.
- **UI (`artifacts/content-os`):**
  - `/grants` becomes **Discover** (live, matched and curated tabs);
  - new **Applicant profile**, **Application workspace** (matrix, sections, budget, review, package) and **Deadlines** screens;
  - all screens use the existing design system and accessibility gate.
- **API contract.** OpenAPI in `lib/api-spec`, with clients and schemas generated by `orval`, as today.

## 10. Phased roadmap

Each phase is one focused PR with tests and evidence, and a definition of done that uses the `AGENTS.md` verification matrix. Production promotion follows the existing gates.

| Phase | Delivers | Done when |
|---|---|---|
| **0. Decide** | This plan accepted; §11 decisions recorded; charter and GO/NO-GO amended | Owner approval recorded in `GO_NO_GO_DECISION.md` |
| **1. Registry foundation** | Veteran-Hub domain ported, with provenance, freshness, publication gate and import tests passing here. The 21 curated records migrate into the registry with no visible change to `/grants` | Unit tests ported and passing; `/grants` browser tests unchanged and passing |
| **2. Live federal discovery** | Grants.gov connector, daily ingest, on-demand detail, and evidence per record. SBIR/STTR and SAM.gov endpoints confirmed or recorded as blocked | Synthetic-fixture contract tests; one recorded live sample; publication gate blocks incomplete records; no paid service |
| **3. Profiles and matching** | Applicant profile, readiness items and score, hard filters, explained fit score, "Available for you", and human eligibility confirmation, for nonprofits and businesses | Matching tests for codes 12, 13, 22 and 23; explanation for every exclusion; accessibility passes |
| **4. Writing studio** | Matrix extraction and confirmation, grant blueprints, grounded drafting, limits, budget builder, reviewer scoring, approvals, package export | One complete synthetic federal application, with every matrix row covered and every limit met, exported and reopened |
| **5. Pilots and state** | HRI Foundation (nonprofit) and one pilot business run end to end in agency-managed mode; first state source; deadline calendar and in-app alerts | Pilot evidence recorded with consent; no cross-organization data; owner acceptance |
| **6. Accounts and assisted submission** (gated) | Organization accounts and roles; then Grants.gov S2S after the §8 pre-conditions | Cross-tenant rejection tests; legal review on file; S2S conformance in the Grants.gov training environment; AOR approval for each submission |

## 11. Owner decisions

| # | Decision | Recommendation | Label |
|---|---|---|---|
| D1 | Bring grant discovery, matching, writing and package export into scope for nonprofits **and businesses**, amending the charter and the `AGENTS.md` gating sentence | Approve | ADOPT |
| D2 | Port Veteran-Hub's domain layer, with its tests, as the registry foundation | Approve | ADOPT |
| D3 | HRI Foundation as the first pilot nonprofit; name one pilot business | Approve, after the 501(c)(3) wording is reconciled | PILOT |
| D4 | First state for Phase 5 | North Carolina | PILOT |
| D5 | Organization accounts and roles (a security-boundary change) | Approve as Phase 6; agency-managed mode until then | DEFER (to Phase 6) |
| D6 | Assisted Grants.gov S2S submission | Approve the pre-conditions in §8, including the legal review | DEFER (gated) |
| D7 | Outbound email digests | Approve after Phase 3, opt-in only | DEFER |
| D8 | Paid foundation database licence (for example Candid) | Not now | DEFER |

Each decision's evidence and risk are in the sections above. The owner reviews all of them on the review date at the top of this plan.

## 12. Risks and controls

- **Wrong eligibility or deadlines.** Prevented by the primary-source links, the publication gate, freshness marks and human confirmation before applying. The platform never guarantees eligibility.
- **AI fabrication in narratives.** Prevented by the citation and claim checks, the rule that no statistic appears without a source, labelled demo output, and reviewer approval of each section.
- **Data exposure across organizations.** Handled by the organization key from day one, cross-tenant tests in Phase 6, and no shared-model training.
- **Source terms.** Only official APIs and permitted pages are used. Each connector's terms are recorded in its source record. There is no scraping where terms forbid it.
- **Cost.** Federal APIs are free, and there is no new paid service without approval. AI cost is metered by the existing generation runs, and each phase reports its AI spend.
- **Scope creep.** One phase per PR. Each phase has its own definition of done and evidence, and nothing is marked complete without traceable evidence (`PROJECT_COMPLETION_STANDARD.md`).

## 13. Success measures (reviewed per pilot)

- Hours from "match found" to "package exported", against the applicant's previous process.
- Matrix coverage at export: target 100%.
- Limit violations at export: target 0.
- Unsupported-claim flags left open at export: target 0.
- Applications submitted and awards won, reported by the applicant.
- Share of matches the applicant confirmed as eligible: a measure of matching precision.
