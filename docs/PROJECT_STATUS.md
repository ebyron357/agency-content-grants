# Project Status

## Overall status

**WP-00 repository baseline and WP-01 governance are complete and owner-approved. WP-02 licensing and SBOM control design is complete for the named candidate stack. Production implementation remains deferred pending architecture, security, pilot, benchmark, and final go/no-go approval.**

## Current gate

WP-03 architecture decisions informed by the WP-02 licensing findings.

## Work-package status

| Work package | Status | Evidence | Blocking issue |
|---|---|---|---|
| WP-00 Repository baseline | Complete | `REPOSITORY_BASELINE.md`, `DOCUMENT_OWNERSHIP_MAP.md`, `BRANCH_AND_PR_POLICY.md` | None |
| WP-01 Governance/customer | Complete | `governance/GOVERNANCE_BASELINE.md`; owner approval July 31, 2026 | None |
| WP-02 Licensing/SBOM | Complete for named candidate stack | `licensing/DEPENDENCY_DECISION_MATRIX.md`, `licensing/SBOM_AND_LICENSE_CONTROL_PLAN.md`, `licensing/UPGRADE_AND_REPLACEMENT_PLAN.md` | Actual transitive SBOMs require future manifests and built artifacts |
| WP-03 Architecture | Authorized | PostgreSQL ADOPT; Payload, Temporal, LangGraph PILOT; n8n REPLACE | ADRs and architecture comparison required |
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

## WP-02 component decisions

- PostgreSQL: `ADOPT` as the canonical relational data layer, subject to supported-version selection and implementation validation.
- Payload: `PILOT` as the control-plane candidate.
- Temporal: `PILOT` only if durable execution proves necessary and affordable.
- LangGraph: `PILOT` with portability and reproducibility controls.
- n8n: `REPLACE` for the proposed customer-facing platform role under the reviewed Sustainable Use License. Reconsider only with an approved commercial agreement granting the required rights.

## Current authorization

Allowed:

- WP-03 architecture comparison and ADR preparation
- Selection of object storage, search/retrieval, evidence storage, evaluation, observability, and secrets-management approaches
- Threat modeling and disposable proofs of concept
- Benchmark and evaluation design
- Cost modeling and pilot definition
- Creation of disposable manifests solely for architecture or SBOM verification, provided they are not represented as a production scaffold

Not allowed:

- Production application implementation
- Production deployment
- Automatic merging
- External purchasing or account changes
- Use of real sensitive client data
- Autonomous grant submission or content publication
- Adding n8n as a required production dependency without a separately approved commercial license

## Required next action

Execute WP-03. Confirm or revise the control plane, data layer, durable execution, AI orchestration, and integration strategy. Define object storage, search and retrieval, source/citation storage, evaluation infrastructure, observability, and secrets management. Produce architecture decision records with alternatives, costs, tenant-isolation implications, license implications, and replacement paths.