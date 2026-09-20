# Technical Build Document

_All statements below are taken from files in this repository. File paths are given so every claim can be checked._

## 1. Repository shape

pnpm workspace (`pnpm-workspace.yaml`), packages resolved from `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`.

| Path | Package name | Role | Files / lines (tracked) |
|---|---|---|---|
| `artifacts/api-server` | `@workspace/api-server` | Express 5 REST API, AI pipeline, exporters, schedulers | 106 / 14,265 |
| `artifacts/content-os` | `@workspace/content-os` | React SPA — the production frontend | 93 / 11,836 |
| `artifacts/mockup-sandbox` | mockup sandbox | Design/component preview app, not part of the product runtime | 71 / 7,862 |
| `lib/db` | `@workspace/db` | Drizzle schema, migrations, pool, migration runner, test-DB guard | 43 / 4,800 |
| `lib/api-spec` | `@workspace/api-spec` | OpenAPI 3 contract (`openapi.yaml`, 4,244 lines, ~80 paths) + Orval config | 3 / 4,327 |
| `lib/api-zod` | `@workspace/api-zod` | Generated Zod request/response schemas (~105 type modules) | 105 / 4,993 |
| `lib/api-client-react` | `@workspace/api-client-react` | Generated TanStack Query hooks + `custom-fetch` | 6 / 9,734 |
| `src` (repo root) | — | Legacy/alternate frontend tree, **outside** the pnpm workspace | 30 / 2,663 |
| `tests` | — | `integration-tests.sh` (500 lines, black-box HTTP suite) | 1 / 500 |
| `docs` | — | Governance, decisions, audits, recovery evidence | 17 / 3,228 |

Total tracked TypeScript excluding generated code: ~36.8k lines; generated code: ~14.3k lines. 25 test files.

`RECOVERY_PROVENANCE.md` records that three frontend trees exist (`artifacts/content-os`, root `src`, `artifacts/mockup-sandbox`) and that `artifacts/content-os` is the intended production frontend. Consolidation is still an open decision.

## 2. Runtime stack

**Toolchain:** Node.js 24 (`.replit` `modules = ["nodejs-24", ...]`, CI pins `24.15.0`), pnpm 11.16.0, TypeScript 5.9 (`tsconfig.base.json`, project references via `tsc --build`).

**Backend** (`artifacts/api-server/package.json`):
- Express 5.2, `cors`, `cookie-parser`, `express-session` + `connect-pg-simple` (Postgres-backed sessions, table `session`, `createTableIfMissing: true`, 7-day cookie, `httpOnly`, `secure` in production, `sameSite: lax`).
- `express-rate-limit` 8.6 with a Postgres store (`src/lib/pgRateLimitStore.ts`).
- `pino` / `pino-http` structured logging (`LOG_LEVEL`).
- `drizzle-orm` 0.45 over `pg`.
- `docx` 9.7 and `pdfkit` 0.19 for binary exports; `pdf-parse` for ingesting uploaded PDFs; `multer` for uploads.
- `@google-cloud/storage` + `google-auth-library` for object storage.
- `undici` for outbound HTTP (AI providers, publishing, webhooks).

**Frontend** (`artifacts/content-os/package.json`, `vite.config.ts`):
- React 19.1, Vite 7, Tailwind CSS 4 (`@tailwindcss/vite`), Radix UI primitives + shadcn-style components in `src/components/ui` (~60 components), `lucide-react`, `recharts`, `framer-motion`, `sonner`.
- Routing: **wouter** (`src/App.tsx`), base-path aware via `import.meta.env.BASE_URL`.
- Server state: TanStack Query v5 through the generated hooks in `@workspace/api-client-react`; direct helpers in `src/lib/api.ts` send `credentials: 'include'` and redirect to `/login` on 401.
- Tests: Vitest + Testing Library + jsdom.

