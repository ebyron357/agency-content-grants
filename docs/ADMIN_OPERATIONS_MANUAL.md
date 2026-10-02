# Admin and Operations Manual

For the person who runs Content Machine. End-user instructions are in [`CLIENT_USER_MANUAL.md`](CLIENT_USER_MANUAL.md); deploy/rollback/backup steps are in [`DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`](DEPLOYMENT_AND_RECOVERY_RUNBOOK.md); access and secrets are in [`SECURITY_AND_ACCESS_HANDOFF.md`](SECURITY_AND_ACCESS_HANDOFF.md).

## 1. Ownership

| Item | Owner | Where |
|---|---|---|
| Product and decisions | Emmanuel Andre Byron (`ebyron357`) | `docs/GO_NO_GO_DECISION.md` |
| Source code | `ebyron357` (GitHub owner) | `github.com/ebyron357/agency-content-grants`, branch `main` |
| Hosting, database, disk | `ebyron357` Render account | Render (to be created from `render.yaml`) |
| AI provider account and billing | `ebyron357` | Provider console (OpenAI by default) |
| Operational records | `ebyron357` | `docs/PROJECT_STATUS.md`, Issue #8, ClickUp `86e2tjzyc` |

## 2. Where things are

| Thing | Location |
|---|---|
| Production URL / login URL | The Render service URL (expected `https://agency-content-grants.onrender.com`); sign-in is at `/` |
| Liveness | `GET /api/healthz` → `{"status":"ok","commit":"<sha>"}` |
| Readiness | `GET /api/readyz` → `200 {"status":"ready"}` or `503` with which check failed (`database`, `storage`, `configuration`) |
| Logs | Render → service → **Logs** (structured JSON from pino; `level` 50 = error) |
| Database | Render PostgreSQL `agency-content-grants-db`, database `content_machine` |
| Files | Render disk at `/var/data`: `uploads/images`, `uploads/sources`, `exports` |
| Configuration | Render → service → **Environment** (table in the runbook, section 2) |

## 3. Normal operating workflow

1. **Weekly:** open the app, check the Dashboard pipeline; open Render → service → **Events/Logs** and confirm there are no repeated errors; confirm `/api/readyz` is 200.
2. **Monthly:** create a logical database backup (Render → database → **Recovery**) and store it outside Render; review the access register; check provider spend.
3. **On each release:** follow runbook section 5 (deploy) and section 4 (verify).
4. **On a departure:** follow the offboarding steps in `SECURITY_AND_ACCESS_HANDOFF.md` §3.

## 4. Accounts and access

See `SECURITY_AND_ACCESS_HANDOFF.md`. Summary: one workspace account, shared password (`ADMIN_PASSWORD`) set in Render; recover or change it by updating the environment variable; admin elevation (Settings → Security) re-uses the same password for global settings.

## 5. Integrations and their status (2 Oct 2026)

| Integration | Purpose | Configure | Status |
|---|---|---|---|
| OpenAI / Anthropic / Gemini | Research plans, outlines, drafting, edits, quality review, repurposing | Set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) in Render; per-stage models in Settings → Model Configuration (admin) | **Required for production; not yet configured** (no production environment). Without a key the app produces clearly labelled demo output and `/api/readyz` fails in production |
| Typefully | Publishing to social channels | `TYPEFULLY_API_KEY` in Render, then Distribution → Connect → provider `typefully` with the social-set ID | Optional; not configured |
| Demo publishing provider | Simulated publishing for trials | Built in; labelled `demo · simulated` | Available; publishes nothing externally |
| Performance metrics | Engagement data for published items | Comes from publishing providers that report analytics | No real provider connected; the Performance page shows only ingested data and says so |
| Automation API and webhooks | Connect n8n/Zapier/scripts | Settings → Automation (API keys with scopes, webhook subscriptions with signing secrets); contract in `docs/automation-api.md` | Available; none configured |
| E-mail | — | — | Not used; the product sends no e-mail |

When a provider fails, the affected action shows an error in the UI and is logged; other features keep working. Generation can be retried once the provider recovers.

## 6. Monitoring

- Render health check calls `/api/readyz`; a failing check stops a new deploy from going live and is visible in **Events**.
- Enable Render notifications for deploy failures and service health in the owner's Render account settings.
- No external uptime or error-tracking service is configured. Adding one is optional.

## 7. Ownership, billing and dependency register

Prices change; read current prices on each vendor's site before approving.

| Dependency | Paid by | Plan / basis | Needed for | If it fails |
|---|---|---|---|---|
| Render web service (`plan: 0.5c-512mb` in `render.yaml`) | Owner | Monthly compute | Everything | Site down; roll back or restart |
| Render PostgreSQL (`plan: 0.5c-1g`, 15 GB, autoscaling storage) | Owner | Monthly; PITR included on paid plans | All records and sessions | Readiness fails; restore per runbook |
| Render persistent disk (10 GB) | Owner | Monthly per GB | Images, source PDFs, exports | Uploads/exports fail; restore snapshot |
| AI provider (OpenAI by default) | Owner | Usage-based | Generation features | Generation errors; other features work |
| Typefully (optional) | Owner | Typefully subscription | Real social publishing | Publishing fails; content unaffected |
| GitHub | Owner | Current plan | Source, CI | No new releases until restored |
| npm registry packages | — | Open source (locked in `pnpm-lock.yaml`, audited in CI, SBOM per PR) | Build | Builds from the lockfile; audit before upgrades |

## 8. Changing the product

All changes go through a pull request to `main` with green **CI** (`docs/CI.md`), following `AGENTS.md`. Design changes must follow `docs/DESIGN_SYSTEM.md` and keep the accessibility gate green. Update `docs/PROJECT_STATUS.md` when the operational state changes.
