# Production observation, 4 November 2026

Observed between 23:00 and 23:25 UTC through the Render API (read-only calls: services, deploys, events, logs, metrics). No deploy, restart, environment change or other write was made. The agent environment cannot reach `agency-content-grants.onrender.com` directly (the network proxy returns 403), so `/api/healthz` and the security headers were **not** re-checked over HTTP, and no smoke test was run.

## Finding: production changed without a manual deploy

The status records written at 19:50 UTC said production was on `6d9f488`. That was already out of date. Render's deploy list for service `srv-dbcl40dg1s2s73dln6g0` (`agency-content-grants`, workspace "My Workspace"):

| Deploy | Commit | Trigger | Started (UTC) | Finished (UTC) | Status |
|---|---|---|---|---|---|
| `dep-dbllkrpsrm7s73evachg` | `d2250c3bf2c3d76492d3078b9d8deec79c83e131` (merge of PR #42) | `blueprint_sync` | 16:16:47, 4 Nov | 16:18:35, 4 Nov | **live** |
| `dep-dbefpku7bikc738ac310` | `6d9f4887a28d8caec52e2e32c11e61d4a74059f4` (merge of PR #23) | `api` | 18:45:39, 24 Oct | 18:47:22, 24 Oct | deactivated 16:18:35, 4 Nov |
| `dep-dbcl40tg1s2s73dln7v0` | `d9a06e715ed0cbb0ad399addd7cb6ba0b02cf0ef` (merge of PR #21) | `blueprint_sync` | 00:00:03, 22 Oct | 00:01:41, 22 Oct | deactivated |

The service event for the 4 November deploy records `manual: false`, `deployedByRender: false`, `rollback: false`. The service settings are `autoDeploy: no` and `autoDeployTrigger: off`.

**Cause.** PR #42 (merged 16:16:42 UTC) is the first change to `render.yaml` since 21 October. It added one variable:

```yaml
      - key: MFA_ENCRYPTION_KEY
        generateValue: true
```

Render's Blueprint documentation says: "Each push to the linked branch that modifies your Blueprint file triggers a deploy of any added or modified resources", and "By default, Render automatically updates affected resources every time you push Blueprint changes to your linked branch. To instead control exactly when you sync a particular Blueprint, set Auto Sync to No on your Blueprint's Settings page" ([Render Blueprints](https://render.com/docs/infrastructure-as-code#disabling-automatic-sync), read 4 November 2026). `autoDeployTrigger: off` only controls deploys on ordinary commits. So the Blueprint's Auto Sync deployed `d2250c3`. The 22 October deploy of PR #21, which also changed `render.yaml`, has the same trigger. PRs #43–#46 did not change `render.yaml`, so they were not deployed.

No agent and no person triggered this deploy. It skipped the production gate in `AGENTS.md`: there was no owner approval of the security model, no confirmed backup before the migrations, and no smoke test.

## What production runs

`d2250c3` contains PRs #24, #26, #29–#35 and #37–#42: the grant directory, Grant Studio (discovery, readiness, matching, alerts, deadlines, fact library, grounded drafting, budgets, approvals, packages, saved writing, outcomes), workspaces and members, per-role permissions, two-factor sign-in, sign-out everywhere and the audit log. It does **not** contain PRs #43–#46: the job queue, editable templates, AI work as jobs, place designations, the writing toolkit and the competitiveness rating.

## Runtime evidence from the Render logs

| Time (UTC, 4 Nov) | Log line |
|---|---|
| 16:17:47 | `==> Deploying...` |
| 16:18:25 | `[migrate] Applying pending migrations from /opt/render/project/src/artifacts/api-server/dist/drizzle` |
| 16:18:25 | `[migrate] Migrations complete` (migrations `0016`–`0024`) |
| 16:18:26 | `"msg":"Server listening"`, port 10000 |
| 16:18:34 | `GET /api/readyz` 200 |
| 16:18:35 | `==> Your service is live` |
| 16:20:07 | `[grants-sync] grants.gov status=succeeded fetched=1387 upserted=1387 details=1342` |
| 16:20:08 | `[grants-sync] california status=succeeded fetched=156 upserted=156` |
| 18:18:54 | One `"level":40` `Readiness check failed` with `"storage":"failed"`, then `GET /api/readyz` 503. The next checks returned 200 again |

- The previous instance stopped with `Command failed with signal "SIGTERM"` at 16:17:52. That is Render replacing the instance, not a crash.
- A search of the app logs from 16:18 to 23:19 UTC for `"level":50`, `"level":60`, `"level":40`, `rror` and `MFA` found only the 18:18:54 readiness pair above.
- The same window showed no requests other than Render's `/api/readyz` and `HEAD /` checks. That suggests nobody has used the new version yet; the search was by URL pattern and is not proof.
- The first live grant sync **succeeded**. This was unverified before, because the build environment could not reach Grants.gov or `data.ca.gov`.

## Memory

Render `memory_usage`, 30-minute samples: 266 MB at 16:30 rising slowly to 282 MB at 22:30 and 23:00, against a 512 MB limit (`0.5c-512mb`). The earlier capacity estimate of about 220 MB headroom holds after the first sync.

## Not verified

- `/api/healthz` commit parity over HTTP, the security headers, and anything behind sign-in. The Render deploy record is the only evidence of the running commit.
- Whether the Blueprint sync created `MFA_ENCRYPTION_KEY`. Render generates a value for a new `generateValue` key, and PR #42 added nothing else, so it very probably exists. The Render API available here cannot read environment variables, so the owner must confirm it under Render → Environment **before anyone turns on two-factor**.
- The cause of the single storage readiness failure at 18:18:54.
- Whether a database backup exists from before 16:16 UTC.