**Contract-first codegen:** `lib/api-spec/openapi.yaml` → Orval (`orval.config.ts`) → `lib/api-zod` (validation used by the server) and `lib/api-client-react` (hooks used by the SPA). Regenerate with `pnpm --filter @workspace/api-spec run codegen`.

## 3. Data layer

PostgreSQL 16 (`.replit` `postgresql-16`; CI uses `postgres:16-alpine`). Drizzle ORM, schema split across `lib/db/src/schema/*.ts`.

**39 tables**, grouped:

- Identity/session: `users`, plus the `session` table created by `connect-pg-simple`.
- Brand Brain: `brands`, `audience_profiles`, `brand_facts`, `brand_knowledge_entries`.
- Work: `projects`, `content_blueprints`, `dependency_registry`.
- Research/evidence: `research_plans`, `research_questions`, `sources`, `claims`.
- Structure/content: `outlines`, `outline_sections`, `documents`, `document_sections`, `section_revisions`.
- Quality: `quality_evaluations`, `quality_issues`.
- Output: `exports`.
- Repurposing: `repurposing_batches`, `repurposed_assets`, `repurposed_asset_revisions`, `repurposing_presets`.
- Publishing: `publishing_destinations`, `scheduled_publications`, `publication_attempts`.
- Performance: `performance_snapshots`, `performance_recommendations`.
- Automation: `api_keys`, `webhook_events`, `webhook_subscriptions`, `webhook_deliveries`, `webhook_delivery_attempts`, `idempotency_keys`.
- Ops/audit: `generation_runs`, `activity_log`, `provider_configs`, `model_config`, plus a rate-limit table (migration `0008_add_rate_limit_table.sql`).

**Migrations:** 15 SQL files in `lib/db/drizzle/` (`0000_baseline` → `0014_add_automation`), applied by Drizzle's migrator. `runMigrations()` (`lib/db/src/migrate.ts`) runs at startup before `app.listen()`, so a fresh deployment self-bootstraps. Migration folder resolves from `MIGRATIONS_DIR` or from `dist/drizzle/` (copied by `build.mjs`).

**Tenancy model:** single-tenant-per-user-account isolation, enforced in application code, not via row-level security. Every owned record carries a `userId`; `artifacts/api-server/src/middleware/ownershipHelpers.ts` provides `get<Entity>Owned(id, userId, res)` helpers for 20+ entity types that return **404 (not 403)** on a miss to prevent ID enumeration, and the file states "Never trust client-supplied user IDs — always use `req.session.userId`."

