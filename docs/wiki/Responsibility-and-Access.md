# Responsibility & Access Document

_Account names and purposes only. **No credential values appear here and none may ever be added.** Every entry below is traceable to a file in this repository._

## 1. Ownership

| Role | Who | Evidence |
|---|---|---|
| Human owner / final approver | **Emmanuel Andre Byron** (GitHub `ebyron357`) | `docs/GO_NO_GO_DECISION.md` — "Human owner: Emmanuel Andre Byron (`ebyron357`)" |
| Canonical repository | `ebyron357/agency-content-grants`, default branch `main` | `docs/PROJECT_STATUS.md` |
| Product owner (docs, governance, agent rules) | Product owner = the human owner | `docs/DOCUMENT_OWNERSHIP_MAP.md` |
| Program lead (status, execution plan) | Named as a role only; no separate person recorded | `docs/DOCUMENT_OWNERSHIP_MAP.md` |
| Technical / security / quality leads | Named as roles in the ownership map; **no individuals are assigned in the repository** | `docs/DOCUMENT_OWNERSHIP_MAP.md` |

**Finding:** this is effectively a single-owner project. Every lead role in `docs/DOCUMENT_OWNERSHIP_MAP.md` resolves to the same person or is unfilled. That is a continuity risk — see §6.

Authority order, from `AGENTS.md`:
1. GitHub `main` — technical source of truth.
2. ClickUp — executive operating board (must be reconciled to verified GitHub/production state).
3. Replit — recovery/reference evidence only, **not** a development or deployment authority.

## 2. Where it is hosted

| Layer | Current state | Evidence |
|---|---|---|
| Source control | GitHub, `ebyron357/agency-content-grants` | `docs/PROJECT_STATUS.md` |
| CI | GitHub Actions, single workflow `recovery-baseline-validation.yml` | `.github/workflows/` |
| Original host | Replit (autoscale deployment, Postgres 16 module, object storage sidecar) — **decommissioned as the target** | `.replit`, `artifacts/*/.replit-artifact/artifact.toml`, `docs/GO_NO_GO_DECISION.md` ("Replit development/deployment: NO-GO") |
| Current production | **None verified.** `docs/PROJECT_STATUS.md`: "Production deployment: NOT YET VERIFIED" | `docs/PROJECT_STATUS.md` |
| Project/work tracking | ClickUp | `AGENTS.md` |

No Dockerfile, `fly.toml`, `vercel.json`, `render.yaml` or cloud IaC exists in the repository. **Choosing and provisioning the production host is an open decision, not a documented fact.**

## 3. Accounts required to run the system

### 3.1 Mandatory

| Account / service | Purpose in this codebase | Where it is consumed | Secret name (value never stored in repo) |
|---|---|---|---|
| **GitHub** — org/user `ebyron357` | Source of truth, CI, PR gates, branch protection | `.github/workflows/recovery-baseline-validation.yml` | GitHub login + 2FA; Actions uses the built-in token |
| **PostgreSQL 16 provider** (managed DB account — provider not yet chosen) | System of record for all 39 tables and the session store | `lib/db/src/index.ts`, `connect-pg-simple` in `app.ts` | `DATABASE_URL` (optionally `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`) |
| **Application host account** (Node 24 runtime; provider not yet chosen) | Runs `artifacts/api-server/dist/index.mjs` and serves `artifacts/content-os/dist/public` | `.replit` / artifact TOMLs describe the former Replit shape | Host console login |
| **Session secret** (not an account — an operator-generated value) | Signs session cookies; server refuses to start without it | `artifacts/api-server/src/app.ts` | `SESSION_SECRET` |

### 3.2 Required for real AI output (at least one)

| Account | Purpose | Consumed in | Secret name |
|---|---|---|---|
| **OpenAI platform account** | `gpt-*`/`o1`/`o3` models for any pipeline stage mapped to them | `src/lib/ai/openai-provider.ts` | `OPENAI_API_KEY` |
| **Anthropic Console account** | `claude-*` models (default seen in code: `claude-haiku-3-5`) | `src/lib/ai/anthropic-provider.ts` | `ANTHROPIC_API_KEY` |
| **Google AI Studio / Gemini account** | `gemini-*` models | `src/lib/ai/gemini-provider.ts` | `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` |

With none of these set, `src/lib/ai/router.ts` falls back to the built-in deterministic `demo` provider. The app runs; the content is not real AI output.

### 3.3 Required for specific features

