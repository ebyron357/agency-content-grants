# Closeout evidence — 2 October 2026

Release candidate: `2857cada58043e3acf2c5f8688bcb0a2867a5077` (branch `claude/clever-thompson-k8nnle`, PR #16). Summary and verdict: [`docs/PROJECT_STATUS.md`](../../../PROJECT_STATUS.md).

| File | What it proves | Level |
|---|---|---|
| [`local-release-gates.txt`](local-release-gates.txt) | Every CI step re-run locally at the candidate: frozen install, format, typecheck, API unit 116/116, DB prep, API 292/292, frontend 21/21, builds, integration 40/0/0, accessibility gate, `pnpm audit` (0), gitleaks (no leaks), production build | Local |
| [`production-mode-boot.txt`](production-mode-boot.txt) | Fresh database: migrations applied at startup; `/api/healthz` reports the candidate commit; `/api/readyz` is `not_ready` without a provider key and `ready` with one | Rehearsal |
| [`production-mode-smoke.txt`](production-mode-smoke.txt) | `tests/production-smoke.sh` against the production-mode build behind TLS: 56 passed, 0 failed, all `[SMOKE]` records deleted | Rehearsal |
| [`production-mode-smoke-negative-provider-check.txt`](production-mode-smoke-negative-provider-check.txt) | With a deliberately invalid provider key the smoke fails loudly (43 passed / 14 failed) and still cleans up — the script cannot pass on a broken provider. Recorded at `d4d3941`; the smoke script is unchanged in the candidate | Rehearsal |
| [`restart-persistence-and-rollback.txt`](restart-persistence-and-rollback.txt) | Project, rich HTML and image survive a full restart (identical SHA-256); previous `main` build `fac3cb9` serves the same data from the same database and disk; roll-forward restores the candidate | Rehearsal |

Rehearsal environment: Node 24.15.0, pnpm 11.16.0, PostgreSQL 16.14, `NODE_ENV=production`, `UPLOAD_DIR`/`SOURCE_UPLOAD_DIR`/`EXPORT_DIR` on a separate data directory, generated `SESSION_SECRET` and `ADMIN_PASSWORD`, and a local TLS proxy that sets `X-Forwarded-Proto: https` as Render's edge does. Secrets were generated for the rehearsal and are not recorded.

CI runs on PR #16: [CI 36971039379](https://github.com/ebyron357/agency-content-grants/actions/runs/36971039379) and [closeout validation 36971039397](https://github.com/ebyron357/agency-content-grants/actions/runs/36971039397) at `d4d3941`; later runs on the PR head are listed on the PR's **Checks** tab.

## Visual evidence

[`docs/evidence/ui/closeout-2026-10-02/`](../../ui/closeout-2026-10-02/) — desktop (1440×900, full page) and mobile (390×844) screenshots of the running product: login, Dashboard, Create, Documents, Project overview, Editor, Sources, Quality, Export, Brands, Brand detail, Distribution, Performance, Settings, 404, mobile Dashboard/Create/Documents/Editor and the collapsed navigation rail. `before/` shows the split light/dark UI that Issue #8 required removing. Captured at `d4d3941`; the only frontend change in `2857cad` adds accessible names (no visual change).

## Production evidence

None yet — production has not been created. Add the production smoke log, Render deploy ID and URL here after the owner action in `docs/GO_NO_GO_DECISION.md`.
