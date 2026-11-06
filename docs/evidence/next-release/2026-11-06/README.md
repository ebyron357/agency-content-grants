# Next release: combined PRs #58, #56, #57 and #55, and an upgrade rehearsal from `ee7b5c8`, 6 November 2026

This is local rehearsal evidence for the release after the current deploy candidate. It is **not** production evidence, it changes no decision record, and it merges nothing. No branch was pushed, no PR was merged or commented on, and Render, production, secrets and ClickUp were not touched.

- **Deploy candidate (baseline):** `ee7b5c8bf9c46dc3c447629e616ca6adb6c7e5cd`. `main` `0e4f598` differs from it only in tests and documents (`grants.integration.test.ts`, three docs).
- **Combined tree:** local branch `rehearsal/combined-55-58`, head `fd6e8246780a9ce7cdcc25845e85d0ccb1c22801`. It is `origin/main` `0e4f598` with four `--no-ff` merges, in the proposed order:

| Order | PR | Branch head | Migration | `when` in the journal |
|---|---|---|---|---|
| 1 | #58 foundation giving | `a915661` | `0030_foundation_giving` | 1789209600000 |
| 2 | #56 source registry and page watcher | `39dc601` | `0031_source_registry` | 1789296000000 |
| 3 | #57 notice PDF checklist | `6f5ba54` | `0032_grant_notice_checklist` | 1789382400000 |
| 4 | #55 billing plans (Stripe off until configured) | `2001953` | `0033_billing_plans` | 1789468800000 |

## 1. Merge order and conflicts

No PR changes `render.yaml`, so none of them would trigger a Blueprint Auto Sync deploy on merge.

| Merge | Conflicting files | Resolution |
|---|---|---|
| #58 onto `main` | none | — |
| #56 | `lib/jobs/definitions.ts`, `lib/jobs/schedules.ts`, `routes/index.ts`, `vitest.unit.config.ts`, `e2e/jobs.spec.ts`, `docs/BACKGROUND_JOBS.md`, `docs/GRANT_STUDIO.md`, `meta/_journal.json`, `schema/index.ts` | Every conflict was two additions at the same place, so both were kept. Then three fixes by hand. In `schedules.ts`, the two `import … from "./definitions"` lines became one, because concatenating them duplicated identifiers, and the two schedule objects were closed and reopened (`},{`). The `BACKGROUND_JOBS.md` table rows were kept contiguous. The two `GRANT_STUDIO.md` migration paragraphs became one, naming both migrations. In `jobs.spec.ts`, #58's foundation-schedule assertion and #56's "every schedule off" assertion both stay |
| #57 | `definitions.ts`, `BACKGROUND_JOBS.md`, `GRANT_STUDIO.md`, `_journal.json` | `aiKey` kept once, widened to #57's `"draft" \| "review" \| "extract" \| "notice"`. Both import sets kept. The table row moved into the table, and the paragraphs, settings rows and migration paragraph merged |
| #55 | `content-os/src/pages/Settings.tsx`, `_journal.json`, `schema/index.ts` | `TABS` = `['Team', 'Billing', …, 'Jobs', 'Sources']`, with both imports and both tab bodies (the body lines merged without conflict) |

**Journal.** Each branch adds one entry after `0029` (`idx` 30). Three of them use `idx` 31 and #55 uses `idx` 34. The combined journal has `0030`→31, `0031`→32, `0032`→33 and `0033`→34, with `when` strictly ascending. `lib/db/drizzle/meta/` holds only `0000_snapshot.json`, and no PR adds a snapshot, so there was no snapshot file to reconcile. `pnpm-lock.yaml` (changed by #58, #57 and #55) merged without conflict, and `pnpm install --frozen-lockfile` passes on the result.

**The order matters for deploys, not just merges.** Drizzle 0.45.2 applies a migration only when its `when` is greater than the newest `created_at` already recorded (`drizzle-orm/pg-core/dialect.js:62`). `idx` is not used. If `0033` reaches a database before `0030`–`0032`, a later deploy that contains them skips them for good, and the log still says `Migrations complete`. This was reproduced on a throwaway database (`scripts/order-hazard.mjs`, `order-hazard.txt`): after `0033` alone, then the full journal, only `billing_plans` exists, and the migration table holds 32 rows instead of 35.

