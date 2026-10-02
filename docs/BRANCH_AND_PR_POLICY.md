# Branch and Pull Request Policy

Current policy (2 October 2026). Merge and production gates are defined in `AGENTS.md`; this file covers the mechanics.

## Workflow

1. Begin from current `main`.
2. Use one focused branch per work package. Never commit directly to `main`.
3. Open a pull request with evidence, acceptance results, risks and the next action.
4. Keep the required **CI** check green (`docs/CI.md`); fix failures at the cause.
5. Merge only when the `AGENTS.md` merge gate passes, using a merge commit (no force-push or bypass).
6. Production deploys are separate, manual Render deploys of a reviewed `main` commit (`docs/DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`).
7. Human approval is required for governance decisions, material architecture or cost changes, accepted residual high risks, and production GO.

## Branch naming

- `feat/<description>`, `fix/<description>`, `docs/<description>`, `ci/<description>` for human work
- Agent-created branches may use the agent's naming (for example `claude/<name>`), one branch per PR

## Pull-request requirements

Every PR must identify:

- Scope and linked issue
- Files changed
- Tests and validation actually run, with results
- Acceptance criteria passed or failed
- Security, data, cost and tenant-isolation implications
- Documentation updated (`docs/PROJECT_STATUS.md` when operational state changes)
- Exact next action

## Merge standard

A PR may merge only when its claims are supported by repository evidence and all required human gates are satisfied. Missing evidence must be recorded as a blocker, never filled with invented completion.
