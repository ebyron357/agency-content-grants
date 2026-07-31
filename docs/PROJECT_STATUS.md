# Project Status

## Overall status

**WP-00 repository baseline and WP-01 governance are complete and owner-approved. Production implementation remains deferred pending Stage 0 evidence and go/no-go approval.**

## Current gate

WP-02 dependency, licensing, SBOM, commercial-use, network-use, self-hosting, and replacement analysis.

## Work-package status

| Work package | Status | Evidence | Blocking issue |
|---|---|---|---|
| WP-00 Repository baseline | Complete | `REPOSITORY_BASELINE.md`, `DOCUMENT_OWNERSHIP_MAP.md`, `BRANCH_AND_PR_POLICY.md` | None |
| WP-01 Governance/customer | Complete | `governance/GOVERNANCE_BASELINE.md`; owner approval July 31, 2026 | None |
| WP-02 Licensing/SBOM | Authorized | Approved customer and pilot scope narrow the candidate stack | Candidate versions, transitive dependencies, licenses, and obligations require evidence review |
| WP-03 Architecture | Not started | Candidate stack listed | WP-02 findings required before final ADR decisions |
| WP-04 Security/reliability | Not started | Approved data classes and sensitive-content boundaries | Candidate architecture required |
| WP-05 Pilot/economics | In planning | Content-first agency pilot approved | Budget, pricing, and operating assumptions require analysis |
| WP-06 Benchmarks/evaluation | In planning | Content-first pilot sequence approved | Rubrics, corpus, and acceptance thresholds required |
| WP-07 Go/no-go | Blocked | None | WP-00 through WP-06 must be accepted |

## Approved Stage 0 decisions

- First customer: small-to-mid-sized marketing or professional-services agency.
- Pilot: one agency, small controlled user group, content-first.
- Initial scale: approximately 5 to 20 active workspaces.
- Long-term design target: 300-plus total logical workspaces, not day-one concurrency.
- Tenant model: one tenant owner per workspace with no implicit cross-tenant access.
- Restricted-data exclusions and human-approval matrix are approved.
- Grant/proposal workflows remain research-scoped until dedicated controls pass.

## Current authorization

Allowed:

- WP-02 dependency pinning and license research
- SBOM strategy and generation against any disposable candidate manifests
- Commercial-use, network-use, redistribution, client-delivery, and self-hosting analysis
- Architecture analysis and ADR preparation
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

Execute WP-02. Produce a pinned candidate dependency inventory, SBOM plan and artifacts, license matrix, obligation analysis, adopt/pilot/replace/reject decisions, and upgrade/replacement plan. Open a focused pull request and stop at any material licensing or commercial-use decision gate.