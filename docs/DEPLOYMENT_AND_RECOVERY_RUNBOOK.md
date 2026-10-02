# Deployment and Recovery Runbook

Current procedure for deploying, verifying, rolling back, backing up and restoring Content Machine. Owner: `ebyron357`. Status and evidence: [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## 1. Environment map

| Environment | Where | Data | Purpose |
|---|---|---|---|
| Production | Render, defined by [`render.yaml`](../render.yaml) (region `ohio`) | Render PostgreSQL `agency-content-grants-db` (database `content_machine`) + 10 GB disk `content-machine-data` at `/var/data` | Live use. **Not created yet** — see `PROJECT_STATUS.md` |
| CI | GitHub Actions (`.github/workflows/ci.yml`, `content-closeout.yml`) | Disposable PostgreSQL 16 service container (`*_test` database) | Gate for every PR to `main` |
| Local | Developer machine | Local PostgreSQL 16 | Development; see `README.md` |

There is no staging environment. Every change reaches production only through a reviewed PR merged to `main` and a manual Render deploy (`autoDeployTrigger: off`).

The service is a single Node 24 process that serves the API and the built frontend from the same origin. Because it has a persistent disk it runs as **one instance**, and Render cannot do zero-downtime deploys for it: each deploy or restart has a short window (typically under a minute) where requests fail.

## 2. Configuration

Set in **Render → service `agency-content-grants` → Environment**. Never commit values.

| Variable | Required | Set by | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | blueprint (`production`) | Enables secure cookies and production readiness rules |
| `NODE_VERSION` | yes | blueprint (`24.15.0`) | |
| `DATABASE_URL` | yes | blueprint (from the Render database) | |
| `SESSION_SECRET` | yes | blueprint (`generateValue`) | Rotating it signs everyone out |
| `ADMIN_PASSWORD` | yes | **owner**, prompted at blueprint creation | The workspace sign-in password; see `SECURITY_AND_ACCESS_HANDOFF.md` |
| `OPENAI_API_KEY` | one provider key required in production | **owner**, prompted at blueprint creation | Alternatively `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (add manually). Without one `/api/readyz` returns 503 and Render will not mark the deploy live |
| `UPLOAD_DIR`, `SOURCE_UPLOAD_DIR`, `EXPORT_DIR` | yes | blueprint (`/var/data/...`) | Must stay on the persistent disk |
| `RENDER_GIT_COMMIT` | automatic | Render | Reported by `/api/healthz` as `commit` for SHA parity |
| `TYPEFULLY_API_KEY` | optional | owner | Enables the Typefully publishing provider |
| `AI_PROVIDER_TIMEOUT_MS`, `LOG_LEVEL`, `ALLOWED_ORIGINS` | optional | owner | Tuning; the app is same-origin so CORS origins are rarely needed |

`PORT` is provided by Render. Do not set `ALLOW_TEST_DATABASE_RESET` or `MIGRATIONS_DIR` in production.

## 3. First deployment (owner action)

1. Render dashboard → **New → Blueprint**.
2. Connect GitHub repository `ebyron357/agency-content-grants`, branch `main`. Render reads `render.yaml`.
3. Review the three resources (web service, PostgreSQL, 10 GB disk) and **approve the plan charges**.
4. Enter `ADMIN_PASSWORD` (a long random value from a password manager) and `OPENAI_API_KEY` when prompted.
5. Apply. Render creates the database and disk, builds (`corepack enable && pnpm install --frozen-lockfile && pnpm run build`), starts the service (`pnpm --filter @workspace/api-server start`), which applies database migrations before listening, and waits for `/api/readyz` to return 200.
6. Note the service URL shown in the dashboard (expected `https://agency-content-grants.onrender.com`).

## 4. Verify the deployment

Run from any machine with `bash`, `curl` and `jq`:

```bash
git clone https://github.com/ebyron357/agency-content-grants && cd agency-content-grants
BASE_URL=https://agency-content-grants.onrender.com \
EXPECTED_SHA=$(git rev-parse origin/main) \
SMOKE_ADMIN_PASSWORD='<ADMIN_PASSWORD>' \
bash tests/production-smoke.sh
```

The script must end with `RESULT: N passed, 0 failed`. It checks health, readiness and SHA parity, anonymous rejection, login and a `Secure`/`HttpOnly` session cookie, project and document persistence, rich-text sanitisation, image and video persistence, ownership probes, all five export formats, logout, and then deletes every `[SMOKE]` record it created. It makes one AI outline call (a few cents at most). It writes `smoke-evidence-<UTC>.txt`; attach that file to Issue #8 / ClickUp.

Then:

- Render → service → **Logs**: confirm `[migrate] Migrations complete` and `Server listening`, and no `level":50` (error) entries during the smoke run.
- Open the URL in a browser, sign in, open Dashboard and a document.
- Record URL, deployed SHA, result and date in `docs/PROJECT_STATUS.md`, on Issue #8 and in ClickUp `86e2tjzyc`.

## 5. Routine release

1. Merge a reviewed PR to `main` only with green **CI** checks.
2. Render → service → **Manual Deploy → Deploy latest commit** (or deploy a specific commit: `render deploys create <service-id> --commit <sha>` with the Render CLI).
3. Migrations in `lib/db/drizzle` run automatically at startup; a failed migration stops the process and the previous deploy keeps serving.
4. Run step 4 with `EXPECTED_SHA` set to the deployed commit.

## 6. Rollback

1. Render → service → **Events** → choose the last good deploy → **Rollback** (see [Render rollbacks](https://render.com/docs/rollbacks)). Alternatively deploy the previous commit explicitly.
2. Verify with step 4 using the rolled-back commit as `EXPECTED_SHA`.

Rules:

- **Disks are not rolled back.** Uploaded images, source PDFs and exports keep their current state.
- **Migrations are forward-only.** Before rolling back across a release that changed `lib/db/drizzle`, confirm the older code tolerates the newer schema, or restore the database (section 8). The 2 Oct 2026 release contains no schema change relative to `fac3cb9`; rollback between them was rehearsed on the same database and disk.

## 7. Backups

| Data | Mechanism | Retention | Action |
|---|---|---|---|
| PostgreSQL | Render point-in-time recovery on paid instances ([docs](https://render.com/docs/postgresql-backups)) | Recovery window depends on the workspace plan (3 days Hobby, 7 days Pro or higher, per Render) | Nothing to schedule. For longer retention, create a logical backup from **Database → Recovery** monthly and store it outside Render |
| Disk `/var/data` (images, source PDFs, exports) | Render daily disk snapshots ([docs](https://render.com/docs/disks)) | At least 7 days | Before risky operations, download a copy via the service **Shell**: `tar czf /tmp/data.tgz -C /var/data .` |
| Code | GitHub `main` | Permanent | — |
| Secrets | Render environment + owner's password manager | — | Keep `ADMIN_PASSWORD` and provider keys in the password manager |

## 8. Restore

- **Database, point in time:** Render → database → **Recovery** → choose a timestamp → Render creates a new database. Point the service's `DATABASE_URL` at it (or follow Render's promote/rename flow), redeploy, verify with step 4.
- **Database, logical backup:** extract the archive and run
  `pg_restore --dbname="$EXTERNAL_DATABASE_URL" --verbose --clean --if-exists --no-owner --no-privileges --format=directory <dir>`.
- **Disk:** Render → service → **Disks** → choose a snapshot → Restore. All disk changes after the snapshot are lost. Restore the database to a matching time if records and files must agree.

## 9. Disaster recovery

If the Render service or region is unavailable for an extended period: create a new blueprint from `render.yaml` (optionally another region), restore the database from the latest logical backup or PITR copy, upload the latest disk archive to `/var/data`, set the secrets, deploy `main`, verify with step 4, and update the URL in the handoff records. Target: same-day recovery, with data loss bounded by the last backup.

## 10. Secret rotation

| Secret | How | Effect |
|---|---|---|
| `ADMIN_PASSWORD` | Change the value in Render → Environment → **Save and deploy** | Existing sessions stay signed in until they expire or `SESSION_SECRET` also rotates; new sign-ins need the new password |
| `SESSION_SECRET` | Use Render's generate option → **Save and deploy** | Every session is signed out |
| Provider keys | Replace in Render and revoke the old key at the provider | No user impact |
| API keys (automation) | Settings → Automation → Revoke, then create a new key | The revoked key stops working immediately |

## 11. Suspend or decommission

- **Suspend:** Render → service → **Suspend**. The database and disk keep billing.
- **Decommission:** export what the owner needs (`DATA_LIFECYCLE_AND_OFFBOARDING.md`), take a final logical backup and disk archive, revoke provider and Typefully keys, delete the service, disk and database in Render, and record the date and backup location in `PROJECT_STATUS.md`.
