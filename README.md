# Content Machine (Content OS)

An evidence-first, multi-tenant workspace for agency long-form content: guided projects (brief → sources → claims → outline → draft → review), a TipTap rich editor with image and video embeds, AI-assisted drafting and repurposing, and export to TXT, Markdown, DOCX, PDF and HTML with an evidence register.

Grant/proposal-intelligence capability described in early planning documents is **not implemented** and is deferred future scope. Nothing in this repository should be read as a production-ready grant feature.

## Release state

**NO-GO for production launch; GO for continued controlled development and review.** The code is a release candidate that passes CI (install, format, typecheck, migrations, API/frontend/integration tests, authenticated accessibility gate, build). It has not been deployed. Remaining gates require owner-controlled resources: production PostgreSQL and durable disk, secrets, a real AI provider key, deployed smoke/isolation evidence and a rollback exercise.

Authoritative status lives in `docs/PROJECT_STATUS.md` (master checklist) and `docs/GO_NO_GO_DECISION.md`; working rules are in `AGENTS.md`. Stage 0 planning, recovery and early-audit documents (`docs/PROGRAM_CHARTER.md`, `docs/STAGE_0_EXECUTION_PLAN.md`, `docs/recovery/`, `PROJECT_CLOSEOUT.md`, `RECOVERY_PROVENANCE.md`) are **historical evidence, superseded** by those files; the Payload/Temporal/LangGraph/n8n architecture they discuss was never adopted.

## Architecture

pnpm workspace, TypeScript.

| Path | Role |
|---|---|
| `artifacts/content-os` | Frontend: React, Vite, Tailwind v4, Radix UI, TanStack Query, wouter, TipTap. Playwright/axe accessibility suite in `e2e/`. |
| `artifacts/api-server` | Express 5 API: sessions/auth, ownership-scoped CRUD, media and source upload, AI providers, exports, `/api/healthz` (liveness) and `/api/readyz` (DB, migrations, writable storage, production config). Serves the built frontend same-origin. |
| `lib/db` | Drizzle schema + SQL migrations (PostgreSQL 16). |
| `lib/api-client-react`, `lib/api-zod`, `lib/api-spec` | Generated API client/schemas. |
| `artifacts/mockup-sandbox` | Design sandbox, not shipped. |
| `tests/integration-tests.sh` | Black-box API integration suite. |

## Run locally

Node 24.15.0, pnpm 11.16.0, PostgreSQL 16.

```bash
pnpm install --frozen-lockfile
cp .env.example .env            # set DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD
pnpm --filter @workspace/db push
pnpm --filter @workspace/api-server dev      # API on :8080
pnpm --filter @workspace/content-os dev      # Vite dev server, proxies /api
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `SESSION_SECRET` | yes | Session signing secret (server refuses to start in production without it) |
| `ADMIN_PASSWORD` | production | Unlocks admin-only mutations |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | one for real generation | AI providers; without one, demo generation is used |
| `UPLOAD_DIR`, `SOURCE_UPLOAD_DIR`, `EXPORT_DIR` | production | Must point at durable storage; checked by `/api/readyz` |
| `ALLOWED_ORIGINS` | optional | CORS allowlist beyond localhost |
| `AI_PROVIDER_TIMEOUT_MS`, `LOG_LEVEL`, `PORT`, `FRONTEND_DIST_PATH` | optional | Tuning |

## Test

```bash
pnpm run format:check && pnpm run typecheck
pnpm --filter @workspace/api-server test:unit        # hermetic
pnpm --filter @workspace/api-server test:db:prepare  # disposable DB only
pnpm --filter @workspace/api-server test             # DB-backed
pnpm --filter @workspace/content-os test
bash tests/integration-tests.sh                      # needs a running API
pnpm --filter @workspace/content-os test:a11y        # Playwright + axe
pnpm audit --audit-level=high
pnpm run build
```

`.github/workflows/ci.yml` is the canonical gate for pull requests to `main` (validation job with a Postgres 16 service, plus a `security` job: gitleaks, `pnpm audit`, CycloneDX SBOM). `recovery-baseline-validation.yml` is historical.

## Production deployment

`render.yaml` is a Render blueprint (web service + managed PostgreSQL + a persistent disk at `/var/data` used for uploads, sources and exports; auto-deploy is off). Any host works if it provides PostgreSQL 16 and a durable, writable filesystem path for the three storage variables. Media is stored on that filesystem, not in object storage; moving to S3-compatible storage would be a separate change. Production is not deployed.

## Known limitations

- Rate limiting is in-process (`express-rate-limit`, memory store); it does not share state across multiple instances. Run a single instance or add a shared store before scaling out.
- Browser automation currently covers accessibility of authenticated screens; full multi-user authoring/tenant-isolation browser journeys are covered by API/integration tests rather than Playwright.
