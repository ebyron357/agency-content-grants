# Repository Baseline

## Canonical repository

- Repository: `ebyron357/agency-content-grants`
- Default branch: `main`
- Visibility: Public
- Canonical status: Confirmed for Stage 0 governance and planning

## Baseline state

The repository began as an empty project with only a one-line README. PR #1 established the Stage 0 governance foundation. No production application, dependency manifest, deployment configuration, database schema, benchmark corpus, or client data currently exists.

## Current repository structure

- `README.md` — project overview and Stage 0 gate
- `AGENTS.md` — repository-wide agent operating rules
- `.cursor/rules/` — Cursor-specific governance controls
- `docs/PROGRAM_CHARTER.md` — program intent and boundaries
- `docs/STAGE_0_EXECUTION_PLAN.md` — ordered Stage 0 work packages
- `docs/PROJECT_STATUS.md` — canonical status tracker
- `prompts/CURSOR_MASTER_ORCHESTRATOR.md` — autonomous-agent work order

## Confirmed constraints

- Production implementation remains prohibited until Stage 0 receives a documented human-approved GO decision.
- Candidate technologies are not approved dependencies.
- Real confidential, regulated, or client data may not be used during Stage 0.
- Autonomous agents may create branches and pull requests but may not merge automatically.

## Missing technical artifacts

The following do not yet exist and must not be implied to exist:

- Application source code
- Package lockfiles
- SBOM
- License inventory
- Architecture decision records
- Threat model
- Tenant-isolation proof
- Evaluation corpus
- Cost model
- Pilot scope
- Deployment environment

## WP-00 conclusion

The repository baseline is established and suitable for controlled Stage 0 research. It is not implementation-ready.