| Account | Feature it unlocks | Consumed in | Secret name |
|---|---|---|---|
| **Google Cloud Storage bucket** (on Replit this was the platform's App Storage sidecar at `127.0.0.1:1106`) | PDF source upload and retrieval, object ACLs | `src/lib/objectStorage.ts`, `src/lib/objectAcl.ts` | `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` (+ real GCP service-account credentials once off Replit) |
| **Typefully account** (API access; social sets configured for x / linkedin / threads / bluesky / mastodon) | Scheduled social publishing and post analytics | `src/lib/publishing/typefully-provider.ts` | `TYPEFULLY_API_KEY` |
| **Downstream social accounts** (X, LinkedIn, Threads, Bluesky, Mastodon) | The actual destinations Typefully posts to; connected inside Typefully, not here | `publishing_destinations.externalAccountId` holds the Typefully social-set id | none stored by this app |
| **Replit account** | Historical host; needed only to retrieve legacy state or the object-storage sidecar | `.replit`, `.replit-artifact/*` | Replit login |
| **ClickUp account** | Executive tracking board that must mirror verified GitHub/production state | `AGENTS.md` | ClickUp login |

### 3.4 Credentials the application itself issues

These are **not** third-party accounts; the system creates them and you must manage them:

| Credential | Created where | Notes |
|---|---|---|
| Application user accounts | `users` table; login via `POST /api/auth/login`, passwords hashed (`src/lib/password.ts`) | There is no self-service signup route and no password-reset flow in the code. Account creation is an operator/seed action. |
| Admin unlock password | `ADMIN_PASSWORD` env var, used by `POST /api/auth/admin-unlock`, rate limited to 5 attempts / 15 min | Unlocks global-resource mutations: model config, content blueprints, dependency registry, provider connection tests, `POST /api/seed`. If unset, those routes are locked for everyone. |
| Automation API keys | `api_keys` table, UI path **Settings → Automation → API Keys** | Format `cmk_live_…`, shown exactly once, stored as a one-way hash, scoped (`read`, `projects:write`, `repurposing:write`, `publishing:write`), revocable and immediately effective (`docs/automation-api.md`) |
| Webhook signing secrets | `webhook_subscriptions` | Used by `src/lib/webhooks/signing.ts`; subscriber URLs are SSRF-screened by `urlSafety.ts` |
| Per-user provider configs | `provider_configs` table | Lets AI provider settings be stored in the database rather than only in env |

## 4. Who can access what, inside the app

- **Unauthenticated:** `POST /api/auth/login`, `GET /api/healthz`, public object paths, and `/api/automation/*` when presenting a valid API key.
- **Authenticated user:** everything under `router.use(requireAuth)` — but scoped to records they own. `src/middleware/ownershipHelpers.ts` checks `userId` on every entity and returns **404** (not 403) on a miss to prevent ID enumeration.
- **Admin-unlocked session:** global/shared resources and `POST /api/seed` (`src/middleware/requireAdmin.ts`).
- **API-key caller:** only the automation endpoints its scopes permit (`src/lib/automation/scopes.ts`, `src/middleware/requireApiKeyOrSession.ts`).

There are **no roles or teams** in the schema — no `organizations` or `memberships` table. Isolation is per user account. Multi-user agency teams sharing one brand are not modelled today.

## 5. Secret handling rules in force

From `AGENTS.md` and `RECOVERY_PROVENANCE.md`:
- Never commit secrets, credentials, private client data, regulated data or copyrighted snapshots.
- `artifacts/api-server/.env.example` contains **placeholders only** and is deliberately retained as configuration documentation.
- `.env` files, private keys, build output, `node_modules`, logs and local databases are excluded by `.gitignore` and by recovery policy.
- Recovery excluded `attached_assets/` (prompt/conversation attachments with possible personal or customer context) and `data/exports/` (generated output).
- Secret scanning is a required release gate; the recovery baseline recorded a PASS.
- Do not rotate unrelated credentials, change billing or buy services without explicit owner approval.

## 6. Access risks worth acting on

1. **Bus factor of one.** All owner/lead roles map to `ebyron357`. If that GitHub account is lost, the canonical source of truth is unrecoverable. Mitigation: add a second GitHub admin and store recovery codes offline.
2. **No production host account exists yet.** Nobody can be handed "the production login" because there is no production. This is the single biggest gap in this document.
3. **Storage credentials are Replit-shaped.** `objectStorage.ts` authenticates via the Replit sidecar. Moving off Replit requires a real GCP project, service account and bucket, plus a code change.
4. **No password reset / no signup.** Losing an application user password currently requires operator intervention at the database level.
5. **`ADMIN_PASSWORD` is a shared secret**, not per-person. There is no audit trail identifying *which* human performed an admin-unlocked mutation beyond the session's user id.
6. **Third-party key blast radius.** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `TYPEFULLY_API_KEY` are single account-wide keys with no per-tenant scoping. Set spend limits on the AI accounts.

## 7. Minimum handover checklist

To transfer operation of this system, the following must be handed over (values supplied out of band, never in the repo):

- [ ] GitHub org/repo ownership for `ebyron357/agency-content-grants` + Actions settings.
- [ ] ClickUp workspace access for the operating board.
- [ ] Postgres 16 instance credentials and a verified backup/restore procedure.
- [ ] Application host account and deployment credentials (once a host is chosen).
- [ ] `SESSION_SECRET` and `ADMIN_PASSWORD` values, plus the rotation procedure.
- [ ] OpenAI / Anthropic / Google AI account access and billing ownership.
- [ ] GCS project, bucket id and service-account key, plus the three object-storage env values.
- [ ] Typefully account and the social sets it controls, plus every downstream social account.
- [ ] The list of live automation API keys and webhook subscriptions to re-issue or revoke.
- [ ] Replit account access, for legacy retrieval only.
