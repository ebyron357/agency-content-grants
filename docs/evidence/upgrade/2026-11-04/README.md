# Upgrade rehearsal from production `d2250c3` to candidate `fdb352c`, 4 November 2026

This rehearses the path production will actually take. Production runs `d2250c3bf2c3d76492d3078b9d8deec79c83e131` (PR #42 merge), deployed by Render's Blueprint Auto Sync ([production evidence](../../production/2026-11-04/README.md)). The candidate is `main` `fdb352c7459239da8727ee290e32265e79d29dcd` (PR #46 merge). The earlier rehearsals started from `6d9f488`, whose data has no members, two-factor enrolments or Grant Studio records. This one starts from data written by `d2250c3`.

This is local rehearsal evidence. It is **not** production evidence and does not change the production decision.

## Environment

- Linux container, Node 22.23.4 (Render and CI use 24.15), pnpm 11.16.0, PostgreSQL 16.15.
- Each commit was checked out in its own worktree and built with the Render build steps (`pnpm install --frozen-lockfile && pnpm run build`). All three builds passed.
- Production mode, as on Render:
  - `NODE_ENV=production`;
  - one empty database `rehearsal_upgrade` shared by every step;
  - one scratch disk for uploads, sources and exports;
  - `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` and `ADMIN_PASSWORD` set to random values that were never committed, and the same for every version;
  - `GIT_COMMIT` set so `/api/healthz` reports the commit.
- A local TLS proxy (`scripts/tls-proxy.mjs`) stands in for Render's edge. It serves HTTPS on 8443 and sets `X-Forwarded-Proto: https`, so the `Secure` session cookie works.
- No AI provider key was set, so `/api/readyz` returned 503 on the `configuration` check only (database and storage `ok`). The smoke runs therefore used `SMOKE_REQUIRE_READY=0`, as in the earlier rehearsals, and the smoke outline came from the app's labelled demo provider. Production has a key: readyz is 200 there.
- All data is synthetic and prefixed `[REHEARSAL]`, `[SYNTHETIC]` or `[SMOKE]`. Member emails use `example.org`.

## Steps and results

| # | Running version | What was done | Result | Files |
|---|---|---|---|---|
| 1 | `d2250c3` on an empty database | Migrations `0000`–`0024`, then the seed:<br>• the team password signs in;<br>• a brand and a guide project;<br>• a writer and a reviewer invited, each accepting with a personal password;<br>• the writer turns on two-factor (stored as `v1:`, encrypted);<br>• a synthetic publishable opportunity (inserted directly, because no API creates one);<br>• an applicant, a confirmed fact, an application, a section the writer edits, and a budget line | Seed **11/11**. Data checks **26/26**. Smoke **75/75** | `seed-output.txt`, `verify-1-…`, `smoke-1-…` |
| 2 | **Upgrade:** `fdb352c` on the same database and disk | Log: `[migrate] Migrations complete` (5 new migrations, `0025`–`0029`; the migration table went from 26 to 31 rows), `Server listening` and `Background job worker started`. Every step 1 record was then re-read:<br>• the writer signs in with password and two-factor (the secret sealed by `d2250c3` opens);<br>• a recovery code issued by `d2250c3` works once and is then refused;<br>• the reviewer signs in;<br>• the reviewer cannot invite members;<br>• anonymous requests are refused.<br>The new features also ran on the old records: the competitiveness rating and format profile compute, the "no placeholders" package check appears, an Opportunity Zone designation is recorded, a letter of support is tracked, and templates and jobs list | Data checks **28/28**. Features **11/11**. Smoke **75/75**. The only warning-or-worse log entry is the expected readiness 503 | `verify-2-…`, `features-2-…`, `smoke-2-…` |
| 3 | **Rollback:** `d2250c3` on the migrated (`0029`) database | The same data checks. Data written by `fdb352c` (designation, letter, job) is ignored | Data checks **26/26**. Smoke **75/75**. No error entries | `verify-3-…`, `smoke-3-…` |
| 4 | **Rollback:** `6d9f488` on the same database | Team password sign-in, the brand and project readable. Member sign-in correctly returns 401: that version has no members | Data checks **6/6**. Smoke **75/75**. No error entries | `verify-4-…`, `smoke-4-…` |
| 5 | **Roll forward:** `fdb352c` again | The same data checks, plus checks that the designation, the letter and the section edits survived both rollbacks | Data checks **26/26** and **3/3**. Smoke **75/75**. No error entries | `verify-5-…`, `smoke-5-…` |

After the last step no `[SMOKE]` record remained, and the database held only the rehearsal's one project and two members.

## Findings

- **The upgrade is safe for data written by the production version.** That covers members, memberships, invitations, two-factor secrets and recovery codes, the audit log, and Grant Studio applicants, facts, applications, sections and budget lines. All of it stayed readable and usable on `fdb352c`, and both roll-back targets still start on the newer schema.
- **`MFA_ENCRYPTION_KEY` must stay the same across the deploy.** Every version here used the same key, and secrets sealed by `d2250c3` opened on `fdb352c`. A different key would lock out every member who has two-factor on, which is why the runbook forbids rotating it.
- **The two-factor brute-force limit persists across restarts and versions.** The first try of step 5 (`verify-5a-…-ratelimited.txt`) got HTTP 429 on a correct code. Each verification run deliberately submits one wrong code (and step 2 also reuses a recovery code once). These failures from one address reached the limit of 5 in 15 minutes (the `rate_limit` row read `mfa|6`). This is the intended protection, stored in PostgreSQL so it survives restarts. The counter was then cleared in the rehearsal database only, and step 5 was rerun.
  - **Operator note:** during production verification, wrong codes typed from one network address count against everyone signing in from that address for 15 minutes.
- **The grant sync job behaves as designed without network access.** On `fdb352c` the startup schedule queued `grant_sync`. The job ran, both sources failed with `fetch failed` (this container cannot reach Grants.gov or `data.ca.gov`), and the queue rescheduled it for a retry. In production the sources are reachable: the 4 November sync succeeded.
- **The production version passed the smoke test here** (step 1, 75/75). This is the first smoke evidence for `d2250c3`, but it is local. Production itself still has no authenticated smoke run.

## Limits

- Node 22 locally, against 24.15 on Render.
- The data volume was small: one workspace, two members and one application. Production has 1,543 synced opportunities but, by its logs, no user activity yet.
- No AI provider key, so AI drafting and requirement extraction were not exercised. The CI suites cover them.
- `MFA_ENCRYPTION_KEY` was set throughout. Production's key is not readable from here (see the production evidence). If it were missing there, any two-factor secret would be stored as `v0:`, and the code still reads that format.

## Reproducing

`scripts/` holds the helpers exactly as run. They hard-code this session's scratch directory in `R=`, so change that line first.

| Script | Purpose |
|---|---|
| `run-server.sh` | Start one version |
| `tls-proxy.mjs` | The local TLS edge |
| `totp.mjs` | Authenticator codes |
| `seed.sh` | Step 1 seed |
| `verify.sh` | Data checks |
| `features.sh` | New-feature checks |
| `lib.sh` | Shared helpers |

The secrets and the generated `seed.env` (member passwords, the TOTP secret and a recovery code, all synthetic) were not committed.
