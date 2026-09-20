# Cost Breakdown

## Evidence status — read first

**This repository contains no billing data.** There are no invoices, no pricing files, no usage telemetry, no cost ADR, and no vendor contracts committed anywhere in `ebyron357/agency-content-grants`. `AGENTS.md` forbids inventing costs.

Therefore this page does two things and clearly separates them:

- **§1–§3 — Verified:** the exact list of cost-bearing services the code *requires*, derived from `process.env` usage, SDK imports and deployment config. This is fact.
- **§4–§6 — Modelled:** an estimate of what running and rebuilding this would cost, with every assumption stated. Vendor unit prices are **not** quoted as fact here because they are not in the repo and change frequently — each line names the pricing page the owner must read to complete the figure.

Also material: `docs/PROJECT_STATUS.md` records **production deployment as NOT YET VERIFIED** and `docs/GO_NO_GO_DECISION.md` records Replit as **NO-GO** as a deployment target. So the truthful answer to "what is the current monthly running cost?" is:

> **Current verified production running cost: £0 / $0 — there is no verified production deployment.** The only certain ongoing costs today are the GitHub account and any AI API keys the owner is already using for development.

## 1. Cost-bearing services the code requires

| # | Service | Why the code needs it | Evidence | Mandatory? |
|---|---|---|---|---|
| 1 | Source control + CI | Canonical repo; one GitHub Actions workflow with a Postgres service container | `.github/workflows/recovery-baseline-validation.yml` | Yes |
| 2 | Node 24 application host | Runs `artifacts/api-server/dist/index.mjs`; must be a single long-lived instance because the publishing, performance and webhook schedulers are in-process | `artifacts/api-server/src/index.ts` | Yes |
| 3 | Static hosting / reverse proxy | Serves `artifacts/content-os/dist/public` with SPA rewrite, ideally same-origin with `/api` | `artifacts/content-os/.replit-artifact/artifact.toml` | Yes |
| 4 | PostgreSQL 16 | 39 tables + the session store + the rate-limit store | `lib/db/src/schema/*`, `connect-pg-simple` in `app.ts` | Yes |
| 5 | Persistent disk volume | `data/exports` holds generated DOCX/PDF on the local filesystem | `artifacts/api-server/src/lib/exporters/index.ts` | Yes, if exports must survive restarts |
| 6 | Object storage (GCS bucket) | PDF source uploads + ACLs | `src/lib/objectStorage.ts` | Only for the upload feature |
| 7 | OpenAI API | `gpt-*`/`o1`/`o3` generation | `src/lib/ai/openai-provider.ts` | At least one of 7/8/9 for real output |
| 8 | Anthropic API | `claude-*` generation | `src/lib/ai/anthropic-provider.ts` | ″ |
| 9 | Google Gemini API | `gemini-*` generation | `src/lib/ai/gemini-provider.ts` | ″ |
| 10 | Typefully | Social scheduling + post analytics | `src/lib/publishing/typefully-provider.ts` | Only for the publishing feature |
| 11 | Domain + TLS | Public access; also needed to fix the CORS/same-origin constraint | `src/app.ts` origin allowlist | Yes for production |
| 12 | ClickUp | Executive operating board | `AGENTS.md` | Process, not runtime |

## 2. Services the code does **not** require (no cost)

Confirmed absent from the codebase — do not budget for them unless you add them:

