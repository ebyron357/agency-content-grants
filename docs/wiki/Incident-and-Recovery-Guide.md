# Incident & Recovery Guide

_Every failure mode below is derived from actual code paths in this repository, with the file that produces the behaviour. Commands assume the repository root._

## 0. First response — triage in order

1. `GET /api/healthz` → expect `{"status":"ok"}` (`artifacts/api-server/src/routes/health.ts`). If this fails, the API process is down or never started.
2. Check the API process logs. Logging is pino JSON (`src/lib/logger.ts`); startup failures are logged as `"Startup failed — refusing to start"` and the process exits with code 1 (`src/index.ts`).
3. Check the database is reachable with the same `DATABASE_URL` the app uses.
4. Check the browser console/network tab: 401s mean session loss, CORS errors mean origin mismatch, 404s on owned records usually mean an ownership mismatch (see §5).

## 1. The server will not start

`src/index.ts` deliberately refuses to start rather than run degraded. Three fail-fast checks, in order:

| Symptom (exact message) | Cause | Fix |
|---|---|---|
| `PORT environment variable is required but was not provided.` / `Invalid PORT value: "…"` | `PORT` unset or non-numeric | Set `PORT` (Replit artifact used 8080) |
| `SESSION_SECRET environment variable is required` | Thrown from `src/app.ts` at module load | Set a long random `SESSION_SECRET`. **Changing it invalidates every existing session** — all users must log in again |
| `DATABASE_URL must be set before running migrations`, or a throw at import of `@workspace/db` | `lib/db/src/index.ts` throws at import when `DATABASE_URL` is unset | Set `DATABASE_URL`. If you only need the test-DB guard without the pool, import `@workspace/db/test-database-guard` |
| `Startup failed — refusing to start` after the above | Migrations failed, or `adoptOrphanedData()` failed | See §2 |

Startup sequence, for reference: `runMigrations()` → `adoptOrphanedData()` → `app.listen()` → start publishing, performance and webhook schedulers.

## 2. Migration failures

`runMigrations()` (`lib/db/src/migrate.ts`) runs Drizzle's migrator on every boot and is idempotent; applied migrations are tracked in `drizzle.__drizzle_migrations`.

**Failure: migrations folder not found.** The compiled bundle expects `dist/drizzle/`, which `artifacts/api-server/build.mjs` copies from `lib/db/drizzle/`. If you deployed `dist/index.mjs` without that folder, migrations cannot be found.
- Fix: redeploy the full `dist/` directory, or set `MIGRATIONS_DIR` to an absolute path containing the 15 SQL files.

**Failure: a migration errors mid-way.** Drizzle stops at the failing file. The database is left partially migrated.
- Do **not** hand-edit `__drizzle_migrations` to skip a file.
- Restore from backup (§8), fix the migration, redeploy.

**Failure: schema drift** — the app queries a column that does not exist.
- Cause: someone used `pnpm --filter @workspace/db run push` (dev-only schema push) against a shared database instead of writing a migration.
- Fix: generate a proper migration file under `lib/db/drizzle/` and redeploy. Never run `push` against production.

## 3. Login, sessions and rate limiting

Sessions are stored in Postgres via `connect-pg-simple` in a table named `session`, created on first run (`createTableIfMissing: true`), pruned every 15 minutes, cookie `sid`, 7-day max age, `secure` only when `NODE_ENV=production` (`src/app.ts`).

| Symptom | Likely cause | Action |
|---|---|---|
| Everyone logged out after a deploy | `SESSION_SECRET` changed, or the `session` table was dropped | Restore the secret from the secret store; otherwise users simply log in again |
| Login works then immediately 401s | `NODE_ENV=production` over plain HTTP — a `secure` cookie is never sent back | Terminate TLS in front of the app and ensure `trust proxy` is correct (`app.set("trust proxy", 1)`) |
| `429 Too Many Requests` on login or admin unlock | 5 attempts per 15 minutes (`src/routes/auth.ts`) | Wait out the window. Limits are stored in Postgres (`src/lib/pgRateLimitStore.ts`) so restarting the server does **not** clear them |
| Admin-only routes reject a valid admin | `ADMIN_PASSWORD` is unset — then `admin-unlock` can never succeed and those routes stay locked for everyone | Set `ADMIN_PASSWORD` and restart |
| User forgot their password | **No password reset route exists** | Operator must update `users.password_hash` using the hashing in `src/lib/password.ts` |

## 4. CORS / frontend cannot reach the API

`src/app.ts` builds a fixed allowlist: `https://$REPLIT_DEV_DOMAIN`, every host in `REPLIT_DOMAINS`, `http://localhost`, `http://localhost:3000`, `http://127.0.0.1`. Any other origin gets `cors(false)` — the browser blocks the credentialed response.

