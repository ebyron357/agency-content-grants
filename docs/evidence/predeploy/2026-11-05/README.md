# Pre-deploy checks, 5 November 2026

These are the agent-side checks before deploying `main` to production. They were taken through read-only Render API calls and local commands between 02:30 and 02:45 UTC. No deploy, restart, setting or environment change was made. This environment cannot reach the production URL, so none of these checks are HTTP probes of production.

## 1. Dependency audit

`pnpm audit --audit-level=high` on `main` `08df8bbb130c74343437529a80eb4cfa4719af85` **passes**. The output is in `audit.json`.

| Severity | Count |
|---|---|
| critical | 0 |
| high | 0 |
| moderate | 1 |
| low | 0 |

The moderate advisory is the known one: `minimatch` ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)), reached only through `orval` → `typedoc`, a development and code-generation tool. It stays DEFER. PR #50 does not change `package.json` or `pnpm-lock.yaml`, so the result also holds for its merge.

## 2. Production database

Read from the Render API (`list_postgres_instances`):

| Field | Value |
|---|---|
| Name | `agency-content-grants-db` |
| Plan | `0.1c-256mb` (a paid instance) |
| PostgreSQL | 18 |
| Status | available, not suspended |
| Disk | 15 GB, autoscaling on |
| High availability | off |
| Read replicas | none |

The API does not report whether point-in-time recovery is on, or how far back it reaches. The owner confirms that, or takes a logical backup, in the dashboard before the deploy (runbook §7).

## 3. Production baseline (`d2250c3`)

| Check | Result |
|---|---|
| Live deploy | Unchanged: `dep-dbllkrpsrm7s73evachg`, `d2250c3`, live since 16:18 UTC on 4 November. No later deploy, failure or restart event |
| Memory | Hourly samples of 281.5, 282.2, 283.0 and 283.6 MB (23:00 to 02:00 UTC), against 512 MB. Slowly rising, about 0.7 MB an hour, so it is worth watching after the deploy |
| Warnings and errors since 23:19 UTC on 4 November | Only the storage readiness failures in section 4. No `"level":50` or `"level":60` entries |
| Traffic | Only Render's health checks. No user requests were found by URL pattern |

## 4. Storage readiness failures: root cause and fix (PR #50)

`/api/readyz` returned `503` with `"storage":"failed"` for a single check at each of these times (UTC). Each recovered on the next check, and none caused a restart.

| Time | Notes |
|---|---|
| 18:18:54, 4 Nov | — |
| 23:19:54, 4 Nov | Two failures, requests 5905 and 5906. Both started at `…394823` (log time minus response time: 870 − 47 and 883 − 60) |
| 00:13:54, 5 Nov | — |
| 00:42:54, 5 Nov | — |
| 02:08:54, 5 Nov | — |
| 02:16:54, 5 Nov | — |

**Cause.** `lib/readiness.ts` proves each storage directory is writable by creating `.readiness-<pid>-<Date.now()>` with an exclusive create (`"wx"`), then deleting it. Render sends health checks in pairs a few milliseconds apart. When two start in the same millisecond, they use the same file name. The second create fails with `EEXIST`, so storage reports `failed`.

**Fix (PR #50).** The probe name uses `randomUUID()`.

**Reproduction.** A new unit test runs 8 checks with `Date.now()` pinned to one millisecond, against real temporary directories.

- Before the fix, 7 of 8 report storage `failed`.
- After the fix, all 8 pass, and no probe file remains.

**Validation of PR #50:**

- Typecheck passes.
- Unit tests: 239/239.
- DB-backed tests: 458/458.
- The production build passes.
- `tests/integration-tests.sh`: 40/40 against the built API.
- 10 concurrent `/api/readyz` requests all returned 200.

## Not checked here (owner)

- Blueprint Auto Sync setting.
- `MFA_ENCRYPTION_KEY` presence.
- Point-in-time recovery or a backup.
- Production over HTTP (`/api/healthz`, headers, smoke test).