The proposed order #58 → #56 → #57 → #55 is also the numeric order and the `when` order, so it is safe. Any other order is safe only if no deploy happens until all four are merged. Because Auto Sync deploys any merge that touches `render.yaml`, an unrelated `render.yaml` PR merged in between would count as such a deploy. No better order was found.

## 2. Gates on the combined tree

The steps of `.github/workflows/ci.yml` were run in order, with its environment, against a disposable PostgreSQL 16.15 cluster on port 5434 (`scripts/gates.sh`, `scripts/pg-start.sh`). Node was 22.23.4 here; CI uses 24.15.0. Counts are in `gates/counts.txt`.

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `format:check` | pass |
| `typecheck` | pass |
| API unit tests | **335/335**, 30 files |
| `test:db:prepare`, then API tests | **590/590**, 60 files |
| Content OS tests | **39/39**, 9 files |
| API and frontend builds | pass |
| `tests/integration-tests.sh` | **40 passed, 0 failed, 0 skipped**, twice |
| Accessibility gate (`test:a11y`, preinstalled Chromium) | **14/14** on the rerun; see below |
| Production build (`pnpm run build`) | pass |
| `pnpm audit --audit-level=high` | pass. 0 high, 0 critical, 1 moderate: `minimatch` GHSA-g3hv-75wg-m249 through `orval`→`typedoc` (dev/codegen only; the existing DEFER) |

**The first accessibility run failed 14/14 because of this environment, not the code.** The worktree lives under `.claude/worktrees/…`. The API serves `index.html` with `res.sendFile` (`artifacts/api-server/src/app.ts`), and `send` ignores paths containing a dot-directory by default, so `/` answered `Cannot GET /`. CI's checkout path has no dot-directory. The rerun copied the same build output outside the dot path and set `FRONTEND_DIST_PATH` (`scripts/gates-a11y.sh`). It re-prepared the database, started the API, and ran integration (40/0/0) and then the accessibility gate (14 passed, `gates/12b-a11y.txt`). The rehearsal builds below ran outside any dot path and served `/` normally (smoke checks "GET / serves the app shell").

The `gitleaks` secret scan and the CycloneDX SBOM steps of the CI `security` job were not run locally.

## 3. Upgrade rehearsal

This follows the [4 November method](../../upgrade/2026-11-04/README.md), and its scripts are reused (`scripts/`; `R=` and the database port changed).

- Each version was exported with `git archive` and built with the Render build command (`pnpm install --frozen-lockfile && pnpm run build`). Both builds passed.
- Production mode:
  - `NODE_ENV=production`;
  - one database `rehearsal_upgrade` and one scratch disk shared by every step;
  - `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` and `ADMIN_PASSWORD` random, never committed, and the same for every version;
  - `GIT_COMMIT` set;
  - the local TLS edge on 8443.
- No AI provider key and no Stripe settings, so `/api/readyz` was 503 on `configuration` only. Smoke therefore ran with `SMOKE_REQUIRE_READY=0`, and with `SMOKE_REQUIRE_GRANTS=0` because this container cannot reach Grants.gov.
- All data is synthetic, prefixed `[REHEARSAL]`, `[SYNTHETIC]` or `[SMOKE]`, with `example.org` members. The notice is a two-page PDF generated by `scripts/mkpdf.mjs`.

