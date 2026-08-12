# Project Status

## Overall status

The authoritative Replit Content Machine source has been recovered on
`recovery/replit-content-machine-source` at commit
`fba398e2945fc39405b9bdf2543b28df4aac65ee`. The owner has authorized only the
baseline stabilization needed to make that recovery executable and
evidence-backed. That human authorization is recorded in
`docs/GO_NO_GO_DECISION.md`. Product implementation remains deferred.

## Current gate

Recovery baseline validation on `fix/recovery-baseline-validation` is complete.
The frozen install, repository-wide typecheck, 249 API tests, 10 Content OS
tests, 38 shell integration checks, repeat migration/reset, service lifecycle,
and aggregate production build pass in isolated GitHub Actions run
`31628224081`. Review-driven export verification now proves a new project starts
without stale exports and validates exact project/format association, unique API
listing, completed status, matching positive file sizes, and DOCX signature.

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
`docs/recovery/RECOVERY_VALIDATION.md`; the scope and limits of the human
authorization are maintained in `docs/GO_NO_GO_DECISION.md`.

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

Obtain human review and merge approval for the stabilization pull request into
`recovery/replit-content-machine-source`. With that stabilization included, PR
#4 is recommended for human merge. No agent is authorized to merge or deploy.
