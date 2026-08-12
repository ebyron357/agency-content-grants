# Project Status

## Overall status

The authoritative Replit Content Machine source has been recovered on
`recovery/replit-content-machine-source` at commit
`fba398e2945fc39405b9bdf2543b28df4aac65ee`. The owner has authorized only the
baseline stabilization needed to make that recovery executable and
evidence-backed. Product implementation remains deferred.

## Current gate

Recovery baseline validation on `fix/recovery-baseline-validation`. The local
frozen install, repository-wide typecheck, Content OS tests, and aggregate
production build pass. PostgreSQL-backed API and integration validation runs in
the isolated GitHub Actions environment defined by
`.github/workflows/recovery-baseline-validation.yml`; its final evidence must be
recorded before the gate can pass.

## Recovered baseline

- The preserved application workspaces include `artifacts/content-os`,
  `artifacts/api-server`, `artifacts/mockup-sandbox`, `lib/db`, `lib/api-spec`,
  `lib/api-client-react`, and `lib/api-zod`.
- Repository governance predates the recovery and remains in force.
- The recovery archive contains no Git history and cannot prove the deployed
  Replit SHA. See `RECOVERY_PROVENANCE.md`.
- Replit is not an authorized development or deployment target. No recovery or
  stabilization work has deployed or modified a Replit project.

## Stabilization authorization and evidence

Authorized baseline-only repairs:

- Correct the eight recovered `mockup-sandbox` TypeScript errors at their source.
- Make build-only configuration independent of runtime-only `PORT` and
  `BASE_PATH` settings.
- Establish a disposable PostgreSQL 16 test service, migrations, reset tooling,
  and destructive-operation guards.
- Run all API, Content OS, integration, typecheck, and build gates without skips.
- Remove Vite-only sourcemap noise where Next.js client directives were not
  applicable.

Current executable evidence is maintained in
`docs/recovery/RECOVERY_VALIDATION.md`.

## Remaining restrictions

Not authorized:

- New CMS, grant, publishing, or other product features
- UI redesign or removal/consolidation of preserved source trees
- Production, Replit, customer, or shared-development database access
- Production deployment or modification of an existing Replit project
- Automatic merging of either recovery pull request
- Real sensitive customer data, external purchases, or account changes

## Governance work packages

The pre-recovery Stage 0 program remains preserved. WP-00 and WP-01 are
complete; WP-02 licensing/SBOM remains the next program work package after the
recovery baseline is accepted. WP-03 through WP-07 remain gated as documented
in `docs/STAGE_0_EXECUTION_PLAN.md`.

## Next authorized stage

Finish the isolated PostgreSQL CI validation, record exact test and build
evidence, and obtain human review of the stabilization pull request into
`recovery/replit-content-machine-source`. After that branch is accepted, PR #4
may be recommended for human merge. No agent is authorized to merge or deploy.