**Test-database safety:** `lib/db/src/testDatabaseGuard.ts` refuses destructive test operations unless `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, the host is `localhost`/`127.0.0.1`/`postgres`, and the database name ends in `_test`. Importing `@workspace/db` throws when `DATABASE_URL` is unset — import `@workspace/db/test-database-guard` directly if you need the guard without the pool.

## 4. API surface

`artifacts/api-server/src/app.ts` mounts everything under `/api`. `routes/index.ts` shows the auth boundary explicitly:

- **Public:** `auth` (`/auth/login`, `/auth/logout`, `/auth/me`, `/auth/admin-unlock`), `health` (`/healthz`), `storage` (public objects + upload URL with an internal check), `automation` (`/automation/*`, API-key-or-session checked per route).
- **Everything below `router.use(requireAuth)`:** `dashboard`, `brands`, `brand-brain`, `projects`, `research`, `sources`, `claims`, `outlines`, `documents`, `repurposing`, `quality`, `exports`, `providers`, `blueprints`, `dependencies`, `orchestration`, `publishing`, `performance`, `api-keys`, `webhooks`.
- `POST /api/seed` is guarded by `requireAdmin` (authenticated **and** admin-unlocked).

**CORS** reflects only known origins: the `REPLIT_DEV_DOMAIN`, each host in `REPLIT_DOMAINS`, and localhost — with `credentials: true`. `app.set("trust proxy", 1)`.

**Rate limiting:** login and admin-unlock are limited to 5 attempts per 15 minutes (`routes/auth.ts`), backed by the Postgres store so limits survive restarts.

**Automation/webhooks** (`docs/automation-api.md`): bearer keys prefixed `cmk_live_`, stored only as a one-way hash, shown once, scoped (`read`, `projects:write`, `repurposing:write`, `publishing:write`); idempotency keys on write actions; outbound webhooks are signed (`lib/webhooks/signing.ts`) with SSRF protection on subscriber URLs (`lib/webhooks/urlSafety.ts`) and retried by a delivery scheduler.

## 5. AI layer

`artifacts/api-server/src/lib/ai/`:
- Providers: `openai-provider.ts`, `anthropic-provider.ts`, `gemini-provider.ts`, `demo.ts`.
- `router.ts` reads a singleton row from `model_config` that maps each **pipeline stage** — planning, research, outline, writing, editing, verification, evaluation, utility — to a model, infers the provider from the model prefix (`gpt-`/`o1`/`o3` → OpenAI, `claude-` → Anthropic, `gemini-` → Google), falls back to the first configured real provider, and finally to the deterministic `demo` provider so the app runs with no API keys at all.
- Workflows in `lib/workflows/`: `content-workflow.ts` (research plan, outline, section drafting, six edit types, quality evaluation, claim verification), `repurposing-workflow.ts`, `publishing-workflow.ts`.

## 6. Background work

Started in `src/index.ts` after `app.listen()`, all as in-process guarded `setInterval` loops (no separate worker or queue process):
- `startPublishingScheduler()` — dispatches due scheduled publications.
- `startPerformanceScheduler()` — 5-minute tick, ingests metrics for due destinations.
- `startWebhookScheduler()` — retries pending webhook deliveries.

Consequence: **the API process is stateful for jobs.** Running more than one instance without coordination would double-fire schedulers.

## 7. Files and storage

- **Source PDFs** go to Google Cloud Storage through the Replit object-storage sidecar at `http://127.0.0.1:1106` using external-account credentials (`lib/objectStorage.ts`). ACLs are enforced in `lib/objectAcl.ts`. Off Replit this sidecar does not exist and the storage client must be reconfigured with ordinary GCS credentials.
- **Exports** are written to the local filesystem at `process.cwd()/data/exports` (`lib/exporters/index.ts`) and recorded in the `exports` table. This is **local disk, not object storage** — see the Incident & Recovery guide.

## 8. Build and run

```bash
pnpm install --frozen-lockfile
pnpm run typecheck                                   # tsc --build + per-package typecheck
pnpm --filter @workspace/api-server test             # vitest
pnpm --filter @workspace/content-os test             # vitest
pnpm --filter @workspace/api-server build            # esbuild → dist/index.mjs (+ dist/drizzle)
pnpm --filter @workspace/api-server start            # node --enable-source-maps dist/index.mjs
pnpm --filter @workspace/content-os build            # vite → dist/public
pnpm run build                                       # typecheck + recursive build
pnpm --filter @workspace/api-spec run codegen        # regenerate Zod + React hooks
pnpm --filter @workspace/db run push                 # dev-only schema push
```

`preinstall` runs `scripts/enforce-pnpm.mjs`, which deletes non-pnpm lockfiles and rejects other package managers.

The API bundle is ESM produced by esbuild (`artifacts/api-server/build.mjs`) with a CJS-interop banner; `docx`, `pdfkit`, `pdf-parse`, `fontkit` and all `@google-cloud/*` packages are externalised, so `node_modules` must be present at runtime. The build copies `lib/db/drizzle/` into `dist/drizzle/`.

## 9. Environment variables

Complete set found by scanning `process.env.*` across the repo, cross-checked against `artifacts/api-server/.env.example`:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string; `@workspace/db` throws at import if unset |
| `SESSION_SECRET` | yes | Session cookie signing; `app.ts` throws at startup if unset |
| `PORT` | yes | API listen port; `index.ts` throws if unset/invalid. Frontend dev/preview also reads it |
| `NODE_ENV` | effectively | Controls secure cookies, Vite plugins, test guards |
| `ADMIN_PASSWORD` | optional | Enables `POST /api/auth/admin-unlock`; when unset, admin-only global routes stay locked for everyone |
| `OPENAI_API_KEY` | optional | OpenAI provider |
| `ANTHROPIC_API_KEY` | optional | Anthropic provider |
| `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` | optional | Google provider |
| `TYPEFULLY_API_KEY` | optional | Social publishing adapter |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` | required for uploads | Object storage bucket and path config |
| `LOG_LEVEL` | optional | pino level |
| `MIGRATIONS_DIR` | optional | Override migration folder |
| `BASE_PATH` | optional | Frontend base path for sub-path hosting |
| `ALLOW_TEST_DATABASE_RESET` | test only | Must be `true` for destructive test DB operations |
| `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`, `REPL_ID` | platform-injected | CORS allowlist and dev-only Vite plugins |

If none of the AI keys are set, generation still works via the `demo` provider — useful for evaluation, useless for real output.

## 10. Deployment

**As configured in the repo (Replit):** `.replit` sets `deploymentTarget = "autoscale"`, `router = "application"`. Two artifacts:
- `artifacts/api-server/.replit-artifact/artifact.toml` — kind `api`, local port 8080, paths `/api`, production run `node --enable-source-maps artifacts/api-server/dist/index.mjs`, startup health check `GET /api/healthz`.
- `artifacts/content-os/.replit-artifact/artifact.toml` — kind `web`, static serve of `artifacts/content-os/dist/public`, SPA rewrite `/* → /index.html`, `BASE_PATH=/`, local port 19454.

**Important governance caveat:** `AGENTS.md` and `docs/GO_NO_GO_DECISION.md` record Replit as **NO-GO** as the development/deployment target — it is retained as recovery/reference evidence only. The Replit config is therefore historical. No alternative host (Dockerfile, `fly.toml`, `vercel.json`, `render.yaml`, Kubernetes manifests) exists in the repository, and `docs/PROJECT_STATUS.md` states production deployment is **NOT YET VERIFIED**.

**What a real deployment needs** (derived from the code, not yet implemented here): a Node 24 process running `dist/index.mjs` with `node_modules` present; a managed Postgres 16; a persistent writable volume for `data/exports`; GCS credentials that do not depend on the Replit sidecar; static hosting or a reverse proxy serving `dist/public` on the same origin as `/api` (the SPA calls same-origin relative paths and the CORS allowlist only covers Replit/localhost origins); exactly one API instance unless the schedulers are reworked.

## 11. CI

`.github/workflows/recovery-baseline-validation.yml` — triggers on PRs targeting `recovery/replit-content-machine-source` and on `workflow_dispatch`. Steps: `postgres:16-alpine` service, pnpm 11.16.0 + Node 24.15.0, `pnpm install --frozen-lockfile`, `pnpm run typecheck`, API tests, Content OS tests, isolated DB prepare, API build, start the API and poll `/api/healthz` (30 attempts), `bash tests/integration-tests.sh`, stop the API, `pnpm run build`.

**Gap:** this workflow does not run on PRs targeting `main`. There is currently no `main`-branch CI gate, and no lint step (no ESLint config exists; only `prettier` is installed at the root).

## 12. Known technical debt (from repo evidence)

1. Three frontend trees; only one is canonical (`RECOVERY_PROVENANCE.md`).
2. Exports on local disk rather than object storage, which conflicts with autoscale/multi-instance hosting.
3. In-process schedulers block horizontal scaling.
4. CORS allowlist and object storage are hard-coded to Replit-specific assumptions.
5. CI only gates a recovery branch.
6. `docs/content-os-audit.md` is stale in places — it states there is no auth, session or rate limiting, all of which now exist.
7. `replit.md` is still partly an unfilled template ("[Project name]", "_Populate as you build_").