| # | Running | What was done | Result |
|---|---|---|---|
| 1 | `ee7b5c8` on an empty database | 31 migration rows. The seed:<br>• the team password signs in;<br>• a brand and a guide project;<br>• a writer and a reviewer invited and accepted;<br>• the writer turns on two-factor (`v1:` sealed);<br>• a synthetic opportunity;<br>• an applicant, a confirmed fact, an application, a writer-edited section and a $52,000 budget line | Seed **11/11**. Data checks **26/26**. Smoke **101/101** |
| 2 | **Upgrade:** combined `fd6e824` on the same database and disk | `[migrate] Migrations complete`. The table went from 31 to **35** rows, `created_at` ascending through `0030`–`0033`. Old records re-read: two-factor with the secret sealed by `ee7b5c8`, a recovery code issued by `ee7b5c8` accepted once then refused, the reviewer's role limits, anonymous refusal.<br>New features on the old records:<br>• foundations meta, list and suggestions for the old applicant; the import is refused without admin unlock and returns 409 while `FOUNDATIONS_IMPORT_ENABLED` is unset;<br>• the source registry is admin-unlock only, lists exactly the two seeded feed rows, and the change-notification receiver returns 503 with no secret;<br>• billing reports off, names the three missing settings, entitlement `unlimited`, trial and checkout 409, Stripe webhook 404, reviewer 403, plans seeded with prices unpublished, and a new organization is not limited;<br>• a notice PDF on the application started on `ee7b5c8` is read by pdf.js (2 of 2 pages, 2 demo-labelled rows each citing its page). The reviewer gets 403 on attach, anonymous 401, and a link to `127.0.0.1` 400 | Data checks **28/28**. Features **35/35** (the first run, `features-2a-…`, had 34/35 because the script compared psql's `f` with `false`; the value was correct). Smoke **101/101**. Warnings: only the expected readiness 503. The grant sync job failed both sources (`fetch failed`, no network) and was rescheduled, and the registry recorded that on both feed rows |
| 3 | **Rollback:** `ee7b5c8` on the `0033` schema | Started without running any migration. The same data checks | Data checks **26/26**. Smoke **101/101**. The old API returns the application with its 2 `notice` requirement rows (`rollback-3-requirements.txt`). No error entries |
| 4 | **Roll forward:** combined again | The same checks | Data checks **26/26**. Smoke **101/101**. The notice (`ready`, pdf.js, 2 pages) and its rows survived the rollback. No error entries |

**Step 4 first attempt** (`verify-4a-forward-ratelimited.txt`, 21/26):

- **Two-factor 429 (intended).** A correct two-factor code got 429, and the writer checks after it failed. That is the intended per-address two-factor limit: four deliberate wrong codes and one reused recovery code from 127.0.0.1 in 15 minutes left the row `mfa|127.0.0.1|6`. The row was deleted in the rehearsal database only, as on 4 November.
- **Audit-log check failed (script).** The audit-log check also failed because the log is paged 50 at a time (`nextBefore`). Four smoke runs had pushed the seed events onto page 2. `audit-4-pages.txt` shows all 3 seed events across 2 pages. `verify.sh` now reads every page.

The rerun passed 26/26. No `[SMOKE]` project or organization remained.

## 4. Review findings

All four PRs are additive. No new migration has a `DROP`, `DELETE`, `TRUNCATE`, rename, type change or `SET NOT NULL`. `0030`, `0031` and `0033` only create tables and indexes, and `0031` and `0033` seed rows with `ON CONFLICT DO NOTHING`. `0032` adds eight nullable columns to `grant_requirements` without defaults, which needs only a brief lock and no rewrite, plus an index on a small table.

Verified defects (none blocks the release):

1. **Out-of-order deploys skip migrations silently** (all four PRs; §1). This is not a code defect, but it is a release-procedure risk that is now proven. Merge and deploy in numeric order.
2. **#57 replaces the old notice before the new one is stored.** In `routes/grants.ts` (combined line 1135), `if (previous) await removeNotice(...)` runs before the insert, so a failed insert leaves the application with no notice. That is low impact: the person attaches it again.
3. **#57 on rollback.** `ee7b5c8` knows nothing of notice files. Deleting an application there cascades the `grant_notices` row (FK `ON DELETE CASCADE`) but leaves the PDF on the sources disk. This is a small orphan file, only while rolled back.

Security and scoping (verified by reading the code and by the rehearsal checks):

- **#57.** Every notice route goes through `ownedApplication` or `ownedChild` (workspace principal). Link fetches use the shared DNS-pinned `safeLookup`, are https only, refuse credentials and private hosts, re-check each of at most 3 redirects, and cap the bytes. The file is served as `application/pdf` with a sanitised file name.
- **#56.**
  - The registry and drafts need `workspace.configure` and an admin unlock (`routes/grant-sources.ts:44`). The receiver is public but needs a secret of 24+ characters compared in constant time, answers 503 when unset, and is rate limited. Its body only names a watch.
  - The fetcher pins DNS to public addresses, is https only, re-checks redirects, and caps size and time.
  - Feed rows are excluded from the sweep (`service.ts` `dueSources`).
  - Drafts reach applicants only through the publication gate, and demo drafts cannot be approved.
