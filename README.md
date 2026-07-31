# Agency Content and Grant Intelligence Platform

Evidence-first, multi-tenant platform for agency content production, grant research, proposal workflows, review, approval, and client delivery.

## Current status

**Stage 0 — strategically approved, implementation deferred.**

No production implementation may begin until the Stage 0 governance, licensing, architecture, security, benchmark, budget, and pilot gates are completed and the final go/no-go decision is recorded.

## Proposed architecture under review

- Payload — control plane and content administration
- PostgreSQL — system of record
- Temporal — durable execution
- LangGraph — AI workflow orchestration
- n8n — external integrations

These are proposals, not approved dependencies.

## Repository workflow

1. Read `AGENTS.md` before doing any work.
2. Read `docs/PROGRAM_CHARTER.md` and `docs/STAGE_0_EXECUTION_PLAN.md`.
3. Execute only the currently authorized work package.
4. Record evidence and decisions in repository documents.
5. Open a pull request; never merge or deploy automatically.

## Stage 0 deliverables

- Governance and customer definition
- Repository and licensing audit, including SBOMs
- Architecture decision records
- Threat model and security proof-of-concept plan
- Product pilot definition
- Benchmark corpus and release rubric
- Monthly operating budget and revenue target
- Final implementation approval or rejection

## Cursor entry point

Use `prompts/CURSOR_MASTER_ORCHESTRATOR.md` as the Cloud Agent or Automation prompt.

The agent must stop at human-approval gates and must not begin application implementation until Stage 0 is explicitly approved.