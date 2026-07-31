# Project Status

## Overall status

**Stage 0 foundation created. Implementation remains deferred.**

## Current gate

Stage 0 governance, evidence, architecture, security, benchmark, budget, and pilot approval.

## Work-package status

| Work package | Status | Evidence | Blocking issue |
|---|---|---|---|
| WP-00 Repository baseline | In progress | Repository confirmed; governance branch created | Ownership map and PR policy require completion |
| WP-01 Governance/customer | Not started | Program charter contains initial hypotheses | Customer validation and approval required |
| WP-02 Licensing/SBOM | Not started | None | Dependencies are not yet selected or pinned |
| WP-03 Architecture | Not started | Candidate stack listed | Licensing and customer assumptions unresolved |
| WP-04 Security/reliability | Not started | None | Candidate architecture required |
| WP-05 Pilot/economics | Not started | None | Customer and budget assumptions required |
| WP-06 Benchmarks/evaluation | Not started | Required benchmark topics listed | Rubrics and corpus required |
| WP-07 Go/no-go | Blocked | None | WP-00 through WP-06 must be accepted |

## Current authorization

Allowed:

- Research
- Governance documentation
- Licensing analysis
- Architecture analysis and ADRs
- Threat modeling and disposable proofs of concept
- Benchmark and evaluation design
- Cost modeling
- Pilot definition

Not allowed:

- Production application implementation
- Production deployment
- Automatic merging
- External purchasing or account changes
- Use of real sensitive client data
- Autonomous grant submission or content publication

## Required next action

Execute WP-00 and WP-01 using `prompts/CURSOR_MASTER_ORCHESTRATOR.md`, then open focused pull requests with evidence and acceptance-criteria results.