- **#58.** Reads are global reference data. The import needs an admin unlock, `workspace.configure` and `FOUNDATIONS_IMPORT_ENABLED=true`. Search escapes `%`, `_` and `\`. Suggestions are scoped to the caller's applicant.
- **#55 with no Stripe settings** (production today):
  - every limit check returns allowed before touching the database (`lib/billing/service.ts:146`, `160`, `170`, `184`);
  - the webhook answers 404 (`routes/billing.ts:231`);
  - trial, checkout, expert review and portal answer 409;
  - `GET /billing` reads the plan tables and reports off;
  - no Stripe client is created.

  So with Stripe unset it changes nothing except that **admins lose `billing.manage`** (`lib/permissions.ts`): owners only. `PUT /workspaces/:id/billing` is cross-workspace by design and needs an admin unlock.

Suspicions and design points for the owner (not verified defects):

- **#55, when billing is switched on:**
  - Only section drafts are metered (`claimAiDraftedApplication`, combined `grants.ts:1268`). Review (`:1278`), requirement extraction (`:1052`) and the #57 notice checklist (`:1097`) use AI unmetered.
  - The usage row is claimed before the draft job runs, so a failed draft still counts.
  - Every existing client workspace without a subscription becomes "no plan" and cannot invite, add organizations or draft. `docs/BILLING.md` §5 step 8 says to mark agency-run workspaces as managed first.
  - The "Foundation open calls" Pro feature has no entitlement check.
- **#56.** Migration `0031` (lines 93–97) records the Grants.gov and California terms as checked, by "Agent 2 (source registry PR)", with `terms_permit_automation = true`. That is an agent's reading recorded as a review. The row itself notes that the attribution notice the Grants.gov terms require is not yet shown in the product. The owner should confirm both.
- **#57.** Uploads are buffered in memory: `multer.memoryStorage()`, 25 MB by default and up to 50 MB (combined `grants.ts:1076`). On the 512 MB instance, a few concurrent uploads plus pdf.js parsing could press memory. The job is limited to one at a time, but uploads are not.
- **#57** adds `pg` to `content-os` **devDependencies**, for e2e seeding against a database whose name ends in `_test`. It is not shipped in the frontend bundle.

## Limits

- Node 22 locally, against 24.15 on Render and CI. Small data volume.
- No AI key: notice proposals and drafting ran in labelled demo mode.
- No Stripe test keys: billing was exercised only in its off state here. The PR's integration tests cover the on state with a fake Stripe.
- The foundation import was not run (off by default; the funder-graph host is unreachable here).
- The changedetection.io backend was not run.
- `gitleaks` and the SBOM were not run.
- The combined branch is local only. Its merge resolutions are this rehearsal's choices; each PR still needs its own rebase.

## Reproducing

`scripts/` holds the helpers as run. Change `R=` and the paths first.

| Script | Purpose |
|---|---|
| `pg-start.sh` | Disposable PostgreSQL on 5434 |
| `gates.sh` | The CI steps |
| `gates-a11y.sh` | The server-backed steps, with the frontend outside a dot path |
| `run-server.sh`, `switch.sh` | Start or replace the running version |
| `tls-proxy.mjs` | The local TLS edge |
| `seed.sh` | Step 1 data |
| `verify.sh` | Data checks |
| `features-next.sh` | The four PRs' features |
| `smoke.sh` | `tests/production-smoke.sh` from the running tree |
| `mkpdf.mjs` | The synthetic notice |
| `req-origins.sh`, `audit-pages.sh` | Extra checks |
| `order-hazard.mjs` | The migration-order reproduction |
| `lib.sh`, `totp.mjs` | Shared helpers and authenticator codes |

The secrets, the TLS key and `seed.env` (synthetic member passwords, the TOTP secret and a recovery code) were not committed.
