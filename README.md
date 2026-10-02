# Content Machine (Content OS)

An evidence-first workspace for long-form content. A user describes what they want to write; Content Machine builds a brief, research plan, sources and claims ledger, outline and draft, then supports editing, quality review, repurposing, distribution and export. Output types: blog posts, articles, guides, manuals, SOPs, reports, white papers, e-books and newsletters.

Delivered capabilities:

- Guided workflow: brief → research plan → sources (URL and PDF) → claims → outline → AI drafting → quality evaluation → repurposing → export.
- TipTap rich editor with headings, lists, links, section lock/approve, AI re-draft and targeted edits, image upload (alt text required) and YouTube/Vimeo embeds.
- Export to DOCX, PDF, HTML, Markdown and TXT with an evidence register of sources and claims.
- Brands with voice, audiences, facts and knowledge; distribution scheduling (simulated demo provider, Typefully); performance from provider-reported metrics only.
- Automation API with scoped keys and signed webhooks (`docs/automation-api.md`).
- One dark command-center design system across every screen (`docs/DESIGN_SYSTEM.md`), accessibility-gated in CI.

Grant/proposal intelligence from early planning is **not implemented** and remains deferred by owner decision.

## Status

**Release candidate verified complete; production not yet deployed.** All repository, CI, browser, accessibility, security and production-mode rehearsal gates pass. The single remaining step is owner-only: creating the Render environment from `render.yaml` (paid resources and owner-held secrets). The authoritative record, with evidence and the exact owner action, is [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md); the decision is [`docs/GO_NO_GO_DECISION.md`](docs/GO_NO_GO_DECISION.md).

- Production URL: not provisioned (expected `https://agency-content-grants.onrender.com` once created; sign-in at `/`).
- Access model: one workspace account protected by the `ADMIN_PASSWORD` secret; no self-registration ([`docs/SECURITY_AND_ACCESS_HANDOFF.md`](docs/SECURITY_AND_ACCESS_HANDOFF.md)).

## Architecture

pnpm workspace, TypeScript, Node 24.

| Path | Role |
|---|---|
| `artifacts/content-os` | Frontend: React 19, Vite 7, Tailwind v4, Radix UI, TanStack Query, wouter, TipTap. Playwright + axe accessibility gate in `e2e/` |
| `artifacts/api-server` | Express 5 API: sessions, ownership-scoped CRUD, media and source upload, AI providers, exports, publishing, automation, `/api/healthz` (liveness + running commit) and `/api/readyz` (database, migrations, writable storage, production config). Serves the built frontend same-origin. Applies migrations at startup |
| `lib/db` | Drizzle schema and SQL migrations (PostgreSQL 16) |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | OpenAPI spec and generated schemas/client (`pnpm --filter @workspace/api-spec run codegen`) |
| `artifacts/mockup-sandbox` | Design sandbox, not shipped |
| `tests/integration-tests.sh` | Black-box API integration suite |
| `tests/production-smoke.sh` | Self-cleaning smoke test for a deployed environment |

## Run locally

Node 24.15.0, pnpm 11.16.0, PostgreSQL 16.

```bash
pnpm install --frozen-lockfile
cp .env.example .env            # set DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD, PORT
pnpm --filter @workspace/db push
pnpm --filter @workspace/api-server dev      # API on :8080
pnpm --filter @workspace/content-os dev      # Vite dev server, proxies /api
```

Without an AI provider key, generation returns clearly labelled demo output.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | yes | Session signing secret; the server refuses to start without it |
| `ADMIN_PASSWORD` | yes | Workspace sign-in password and admin elevation |
| `PORT` | yes | HTTP port (Render sets it) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | one required in production | AI providers; production readiness fails without one |
| `UPLOAD_DIR`, `SOURCE_UPLOAD_DIR`, `EXPORT_DIR` | production | Durable storage paths, checked by `/api/readyz` |
| `TYPEFULLY_API_KEY` | optional | Real social publishing |
| `RENDER_GIT_COMMIT` / `GIT_COMMIT` | automatic / optional | Commit reported by `/api/healthz` |
| `ALLOWED_ORIGINS`, `AI_PROVIDER_TIMEOUT_MS`, `LOG_LEVEL`, `FRONTEND_DIST_PATH` | optional | Tuning |

## Test

```bash
pnpm run format:check && pnpm run typecheck
pnpm --filter @workspace/api-server test:unit        # hermetic
pnpm --filter @workspace/api-server test:db:prepare  # disposable *_test database only
pnpm --filter @workspace/api-server test             # DB-backed
pnpm --filter @workspace/content-os test
bash tests/integration-tests.sh                      # needs a running API
pnpm --filter @workspace/content-os test:a11y        # Playwright + axe; needs a running API serving the built frontend
pnpm audit --audit-level=high
pnpm run build
```

`.github/workflows/ci.yml` is the required gate for PRs to `main` ([`docs/CI.md`](docs/CI.md)).

## Deploy

Render blueprint [`render.yaml`](render.yaml): web service + managed PostgreSQL + 10 GB persistent disk at `/var/data`; manual deploys only. First deployment, verification, release, rollback, backup and restore: [`docs/DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`](docs/DEPLOYMENT_AND_RECOVERY_RUNBOOK.md).

## Operating limits

- Single instance (persistent disk; in-process schedulers). Deploys have a short restart window.
- Media, source PDFs and exports are stored on the Render disk, not object storage.
- One shared workspace account; no per-user accounts, invitations or e-mail password reset.
- Projects, brands, sources and images are deleted through the API, not the UI ([`docs/DATA_LIFECYCLE_AND_OFFBOARDING.md`](docs/DATA_LIFECYCLE_AND_OFFBOARDING.md)).

## Documentation

Start at [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). User manual: [`docs/CLIENT_USER_MANUAL.md`](docs/CLIENT_USER_MANUAL.md). Operators: [`docs/ADMIN_OPERATIONS_MANUAL.md`](docs/ADMIN_OPERATIONS_MANUAL.md). Agent rules: [`AGENTS.md`](AGENTS.md). Which documents are current and which are historical: [`docs/DOCUMENT_OWNERSHIP_MAP.md`](docs/DOCUMENT_OWNERSHIP_MAP.md).
