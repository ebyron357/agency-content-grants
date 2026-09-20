# Market Valuation

## Evidence status — read first

**No commercial data exists in this repository.** There are no customers, no revenue, no contracts, no analytics, no pricing model, and — confirmed by inspection — **no billing or subscription code of any kind** (no payment SDK, no plan/seat/invoice tables). `AGENTS.md` forbids inventing customer facts, costs or approvals.

So this page values **an asset, not a business**: a tested, contract-first codebase with zero traction. Everything below is a reasoned estimate with its basis stated. Any figure presented as a market price is an *asking-range suggestion*, not an appraisal.

Two repo facts frame the whole valuation:
- `docs/PROJECT_STATUS.md`: "Production deployment: **NOT YET VERIFIED**" and the project is in "**ACTIVE PRODUCT CLOSEOUT**", with rich editor, image handling and video embedding listed as outstanding.
- `docs/content-os-audit.md` (1 Aug 2026): the backend is "reusable as-is"; the product "behaves as a workflow administration console for a content engineering team, not as a writing product for an editorial user."

**The engine is strong. The product is unfinished. The business does not exist yet.** A buyer is buying engineering, not cash flow.

## 1. What is actually being sold

Measured from the repository:

| Asset | Substance |
|---|---|
| Backend | ~14.3k lines; Express 5; 20 mounted routers; ~80 OpenAPI paths; session auth, Postgres-backed rate limiting, per-entity ownership checks returning 404 to block enumeration |
| Data model | 39 tables, 15 forward migrations, revision history on documents and repurposed assets |
| AI layer | 3 real provider adapters (OpenAI, Anthropic, Google) + deterministic demo fallback, with **per-pipeline-stage model routing** stored in the database |
| Evidence layer | `sources`, `claims`, claim verification, `quality_evaluations`/`quality_issues` — the genuinely differentiated part |
| Output | Real binary DOCX and PDF generation, plus HTML/Markdown/text |
| Distribution | Repurposing with presets and revisions; publishing destinations, scheduling, attempt history; a Typefully adapter that fails loudly rather than guessing |
| Measurement | Performance snapshots, aggregation, recommendations reconciled against content |
| Integration | Scoped bearer API keys (`cmk_live_…`, hashed, shown once), idempotency keys, signed webhooks with retries and SSRF screening, documented in `docs/automation-api.md` |
| Frontend | ~11.8k lines; React 19 + Vite 7 + Tailwind 4 + Radix; ~60 UI primitives; 10 routes |
| Contract | 4,244-line OpenAPI spec driving generated Zod schemas and TanStack Query hooks — frontend and backend cannot silently drift |
| Quality evidence | 25 test files; recorded 249 API + 10 frontend tests passing; CI with a real Postgres service and a black-box integration suite |
| Governance | An unusually rigorous documented decision trail: `AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, ADRs in `docs/decisions/`, `RECOVERY_PROVENANCE.md` |

## 2. Comparable products

Comparison is on capability overlap, not price — pricing for these is public and changes, and none of it is in this repo.

| Category | Comparables | Overlap with this codebase | Where this differs |
|---|---|---|---|
| AI long-form writing SaaS | Jasper, Copy.ai, Writesonic | Brand voice, long-form drafting, templates | None of them make **sources, claims and claim verification** first-class database records |
| SEO content platforms | Surfer SEO, Frase, MarketMuse, Clearscope | Research → outline → draft pipeline | This has no SERP/keyword data integration at all — a clear gap vs. these |
| Agency content ops | ContentCal/Adobe, CoSchedule, GatherContent (Bynder) | Multi-brand workspaces, workflow stages, approvals | This adds AI generation plus evidence trails; it lacks client-facing review/approval portals |
| Social scheduling | Buffer, Hootsuite, Postiz (OSS), Typefully | Scheduling, destinations, post analytics | This *delegates* to Typefully rather than building OAuth per network — cheaper to maintain, weaker as a moat |
| Open-source adjacent | Postiz, Dify, AnythingLLM | Self-hostable, provider-agnostic AI | This is a vertical editorial product, not a generic LLM toolkit |
| Repurposing tools | Repurpose.io, Munch, OpusClip | One long asset → many channel assets | This keeps repurposed assets linked to the source document and its evidence |

**Honest positioning:** the nearest thing to a category match is "Surfer/Frase's research-to-draft pipeline, with GatherContent's multi-brand workflow, wired to Buffer-style distribution, self-hosted." Nothing in that list treats citation-backed evidence as the core data model. That is the one genuinely defensible idea in here.

## 3. Valuation method

Standard revenue multiples are inapplicable — revenue is zero and there is no billing code. Two defensible methods remain:

**(a) Cost-to-duplicate.** From the Cost Breakdown: rebuilding a functional equivalent is ~8–12 senior-developer months; equivalent *plus* the unfinished closeout scope is ~11–16 months. A rational acquirer discounts replacement cost for unfinished scope and integration risk — typically paying **40–70% of replacement cost** for a pre-revenue codebase with no users.

**(b) Micro-acquisition comparables.** On marketplaces where pre-revenue SaaS codebases change hands, sale prices cluster far below replacement cost. Zero MRR is the dominant discount factor; "well-tested, documented, modern stack" moves the price within the band but does not escape it.

## 4. Suggested asking range

| Scenario | Condition | Suggested asking range (USD) | Reasoning |
|---|---|---|---|
| **As-is, today** | Pre-revenue, no users, no verified production deployment, closeout incomplete | **$15,000 – $45,000** | Code-asset sale. Buyer inherits real engineering and real unfinished work. Anchored well below the ~$90k–$220k replacement cost because there is no traction and the buyer must finish the editor, media handling and deployment |
| **Closeout complete** | Rich editor, image/video, verified production deploy, all `docs/PROJECT_STATUS.md` gates green, live demo available | **$40,000 – $90,000** | A finished, demonstrable product removes the largest execution discount |
| **First revenue** | Billing implemented + 10–30 paying agency seats/accounts, a few months of retention data | **$90,000 – $250,000+** | Shifts to a multiple of ARR; at this point the codebase stops being the primary asset |
| **Non-sale alternative** | Owner operates it for their own agency | n/a | Infrastructure cost under ~$65/month (see Cost Breakdown) makes self-operation genuinely viable and may beat a low-ball sale |

These are **suggested asking ranges to open negotiation**, not appraised values. The realistic outcome depends far more on whether a live demo exists than on any line of code.

## 5. What a buyer or investor will care about

### Strengths that raise the price
1. **Evidence-first data model.** Sources → claims → verification → quality issues is a real differentiator in a market saturated with prompt wrappers, and it is the hardest thing on this list to copy quickly.
2. **Contract-first architecture.** One OpenAPI spec generating both Zod validation and typed React hooks means a new team can change the API without breaking the client silently. This materially lowers onboarding risk.
3. **Provider independence.** Per-stage model routing with three vendors and a demo fallback means no lock-in and a direct cost lever — a buyer can tune margin without a rewrite.
4. **Security work already done.** Ownership checks that return 404 instead of 403, hashed one-shot API keys, scoped tokens, idempotency, signed webhooks, SSRF screening, Postgres-backed rate limits, a destructive-operation guard on the test database. This is the kind of work that is invisible in a demo and expensive to retrofit.
5. **Verifiable quality.** 249 API tests, 10 frontend tests, a black-box integration suite, and CI that boots a real Postgres and health-checks a real server. A buyer can run it and see for themselves.
6. **Cheap to operate.** Single Node process plus one Postgres; infrastructure under roughly $65/month before AI tokens. Gross margin is a tuning decision, not a structural problem.
7. **Exceptional documentation and decision trail.** ADRs, a recorded go/no-go gate, provenance of the source recovery. Very unusual at this size and a genuine diligence accelerant.
8. **Integration surface already exists.** Documented automation API and webhooks mean it can slot into an agency's existing n8n/Zapier stack on day one.

### Weaknesses that lower the price — and that an honest seller must disclose
1. **No revenue, no users, and no way to charge.** There is no payment integration and no plan/seat/subscription schema. Monetisation is unbuilt, not just unproven.
2. **Not deployed.** `docs/PROJECT_STATUS.md` says production is NOT YET VERIFIED. There is no Dockerfile or cloud IaC in the repo. A buyer cannot see it running without doing work.
3. **UX is the known weak point.** The project's own audit calls it a workflow administration console rather than a writing product, and notes a user must cross four screens and eight tabs to reach a document.
4. **Unfinished approved scope.** Rich editor behaviour, image handling and video embedding are explicitly listed as outstanding closeout items.
5. **No team model.** Isolation is per user account; there is no organisation, team or role table. An agency with five staff sharing one client cannot do so today. This is a significant gap for the stated target buyer.
6. **Architectural ceilings.** In-process schedulers prevent running more than one instance; exports are written to local disk; object storage is hard-wired to the Replit sidecar; the CORS allowlist is hard-coded to Replit/localhost. All are fixable, all are real work.
7. **Three frontend trees** (`artifacts/content-os`, root `src`, `artifacts/mockup-sandbox`) still awaiting consolidation (`RECOVERY_PROVENANCE.md`).
8. **CI does not gate `main`** — the only workflow targets a recovery branch — and there is no linter configured.
9. **Bus factor of one**, plus a recovery history proving the original source once existed only on a hosting platform with no Git history.
10. **Third-party dependency on Typefully** for all social publishing, and an adapter the code itself notes has not been exercised against a live account in this environment.
11. **Commodity risk.** OpenAI, Anthropic and Google keep absorbing features like this into their own products. The evidence model is the defence; nothing else here is.

### Diligence questions a serious buyer will ask
- Can I see it running, with a real article produced end to end? (Today: not without deploying it yourself.)
- What does one article cost in tokens? (Not measured anywhere; no usage metering exists.)
- How do I bill customers? (You build it.)
- How do five people at one agency share a client? (They can't yet.)
- Who else has the source? (`RECOVERY_PROVENANCE.md` answers this honestly — a strong signal.)

## 6. The single highest-leverage action before any sale

Deploy it, publicly, with a working demo account and one end-to-end article produced in front of the buyer. Per the repo's own gates, that is also the remaining requirement for GO. Everything in §5's weakness list is smaller than this one item: a pre-revenue codebase that a buyer can *use* sells in a materially higher band than a pre-revenue codebase they have to take on trust.

Second-highest: implement teams/organisations. The stated customer is an agency, and agencies are multi-person by definition.
