# AGENTS.md

## Mission

Build an evidence-first, secure, multi-tenant Agency Content and Grant Intelligence Platform only after Stage 0 is approved.

## Current authorization

Stage 0 research, governance, architecture, security planning, benchmarking, budgeting, and pilot definition only.

Application implementation is prohibited until `docs/GO_NO_GO_DECISION.md` records an explicit **GO** approved by a human owner.

## Non-negotiable rules

1. Read the full repository before changing files.
2. Treat repository documents as the canonical source of truth.
3. Never invent completed evidence, tests, benchmarks, licenses, costs, customer facts, or approvals.
4. Distinguish verified facts, assumptions, recommendations, and unresolved decisions.
5. Cite primary sources for licensing, security, standards, products, grants, and technical claims.
6. Record URLs, publisher or owner, publication date when available, and retrieval date.
7. Never use client data from one tenant to answer or train workflows for another tenant.
8. Never commit secrets, credentials, private client data, regulated data, or copyrighted source snapshots without authorization.
9. Never deploy, merge to `main`, purchase services, change billing, or modify production systems.
10. Work in a dedicated branch and open a pull request.
11. Run applicable validation before declaring a deliverable complete.
12. Stop at every human-approval gate.

## Required work method

For each work package:

1. Confirm prerequisites.
2. Inspect existing documents and avoid duplicate or conflicting sources of truth.
3. Produce the complete deliverable, not a fragment.
4. Add an evidence table.
5. Add assumptions and unresolved questions.
6. Add acceptance-criteria results.
7. Update `docs/PROJECT_STATUS.md`.
8. Open a focused pull request.

## Decision labels

Every evaluated technology or proposal must receive one decision:

- `ADOPT`
- `PILOT`
- `REPLACE`
- `REJECT`
- `DEFER`

Each decision must include rationale, evidence, risks, conditions, owner, and review date.

## Completion standard

A checkbox may be marked complete only when:

- The named artifact exists.
- Its evidence is traceable.
- Acceptance criteria are explicitly evaluated.
- Contradictions are resolved or visibly recorded.
- Required human approval is documented.

## Stage 0 stop condition

After completing Stage 0, produce `docs/GO_NO_GO_DECISION.md` and stop. Do not scaffold or implement the application unless that document contains a human-approved `GO`.