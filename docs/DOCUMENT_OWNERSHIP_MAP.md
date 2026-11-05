# Document Ownership Map and Authority Index

Updated 4 November 2026. Every fact has one current home. If two documents disagree, the **current** document listed here wins and the other must be corrected or labelled historical in the same PR.

## Current documents

| Document | Purpose | Owner | Change authority |
|---|---|---|---|
| `docs/PROJECT_STATUS.md` | **Single current status, release identity, gate evidence, blockers, limitations** | Program lead | Updated by every accepted work package |
| `docs/GO_NO_GO_DECISION.md` | Current decision and the exact condition for production GO | Product owner | Product owner approval |
| `README.md` | Product description, architecture, setup, tests, deploy pointer | Product owner | Approved PR |
| `AGENTS.md` | Rules for agents and contributors | Product owner | Product owner approval |
| `.cursor/rules/content-machine-governance.mdc` | Cursor pointer to `AGENTS.md` and current authority | Product owner | Product owner approval |
| `docs/PROJECT_COMPLETION_STANDARD.md` | Universal completion standard | Product owner | Product owner approval |
| `docs/DESIGN_SYSTEM.md` | Locked UI system (tokens, components, behaviour rules) | Product owner | Approved PR with accessibility gate green |
| `docs/GRANT_STUDIO.md` | Grant Studio scope, data sources, matching, approvals, operation and tests | Product owner / maintainers | Approved PR |
| `docs/BILLING.md` | Plans, limits, trials, Stripe Checkout, portal and webhook, and the owner's steps to switch billing on | Product owner | Approved PR |
| `docs/BACKGROUND_JOBS.md` | Background job queue, worker, job kinds and operation | Technical lead | Approved PR |
| `docs/GRANT_RESOURCES.md` | Grant directory scope, source provenance, maintenance and limits | Product owner / maintainers | Approved PR |
| `docs/GRANT_PLATFORM_PLAN.md` | Proposed plan for grant discovery, matching, writing studio and assisted submission for nonprofits and businesses; phases and owner decisions | Product owner | Product owner approval |
| `docs/CI.md` | CI contract for PRs to `main` | Technical lead | Approved PR |
| `docs/BRANCH_AND_PR_POLICY.md` | Branching and PR requirements | Technical lead | Approved PR |
| `docs/DEPLOYMENT_AND_RECOVERY_RUNBOOK.md` | Deploy, verify, release, rollback, backup, restore, DR, decommission | Operator | Approved PR |
| `docs/ADMIN_OPERATIONS_MANUAL.md` | Ownership, operations, integrations, monitoring, billing/dependency register | Operator | Approved PR |
| `docs/SECURITY_AND_ACCESS_HANDOFF.md` | Account model, roles, provisioning, offboarding, secrets, controls | Product owner | Product owner approval |
| `docs/DATA_LIFECYCLE_AND_OFFBOARDING.md` | Data inventory, export, deletion, retention, offboarding | Product owner | Approved PR |
| `docs/TROUBLESHOOTING_AND_SUPPORT.md` | Support path and symptom fixes | Operator | Approved PR |
| `docs/CLIENT_USER_MANUAL.md` | End-user guide | Product owner | Approved PR |
| `docs/CLIENT_ACCESS_HANDOFF_TEMPLATE.md` | Template filled at client handoff (outside the repo) | Operator | Approved PR |
| `docs/FINAL_CLIENT_ACCEPTANCE.md` | Acceptance checklist and sign-off | Product owner | Product owner |
| `docs/automation-api.md` | Automation API and webhook contract | Technical lead | Approved PR |
| `docs/engineering-standards.md` | Access-first, reuse-first engineering rules | Technical lead | Approved PR |
| `docs/decisions/*` | Recorded technical decisions | Technical lead | Approved PR |
| `docs/evidence/release/2026-10-02/`, `docs/evidence/release/2026-11-04/`, `docs/evidence/ui/closeout-2026-10-02/`, `docs/evidence/grants/2026-11-02/`, `docs/evidence/grant-studio/2026-11-03/`, `docs/evidence/accounts/2026-11-04/`, `docs/evidence/jobs/2026-11-04/`, `docs/evidence/templates/2026-11-04/`, `docs/evidence/toolkit/2026-11-04/`, `docs/evidence/production/2026-11-04/`, `docs/evidence/upgrade/2026-11-04/`, `docs/evidence/smoke/2026-11-05/`, `docs/evidence/predeploy/2026-11-05/`, `docs/evidence/security/*` | Closeout, release-candidate, feature and security evidence | Program lead | Append-only |
| `render.yaml`, `.env.example` | Deployment blueprint and configuration template | Technical lead | Approved PR |

Section 40 of the completion standard names `docs/PROJECT_CLOSEOUT_STATUS.md`; that role is filled by `docs/PROJECT_STATUS.md` so there is only one status record.

## Historical documents (superseded; evidence only)

These describe earlier stages. Each carries a "historical" banner pointing here. Do not update them to look current; do not act on their instructions.

| Document | What it records |
|---|---|
| `docs/history/PROJECT_STATUS_2026-09-24_PRE_CLOSEOUT.md` | Pre-closeout status, product strategy and competitive analysis (PR #11 era) |
| `docs/history/GO_NO_GO_DECISION_2026-08-12.md` | 12 Aug 2026 closeout authorisation |
| `docs/history/GO_NO_GO_DECISION_2026-10-02.md` | 2 Oct 2026 decision (release candidate GO; production NO-GO pending Render creation) |
| `docs/history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md` | 2 Oct 2026 status, evidence matrix and release history, before the October dependency repairs |
| `docs/history/PROJECT_STATUS_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md`, `docs/history/GO_NO_GO_DECISION_2026-11-04_PRE_GRANT_STUDIO_RECONCILIATION.md` | Early 4 Nov 2026 status and decision (`main` described as `3221c7b`; superseded the same day after PRs #29–#45 merged) |
| `docs/history/PROJECT_STATUS_2026-11-04_PRE_PRODUCTION_RECONCILIATION.md`, `docs/history/GO_NO_GO_DECISION_2026-11-04_PRE_PRODUCTION_RECONCILIATION.md` | 19:50 UTC 4 Nov 2026 status and decision (production described as `6d9f488` after `d2250c3` had already been deployed; `main` as `997b735`) |
| `docs/history/PROJECT_STATUS_RECOVERY_BASELINE.md` | Recovery-baseline status |
| `docs/PROGRAM_CHARTER.md`, `docs/STAGE_0_EXECUTION_PLAN.md`, `docs/REPOSITORY_BASELINE.md`, `docs/governance/GOVERNANCE_BASELINE.md`, `prompts/CURSOR_MASTER_ORCHESTRATOR.md` | Stage 0 planning and governance (July–August 2026) |
| `docs/recovery/*`, `RECOVERY_PROVENANCE.md` | Replit source recovery (August 2026) |
| `PROJECT_CLOSEOUT.md`, `replit.md` | Replit-era handoff notes and agent memory |
| `closeout-browser-auth-evidence.md`, `closeout-visual-evidence.md`, `docs/evidence/ui/README.md` and the top-level `docs/evidence/ui/*.png` | August–September 2026 local QA evidence of the earlier light UI |
| `docs/content-os-audit.md`, `docs/milestone-report.md` | August 2026 audit and milestone reports |
| `.github/workflows/recovery-baseline-validation.yml` | Recovery-branch CI (not a `main` gate) |

## Rule

When a governing rule or fact changes, replace the complete current document and update this index. Do not leave fragmented amendments or competing sources of truth.
