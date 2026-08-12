# GO / NO-GO Decision

## Decision summary

| Field | Decision |
|---|---|
| Decision | **LIMITED GO — recovery-baseline stabilization only** |
| Human owner | Emmanuel Andre Byron (`ebyron357`) |
| Approval date | 2026-08-12 |
| Authorized baseline | `recovery/replit-content-machine-source` at `fba398e2945fc39405b9bdf2543b28df4aac65ee` |
| Authorized work branch | `fix/recovery-baseline-validation` |
| Stabilization PR | PR #5 |
| Initial stabilization commit | `53fab703391edab15ad5da9c1403b7a47bf338cb` |
| Product implementation | **NO-GO / deferred** |
| Deployment | **NO-GO** |

## Human authorization record

The human owner explicitly authorized recovery-baseline stabilization after the
Replit source archive was recovered into GitHub. The authorization was provided
in the project communication on 2026-08-12 and subsequently reaffirmed by the
owner's directive to address every unresolved PR #5 review thread, rerun the
complete validation gate, update PR #5, and continue the recovery merge sequence
only if all gates pass.

This repository artifact records that approval so the exception is traceable
under `AGENTS.md`. It does not convert the broader Stage 0 program into a product
implementation GO.

## Authorized scope

The owner authorized only the work required to make the recovered baseline
executable, reproducible, and evidence-backed:

- Repair recovered TypeScript errors at their causes.
- Establish a disposable PostgreSQL test database and safety guards.
- Reset and replay migrations against isolated test data.
- Repair and strengthen the test harness, including export verification.
- Run frozen installation, typecheck, API tests, Content OS tests, integration
  tests, migrations, production build, service lifecycle checks, and secret scan.
- Make recovery-blocking build and test configuration corrections.
- Maintain recovery provenance, validation evidence, and governing status.
- Commit and push the scoped stabilization changes to PR #5.
- Reply to and resolve review threads only after their requested changes are
  implemented and verified.
- Merge PR #5 and then PR #4 only when all review, protection, validation, and
  secret-scan gates pass without bypass.

## Prohibited scope

The following remain prohibited:

- New CMS, grant, publishing, editor, media, video, or other product features.
- UI redesign or product expansion.
- Production deployment or modification of the former Replit deployment.
- Production, customer, Replit, or shared-development database access.
- Removal or consolidation of preserved recovered application trees.
- Weakening compiler settings, tests, security controls, or quality gates.
- Skipping checks, hiding failures, dismissing actionable feedback, force
  merging, or bypassing branch protection.
- Deleting recovery or stabilization branches as part of this authorization.
- Committing secrets, credentials, private customer data, or real production
  configuration.

## Evidence and conditions

The limited GO is conditioned on all of the following:

1. The disposable-database guards remain active and tested.
2. Every required validation command executes without hidden skips.
3. Review feedback is addressed at its cause and resolved with evidence.
4. Secret scanning remains clean.
5. No deployment occurs.
6. Any merge occurs only after GitHub reports a clean, mergeable PR with green
   required checks and zero unresolved review threads or requested changes.

Executable evidence is maintained in
`docs/recovery/RECOVERY_VALIDATION.md`. Recovery provenance is maintained in
`RECOVERY_PROVENANCE.md`.

## Final gate

**LIMITED GO** applies only to recovery-baseline stabilization and its gated
merge sequence. All broader application implementation and every deployment
remain **NO-GO** until a separate human-approved decision replaces this document.
