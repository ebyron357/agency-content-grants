# Production smoke test: Grant Studio, workspace and jobs checks, 5 November 2026

`tests/production-smoke.sh` gains section 8, "Grant Studio, workspace and background jobs", and five more anonymous-rejection probes. Until now the script checked only the Content Machine flows, so a production run would have passed without touching anything added since `6d9f488`.

This is local evidence that the script works against a production-mode build of `main` `3dc6da0` (code identical to `fdb352c`). It is not production evidence.

## What the new section checks

| Area | Checks |
|---|---|
| Grant data | `/grants/meta` returns 200. It records the publishable opportunity count by source, the last sync run, whether a sync is queued, and the AI provider. By default it **requires** at least one publishable opportunity and a last sync run that did not fail. `SMOKE_REQUIRE_GRANTS=0` records them without enforcing, for rehearsals without outbound access |
| Grant Studio | Opportunities list and templates list. A `[SMOKE]` organization is created and read back. An unconfirmed fact persists. A place designation is recorded (`not_in`) and persists. Matching runs. The organization is deleted and then returns 404 |
| Workspace | The team password session is `owner`. A viewer invitation to `smoke-<stamp>@example.invalid` resolves for an anonymous visitor, is withdrawn, and then returns 404. The audit log records it |
| Jobs | `/jobs` is refused before admin elevation and allowed after it. The worker is enabled. Job counts and recent grant-sync jobs are recorded. The session is admin-locked again |
| Anonymous | `/grants/applicants`, `/grants/opportunities`, `/workspace`, `/workspace/audit` and `/jobs` return 401 |

**What it deliberately leaves out:**

- It starts no application, and records no eligibility confirmation, fact confirmation or approval.
- It accepts no invitation, so no member account is created. No email is sent, because invitations are links.
- It submits no two-factor code: wrong codes count toward the per-address sign-in limit.
- Member sign-in and two-factor are covered by CI and the upgrade rehearsal ([`../../upgrade/2026-11-04/`](../../upgrade/2026-11-04/README.md)).

**What stays behind:** the cleanup deletes every `[SMOKE]` record, including the organization and the invitation if a run stops early. The audit log is append-only, so it keeps one "invited as viewer" entry naming the `example.invalid` address per run.

## Runs

Setup:

- `main` `3dc6da0` built with the Render build steps.
- `NODE_ENV=production` on an empty PostgreSQL 16 database.
- A local TLS proxy setting `X-Forwarded-Proto: https`.
- No AI key, so every run used `SMOKE_REQUIRE_READY=0` and the outline came from the labelled demo provider.
- No outbound access to the grant sources.

| File | Grant data in the database | `SMOKE_REQUIRE_GRANTS` | Result |
|---|---|---|---|
| `smoke-run1-empty.txt` | None (as in CI) | `0` | **101 passed, 0 failed** |
| `smoke-run2-nodata.txt` | None | default (`1`) | 102 passed, **1 failed**: "Grant sources have publishable opportunities", as intended |
| `smoke-run3-failedsync.txt` | One synthetic publishable opportunity; last sync run `failed` | default | 102 passed, **1 failed**: "The most recent grant sync run did not fail", as intended |
| `smoke-run4-healthy.txt` | The same opportunity; last sync run `succeeded` | default | **103 passed, 0 failed** |

After the four runs, the database held:

- 0 `[SMOKE]` organizations, 0 facts and 0 `[SMOKE]` projects;
- 0 open invitations (4 created, all withdrawn);
- 0 members.

The synthetic opportunity and sync-run rows were inserted directly into the scratch database, which was then dropped.

## Limits

- Node 22 locally, against 24.15 on Render. `shellcheck` is not installed here. `bash -n` passes.
- The abort path (cleanup after a run stops partway) was not forced in a run. It uses the same `trap` cleanup as the existing project and brand records.
- Run the script from the deployed commit. Section 8 needs `fdb352c` or later: `/grants/templates` and `/jobs` do not exist on `d2250c3`.
