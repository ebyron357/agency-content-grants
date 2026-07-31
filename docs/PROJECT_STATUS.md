# Project Status

## Overall status

**WP-00 repository baseline complete. WP-01 governance baseline drafted and awaiting owner decisions. Production implementation remains deferred.**

## Current gate

Owner approval of the exact customer, pilot client type, scale interpretation, ownership model, restricted-data boundaries, approval matrix, and initial workflow family.

## Work-package status

| Work package | Status | Evidence | Blocking issue |
|---|---|---|---|
| WP-00 Repository baseline | Complete | `REPOSITORY_BASELINE.md`, `DOCUMENT_OWNERSHIP_MAP.md`, `BRANCH_AND_PR_POLICY.md` | None |
| WP-01 Governance/customer | In progress | `governance/GOVERNANCE_BASELINE.md` | Seven owner decisions remain open |
| WP-02 Licensing/SBOM | Blocked | None | Candidate dependency list cannot be pinned until governance choices narrow the product scope |
| WP-03 Architecture | Not started | Candidate stack listed | Licensing and customer assumptions unresolved |
| WP-04 Security/reliability | Not started | Data classes and sensitive-content draft created | Candidate architecture required |
| WP-05 Pilot/economics | Not started | Customer hypothesis documented | Pilot type and budget approval required |
| WP-06 Benchmarks/evaluation | Not started | Required benchmark topics listed | Initial workflow family and rubric required |
| WP-07 Go/no-go | Blocked | None | WP-00 through WP-06 must be accepted |

## Current authorization

Allowed:

- Complete owner decisions for WP-01
- Research and licensing analysis after scope approval
- Architecture analysis and ADRs
- Threat modeling and disposable proofs of concept
- Benchmark and evaluation design
- Cost modeling and pilot definition

Not allowed:

- Production application implementation
- Production deployment
- Automatic merging
- External purchasing or account changes
- Use of real sensitive client data
- Autonomous grant submission or content publication

## Required next action

Review and approve or revise the seven decisions in `docs/governance/GOVERNANCE_BASELINE.md`. After approval, begin WP-02 dependency pinning, SBOM planning, and license review.