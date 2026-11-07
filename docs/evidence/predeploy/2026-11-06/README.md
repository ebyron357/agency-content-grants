# Pre-deploy record refresh, 6 November 2026

Agent-side checks taken on 6 November 2026 to refresh the status records after PRs #50, #51 and #27 merged. They used read-only GitHub calls and local `git` and `pnpm` commands. No deploy, restart, setting, secret or environment change was made. This environment cannot reach the production URL or the Render API, so **production state was not re-observed**: the production facts in the status records still come from the 4–5 November evidence.

## 1. Deploy candidate identity

| Commit | What it is | Evidence |
|---|---|---|
| `ee7b5c8bf9c46dc3c447629e616ca6adb6c7e5cd` | Merge of PR #50 (readiness-probe fix), 02:58 UTC 5 November | Its tree (`1ea2def`) is identical to PR #50's head, on which CI passed: "Format, typecheck, tests, build" and "Secret scan, dependency audit, SBOM" ([run 41956904789](https://github.com/ebyron357/agency-content-grants/actions/runs/41956904789)) and "validate" ([run 41956904756](https://github.com/ebyron357/agency-content-grants/actions/runs/41956904756)) |
| `1ff0c1fe943ba794e17d6c42d2941d11194412cd` | Merge of PR #51 (test isolation), 03:03 UTC 5 November | Its tree (`131150e`) is identical to PR #51's head `6c5220f`, on which CI passed ([run 41958676866](https://github.com/ebyron357/agency-content-grants/actions/runs/41958676866), validate [run 41958676898](https://github.com/ebyron357/agency-content-grants/actions/runs/41958676898)) |
| `0e4f5982640129152575187ffafed06acea638b2` | Merge of PR #27 (grant platform plan, docs only), 19:41 UTC 5 November; `main` on 6 November | `1ff0c1f` plus `docs/GRANT_PLATFORM_PLAN.md` and one line in `docs/DOCUMENT_OWNERSHIP_MAP.md`. CI ran on PR #27's older head, not on this tree |

`git diff ee7b5c8 0e4f598` outside `docs/` changes only `artifacts/api-server/src/routes/grants.integration.test.ts`. The non-test application source, `package.json` files, `pnpm-lock.yaml`, migrations and `render.yaml` are identical. Deploying `ee7b5c8` or `0e4f598` therefore runs the same application code: `fdb352c` plus the readiness-probe fix.

## 2. Dependency audit

`pnpm audit` on `main` `0e4f598` (output in `audit.json`): 0 critical, 0 high, 1 moderate, 0 low. `pnpm audit --audit-level=high` exits 0. The moderate advisory is the known `minimatch` 10.2.5 ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)), reached only through `orval` → `typedoc` (development and code generation). It stays DEFER.

## 3. Open pull requests (not merged)

| PR | Opened | Migration | Changes `render.yaml` | Dependencies | CI on head |
|---|---|---|---|---|---|
| [#55](https://github.com/ebyron357/agency-content-grants/pull/55) Billing: plans, trials and Stripe (off until configured) | 22:48 UTC 5 Nov | `0033_billing_plans` | No | `api-server/package.json`, lockfile | Green ([run 42124652951](https://github.com/ebyron357/agency-content-grants/actions/runs/42124652951)) |
| [#56](https://github.com/ebyron357/agency-content-grants/pull/56) Grant source registry, page watcher, draft review queue | 22:59 UTC 5 Nov | `0031_source_registry` | No | none | Green ([run 42127029253](https://github.com/ebyron357/agency-content-grants/actions/runs/42127029253)) |
| [#57](https://github.com/ebyron357/agency-content-grants/pull/57) Notice PDF reading and cited requirement checklist | 23:00 UTC 5 Nov | `0032_grant_notice_checklist` | No | `api-server` and `content-os` `package.json`, lockfile | Green ([run 42126198252](https://github.com/ebyron357/agency-content-grants/actions/runs/42126198252)) |
| [#58](https://github.com/ebyron357/agency-content-grants/pull/58) Foundation giving history (funder-graph import) | 23:34 UTC 5 Nov | `0030_foundation_giving` | No | `api-server/package.json`, lockfile | Green ([run 42130464787](https://github.com/ebyron357/agency-content-grants/actions/runs/42130464787)) |
| [#54](https://github.com/ebyron357/agency-content-grants/pull/54) `[WIP] Copilot Request` (draft, for Issue #53 under #52) | 20:10 UTC 5 Nov | none | No | none | — |

Each of #55–#58 branches from `main` at `0029` and adds an entry to `lib/db/drizzle/meta/_journal.json`, so after the first one merges the others need a rebase and a fresh CI run. Each green CI result covers only that PR on its own, not any combination. None of them has been through an upgrade or rollback rehearsal.

## 4. Review records

PRs #50 and #27 have zero reviews. The merge-record finding in `PROJECT_STATUS.md` (no PR reviews; no written owner approval) still holds.