- **Symptom:** requests succeed in curl but fail in the browser with a CORS error, or cookies are never stored.
- **Cause off Replit:** your real domain is in none of those lists.
- **Fix (preferred):** serve the SPA and the API from the **same origin** behind one reverse proxy (`/` → `dist/public`, `/api` → the Node process). The SPA calls relative paths (`src/lib/api.ts` uses `import.meta.env.BASE_URL`), so same-origin removes the problem entirely.
- **Fix (alternative):** add the production origin to the allowlist in `src/app.ts`. This is a code change, not configuration — a known limitation.

## 5. "Not found" on data the user can see elsewhere

`src/middleware/ownershipHelpers.ts` returns **404 rather than 403** when a record's `userId` does not match `req.session.userId`, deliberately, to prevent ID enumeration.

So a 404 can mean *either* "does not exist" *or* "belongs to someone else". When debugging, check the row's `user_id` directly before assuming data loss.

Related: `adoptOrphanedData()` (`src/lib/adoptData.ts`) runs at startup to adopt brands/projects created before user accounts existed. If legacy rows have a null `user_id`, they become invisible until adopted.

## 6. AI generation problems

`src/lib/ai/router.ts` resolution order: the `model_config` singleton row for the pipeline stage → provider inferred from the model prefix → first configured real provider → `demo` provider.

| Symptom | Cause | Action |
|---|---|---|
| Output is obviously canned/placeholder | No provider key set, so the `demo` provider answered (`src/lib/ai/demo.ts`, `model: "demo-model"`) | Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` and restart |
| Wrong/unexpected model used | `model_config` maps each stage (planning, research, outline, writing, editing, verification, evaluation, utility) independently | Fix the stage mapping in Settings → Models, or the `model_config` row (id `singleton`) |
| A model name is rejected/misrouted | Provider is inferred from prefix: `gpt-`/`o1`/`o3` → OpenAI, `claude-` → Anthropic, `gemini-` → Google. An unrecognised prefix will not route | Use a prefixed model name the router understands |
| 401/429 from the provider | Bad or rate-limited key, or no billing | Check the provider console; the failure surfaces in the route response and in the `generation_runs` / `activity_log` tables |
| A long pipeline run stalls | Generation happens inline in the request; there is no job queue | Re-run the stage. Check `generation_runs` for the last recorded state before retrying |

## 7. File and export problems

**Exports.** `src/lib/exporters/index.ts` writes to `process.cwd()/data/exports` on the **local filesystem** and records a row in `exports`.

- **Symptom:** an export row exists but downloading it 404s.
- **Causes:** the container was replaced (ephemeral disk), the process started from a different working directory, or the app is running on more than one instance and the file lives on the other one.
- **Immediate fix:** re-run the export.
- **Permanent fix:** mount a persistent volume at `<cwd>/data/exports`, run exactly one instance, or move export storage to object storage (currently unimplemented).

**Uploads / object storage.** `src/lib/objectStorage.ts` authenticates through the Replit sidecar at `http://127.0.0.1:1106`.

- **Symptom off Replit:** every upload fails — the sidecar does not exist and the token URL is unreachable.
- **Symptom anywhere:** `PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' tool and set PUBLIC_OBJECT_SEARCH_PATHS env var` — thrown explicitly by `getPublicObjectSearchPaths()`.
- **Fix:** set `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`; off Replit, also replace the external-account credential block with real GCP service-account credentials.

## 8. Publishing, webhooks and performance ingestion

All three schedulers are **in-process `setInterval` loops** started in `src/index.ts` — there is no separate worker.

| Symptom | Check | Notes |
|---|---|---|
| Scheduled posts never go out | Is the API process actually running? Schedulers die with it | `src/lib/publishing/scheduler.ts` |
| Posts go out twice | More than one API instance is running | Each instance runs its own scheduler. Run a single instance until this is redesigned |
| Publish attempt fails loudly with a parse error | Deliberate: the Typefully adapter throws on any unrecognised response shape rather than guessing (`src/lib/publishing/typefully-provider.ts`) | Check `publication_attempts` for the recorded failure; confirm `TYPEFULLY_API_KEY` and that `externalAccountId` is a valid Typefully social-set id for the destination's platform |
| Webhooks not delivered | `webhook_deliveries` / `webhook_delivery_attempts` hold the retry state | Subscriber URLs are SSRF-screened (`src/lib/webhooks/urlSafety.ts`) — an internal/private URL is rejected by design |
| No performance metrics | 5-minute tick plus per-destination throttling (`MIN_INGEST_INTERVAL_MS`) | `src/lib/performance/scheduler.ts`; a tick is skipped if the previous one is still running |
| Duplicate automation actions | Idempotency keys are supported (`src/lib/automation/idempotency.ts`) | Callers must send them; without one, retries create duplicates |

