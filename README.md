# Content Machine (Content OS)

An evidence-first, multi-tenant platform for agency long-form content production: project/document authoring, a rich (TipTap-based) editor with image and video embedding, AI-assisted drafting and repurposing, and multi-format export (TXT, Markdown, DOCX, PDF, HTML).

Grant/proposal-intelligence features referenced in early planning documents are **not implemented** and are out of scope for the current closeout. Only the Content Machine / Content OS product described here is active.

## Current release state

**Active product closeout — not yet promoted to production.**

- Recovery and baseline stabilization: complete (`main`).
- Product closeout implementation (rich editor, media, exports): in progress on the canonical closeout branch — see `docs/GO_NO_GO_DECISION.md` and `docs/PROJECT_STATUS.md` for the authoritative, up-to-date status and evidence.
- Production deployment: **not verified**. Object/media storage is currently coupled to the Replit App Storage sidecar and is not yet portable to an arbitrary production host (see "Known gaps" below).

`docs/GO_NO_GO_DECISION.md` is the controlling authorization record; `AGENTS.md` defines the working rules for anyone (human or agent) changing this repository. Historical Stage 0 planning documents (`docs/PROGRAM_CHARTER.md`, `docs/STAGE_0_EXECUTION_PLAN.md`, `docs/REPOSITORY_BASELINE.md`, `docs/recovery/`) describe an earlier, superseded phase of the project and are kept as historical evidence only — they do not describe the current architecture or scope.

## Architecture

pnpm workspace, TypeScript throughout:

| Path | What it is |
|---|---|
| `artifacts/content-os` | Production frontend — React 19 + Vite + Tailwind CSS v4, Radix UI primitives, TanStack Query, `wouter` routing, TipTap rich editor. |
| `artifacts/api-server` | Express 5 API — auth/session, project & document CRUD, media upload, AI provider integration, export generation. |
| `lib/db` | Drizzle ORM schema and migrations against PostgreSQL 16. |
| `lib/api-client-react`, `lib/api-zod` | Generated/shared API client and request/response schemas consumed by both the frontend and backend. |
| `artifacts/mockup-sandbox` | Standalone design/mockup sandbox, not part of the production app. |
| `tests/integration-tests.sh` | Black-box integration suite that runs against a live API instance. |

The API server serves the built frontend same-origin in production (`FRONTEND_DIST_PATH`).

## Running locally

Requires Node `24.15.0`, pnpm `11.16.0` (see `.replit` / `package.json#packageManager`), and a PostgreSQL 16 instance.

```bash
corepack enable
pnpm install --frozen-lockfile

# Point at your Postgres instance, then:
cp .env.example .env
cp artifacts/api-server/.env.example artifacts/api-server/.env
# fill in DATABASE_URL, SESSION_SECRET, and at least one AI provider key

pnpm --filter @workspace/db push          # apply schema
pnpm --filter @workspace/api-server dev   # builds + starts the API on :8080
pnpm --filter @workspace/content-os dev   # Vite dev server, proxies /api to :8080
```

### Required environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `SESSION_SECRET` | yes | Express session signing secret; the server refuses to start without it in production. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | at least one | AI-assisted generation/repurposing features. |
| `ADMIN_PASSWORD` | optional | Unlocks admin-only mutations (model config, dependency registry, provider tests). Those routes stay locked if unset. |
| `ALLOWED_ORIGINS` | optional | Comma-separated CORS allowlist beyond localhost. |
| `PORT` | optional | API port, default `8080`. |
| `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | required for media uploads | Object storage configuration — see "Known gaps". |

See `.env.example` and `artifacts/api-server/.env.example` for the full list.

## Testing

```bash
pnpm run typecheck                                   # whole workspace
pnpm --filter @workspace/api-server test:unit         # hermetic unit tests, no DB
pnpm --filter @workspace/api-server test:db:prepare   # applies migrations to a disposable test DB
pnpm --filter @workspace/api-server test              # full DB-backed API test suite
pnpm --filter @workspace/content-os test              # frontend unit tests
bash tests/integration-tests.sh                       # black-box integration tests against a running API
pnpm run build                                        # production build (also runs typecheck)
```

`.github/workflows/ci.yml` runs this full sequence (plus a Postgres 16 service container) on every pull request targeting `main`; `.github/workflows/recovery-baseline-validation.yml` is a historical/non-canonical workflow scoped to the recovery branch only.

## Known gaps before production promotion

- **Durable media storage**: `artifacts/api-server/src/lib/objectStorage.ts` currently authenticates against the Google Cloud Storage API through the Replit sidecar token exchange (`http://127.0.0.1:1106`), which only exists inside the Replit environment. Deploying elsewhere requires an equivalent object-storage credential path.
- **Browser end-to-end tests**: current automated coverage is unit/API/integration (curl-level); there is no Playwright (or equivalent) browser E2E suite yet.
- **Accessibility audit**: not yet run against the current UI.
- **Production deployment**: not yet performed or verified against any target.

These are tracked as open release gaps, not silently assumed complete.