- No email/SMTP provider (no nodemailer usage; `nodemailer` appears only in esbuild's externals list).
- No payment processor — **no Stripe or billing integration exists.** There is no subscription, plan, seat or invoice table. The product cannot currently charge anyone.
- No analytics, error tracking (Sentry etc.), APM or log aggregation service.
- No search service, no Redis/queue service, no CDN configuration.
- No SMS, no auth-as-a-service (auth is local username/password in the `users` table).

## 3. Cost drivers that will dominate the bill

1. **AI tokens.** Every pipeline stage — planning, research, outline, writing, editing, verification, evaluation, utility — is a separate model call (`src/lib/ai/router.ts`), and long-form articles are drafted **section by section** (`draftSection` in `content-workflow.ts`), each with brand context. A single long article is therefore many calls, not one. Repurposing and quality evaluation add more. **This is the variable cost that matters; everything else is close to fixed.**
2. **Model choice per stage is configurable** (`model_config` singleton). Mapping writing to a frontier model and everything else to a cheap model is the primary cost lever the product already gives you. The Anthropic provider's in-code default is `claude-haiku-3-5` — a low-cost tier.
3. **Database size** grows with revision history: `section_revisions`, `repurposed_asset_revisions`, `publication_attempts`, `webhook_delivery_attempts`, `performance_snapshots` are all append-heavy.
4. **Storage** grows with uploaded source PDFs and generated exports.

## 4. Monthly running cost model (estimate — assumptions stated)

Assumptions: one small production instance, one small managed Postgres, one bucket, a single operator, **no verified current deployment** (so these are projected go-live costs, not observed bills). Ranges are order-of-magnitude bands for commodity cloud tiers, not vendor quotes — confirm each against the linked provider before committing.

| Line item | Tier assumed | Monthly band (USD, **unverified — confirm with vendor**) | Where to confirm |
|---|---|---|---|
| GitHub | Free tier for a single-owner private repo; Actions minutes within free allowance | $0 | github.com/pricing |
| App host (1 always-on small instance, ~1 vCPU / 1–2 GB) | Fly.io / Render / Railway / small VPS | $5 – $25 | chosen host's pricing page |
| Managed PostgreSQL 16 (small, with backups) | Neon / Supabase / RDS-equivalent small | $0 – $30 | chosen DB provider |
| Persistent volume for `data/exports` (10 GB) | Block storage | $1 – $3 | chosen host |
| Object storage bucket (GCS, low tens of GB) | Standard class + egress | $1 – $5 | cloud.google.com/storage/pricing |
| Domain + TLS | One domain, Let's Encrypt | ~$1 – $2 amortised | registrar |
| **Fixed infrastructure subtotal** | | **≈ $10 – $65** | |
| AI API usage — light (≈20 long articles/month) | Cheap models on non-writing stages | $10 – $60 | provider pricing pages |
| AI API usage — moderate (≈100 articles/month) | Mixed frontier writing + cheap stages | $75 – $400 | ″ |
| AI API usage — heavy (≈500 articles/month, frontier writing) | | $400 – $2,000+ | ″ |
| Typefully (only if publishing is used) | Paid plan with API access | Subscription, tens of $ | typefully.com/pricing |
| ClickUp (process tooling) | Existing account | likely already paid | clickup.com/pricing |

**Headline estimate:** roughly **$25–$125/month all-in at light usage**, dominated by AI tokens; infrastructure alone is genuinely cheap — under ~$65/month — because the architecture is a single Node process plus one Postgres. That matches the affordability constraint recorded in `replit.md` ("affordability is a hard architecture constraint").

**Costs deliberately excluded because nothing in the repo supports them:** monitoring/alerting, error tracking, log retention, staging environment, backups beyond the provider default, security scanning tooling, and any human operations time.

## 5. Cost to rebuild from scratch (estimate)

Basis — measured from the repository, not guessed:

- ~36,800 lines of hand-written TypeScript (excluding ~14,300 lines of generated client/schema code).
- 39 database tables, 15 migrations.
- 20 mounted Express routers, ~80 OpenAPI paths in a 4,244-line spec.
- 3 AI provider adapters + a stage-aware routing layer + a deterministic demo provider.
- 5 export formats, two of them real binary generators (DOCX via `docx`, PDF via `pdfkit`).
- A full automation subsystem: scoped API keys, idempotency, signed webhooks with retries and SSRF screening.
- A publishing subsystem with destinations, scheduling, attempts and a provider adapter.
- A performance subsystem with ingestion, aggregation and recommendations.
- ~60 UI primitives plus 10+ application pages, contract-first codegen wiring frontend to backend.
- 25 test files; recorded evidence of 249 API tests and 10 frontend tests passing.

| Rebuild scenario | Scope | Effort estimate | Cost band (**estimate; depends entirely on rate**) |
|---|---|---|---|
| **A. Thin clone** — auth, brands, projects, one AI provider, draft + DOCX export, no repurposing/publishing/performance/automation | ~25–30% of current surface | ~2–3 senior-developer months | 2–3 × monthly blended cost of one senior engineer |
| **B. Functional equivalent** — everything currently in `main`, same test depth, same evidence discipline | 100% of current surface | ~8–12 senior-developer months | 8–12 × monthly blended cost of one senior engineer |
| **C. Equivalent + the closeout gaps finished** — B plus rich editor, image/video handling, verified production deployment (the outstanding items in `docs/PROJECT_STATUS.md`) | 100% + remaining scope | ~11–16 senior-developer months | 11–16 × monthly blended cost |

At commonly used blended contract rates this puts scenario B somewhere in the **$90k–$220k** range and scenario C **$120k–$300k**, but that number is entirely a function of the rate you assume — the defensible, repo-derived figure is the **effort**, not the currency amount. Rates are not in the repository and are not asserted here as fact.

Two factors *reduce* rebuild effort relative to the line count: the contract-first OpenAPI/Orval setup generates ~14k lines automatically, and the ~60 Radix/shadcn UI primitives are standard scaffolding rather than bespoke work. Two factors *increase* it: the evidence/claim-verification model and the webhook/automation hardening (signing, SSRF screening, idempotency, retry accounting) are the kind of work that is slow to get right and easy to get subtly wrong.

## 6. What the owner must do to turn this page into fact

1. Choose and provision the production host and database, then record the actual plan names and prices here.
2. Pull one month of real OpenAI/Anthropic/Google usage from the provider dashboards and replace §4's AI band with observed spend.
3. Record the Typefully plan, if publishing is in scope.
4. Add spend caps/alerts on every AI account — there is currently no in-app usage metering or budget guard anywhere in the code.
5. Decide whether monitoring, error tracking and a staging environment are in scope, and budget them explicitly; today they cost $0 because they do not exist.