## 9. Build and dependency failures

| Symptom | Cause | Fix |
|---|---|---|
| `preinstall` aborts | `scripts/enforce-pnpm.mjs` removes non-pnpm lockfiles and rejects npm/yarn | Use pnpm 11.16.0 |
| Lockfile mismatch in CI | `pnpm install --frozen-lockfile` | Commit the updated `pnpm-lock.yaml` |
| Runtime `Cannot find module 'docx'` / `pdfkit` / `@google-cloud/storage` | These are **externalised** by esbuild (`build.mjs`) and not bundled | Deploy `node_modules` alongside `dist/`; do not ship `dist/index.mjs` alone |
| Migrations missing after build | `copyMigrations()` in `build.mjs` copies `lib/db/drizzle` → `dist/drizzle` | Run the package's own `build` script rather than calling esbuild directly |
| Vite build fails asking for `PORT` | `vite.config.ts` only requires `PORT` when serving (`command === 'serve'`), not for builds | If you see this on build, you are running `dev`/`preview`, not `build` |

## 10. Restore and redeploy procedures

### 10.1 Rebuild the application from source

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/content-os test
pnpm --filter @workspace/api-server build     # → dist/index.mjs + dist/drizzle
pnpm --filter @workspace/content-os build     # → dist/public
```

Then run the API with `DATABASE_URL`, `SESSION_SECRET` and `PORT` set:

```bash
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Migrations apply automatically on boot. Verify with `curl -f http://localhost:$PORT/api/healthz`.

### 10.2 Full end-to-end verification (what CI does)

`.github/workflows/recovery-baseline-validation.yml` is the reference procedure and can be run manually via `workflow_dispatch`: Postgres 16 service → frozen install → typecheck → API tests → frontend tests → `test:db:prepare` → build → start API → poll `/api/healthz` up to 30 times → `bash tests/integration-tests.sh` → stop API → full workspace build.

To reproduce locally, export the same variables the workflow sets: `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, a `*_test` `DATABASE_URL` on localhost, `MIGRATIONS_DIR`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `TEST_ADMIN_PASSWORD`, `PORT`.

**Safety guard:** `lib/db/src/testDatabaseGuard.ts` refuses any destructive test operation unless `NODE_ENV=test`, `ALLOW_TEST_DATABASE_RESET=true`, the host is `localhost`/`127.0.0.1`/`postgres`, and the database name ends in `_test`. **Never set `ALLOW_TEST_DATABASE_RESET=true` in an environment that can see production.**

### 10.3 Database restore

There is **no backup script in this repository**. The restore path depends on the managed Postgres provider chosen for production, which is not yet decided (`docs/PROJECT_STATUS.md`: production deployment NOT YET VERIFIED). Required before go-live:

1. Enable automated backups + point-in-time recovery on the Postgres instance.
2. Document and *rehearse* a restore into a scratch database.
3. After restore, start the app — `runMigrations()` will bring the restored schema forward safely.
4. Remember that `data/exports` files are **not** in the database. If export files matter, back up that volume too, or re-generate exports from the stored document sections (all content lives in `documents` / `document_sections` / `section_revisions`).

### 10.4 Rolling back a bad deploy

1. Redeploy the previous commit's build artefacts.
2. **Migrations do not auto-roll-back.** Drizzle applies forward-only. If the bad deploy added a migration, rolling the code back while the schema stays forward is usually safe for additive migrations and unsafe for destructive ones — check the specific SQL in `lib/db/drizzle/` before rolling back.
3. Re-verify `/api/healthz` and one authenticated read path.

### 10.5 Source-level disaster recovery

`RECOVERY_PROVENANCE.md` documents the one recovery already performed: the application was restored from `content-machine-export.zip` (SHA-256 `3935222D882B46A4D4F1551A620CF170EF3D474FDAA790ED4A22EDCF3F3AE91F`), which contained **no Git history**, so the original deployed revision can never be proven. The lesson recorded there applies: GitHub `main` is the only source of truth; anything that exists solely on a hosting platform is unrecoverable evidence.

## 11. Known structural fragilities to design around

1. Single API process holds all schedulers → no safe horizontal scaling today.
2. Exports on local disk → incompatible with ephemeral/autoscaled containers.
3. Object storage hard-wired to the Replit sidecar → uploads break on any other host.
4. CORS allowlist hard-coded to Replit/localhost → requires a code change for a new domain.
5. No CI gate on `main` (the only workflow targets the recovery branch) and no linter configured.
6. No backup, alerting, uptime monitoring or error-tracking configuration exists in the repository.
