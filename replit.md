# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Engineering governance (read before adding a dependency or building a new capability)

Full standard: [`docs/engineering-standards.md`](docs/engineering-standards.md). This is binding for all future Content Machine work, not just a suggestion.

- Define the real user problem before choosing build/integrate/buy.
- Check existing Content Machine capability, then shared portfolio capability, before writing anything new.
- Evaluate vetted open source for commodity infra (crawling, parsing, queues, webhooks, calendar UI, SERP data, LLM observability, workflow automation) and compare API/service options before defaulting to a custom build.
- Build custom only when nothing vetted fits, the capability is core differentiation (see below), or integrating would cost more than a narrow purpose-built version — and record that reasoning.
- Every candidate (OSS, API, or custom) is checked against: licensing, security, privacy, accessibility, maintenance burden, operating cost, vendor lock-in, replacement path. Popularity/star count is never treated as evidence of suitability.
- Content Machine's own domain model and UX are the owned product layer and are never replaced by importing an external app wholesale: brands/Brand Brain, projects, research/evidence relationships (sources/claims/provenance), content lifecycle, approvals, and content intelligence. External projects only power infrastructure underneath, wrapped in a replaceable adapter/service boundary — never the user-facing surface.
- Affordability (real usage-volume cost, not list price) and professional/educational access are architecture constraints, applied at every decision step, not a final check.
- Nothing is "done" until tests pass and real end-to-end behavior has been verified — not just typechecked or read.
- Current first-pass candidates for future evaluation (not adopted, not installed — see the full doc before touching any of these): MarkItDown (document ingestion), Crawl4AI or equivalent isolated crawler (web research), OpenSEO concepts (SEO intelligence), Postiz/BrightBean/TryPost patterns (social distribution + approvals), Langfuse (LLM observability/evaluation), n8n (external workflow automation).

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Reuse-first, access-first engineering standard is binding — see "Engineering governance" above and `docs/engineering-standards.md`. Applies to all future work, not just the change that introduced it.
- Affordability is a hard architecture constraint: "make these apps... affordable."
- Open source is evaluated on fitness, never on provenance or popularity: "open source is legit... I don't give a fuck where it's from."
- External projects/tools are integrated as infrastructure only, never as the user-facing product: "we dress it up with our UI, our dash, our look, our modernization."
- Reuse existing capability (this project's or the portfolio's) before building new: "we need to utilize it."

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
