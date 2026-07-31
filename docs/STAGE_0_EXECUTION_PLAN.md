# Stage 0 Execution Plan

## Objective

Determine whether the Agency Content and Grant Intelligence Platform should proceed to implementation and establish the evidence, architecture, controls, benchmarks, budget, and pilot scope required to build it responsibly.

## Execution order

### WP-00 — Repository baseline

Deliverables:

- Canonical repository confirmation
- Repository inventory
- Branching and pull-request policy
- Document ownership map

Acceptance criteria:

- Repository is identified as canonical or a migration plan exists.
- No competing source of truth is left unresolved.

### WP-01 — Governance and customer definition

Deliverables:

- Exact agency customer profile
- 300-plus-workspace workload assumptions
- Tenant hierarchy and ownership model
- Data-classification policy
- Sensitive and regulated-content boundaries
- Human-approval matrix
- Grant-source restriction policy

Acceptance criteria:

- Customer, user, problem, workflow, and buyer are concrete.
- Every high-risk action has a named approval requirement.

### WP-02 — Repository, dependencies, licensing, and SBOM

Deliverables:

- Proposed dependency inventory with pinned versions
- CycloneDX and SPDX SBOMs where an implementation exists
- License and commercial-use matrix
- Network-use and copyleft analysis
- Client-delivery and self-hosting implications
- `ADOPT`, `PILOT`, `REPLACE`, `REJECT`, or `DEFER` decision for every dependency
- Upgrade and replacement plan

Acceptance criteria:

- No proposed production dependency has an unknown license.
- Obligations are mapped to SaaS, client delivery, redistribution, and self-hosting scenarios.

### WP-03 — Architecture decisions

Decisions required:

- Payload control plane
- PostgreSQL data layer
- Temporal durable execution
- LangGraph AI workflows
- n8n integrations
- Object storage
- Search and retrieval
- Source and citation storage
- Evaluation infrastructure
- Observability
- Secrets management

Deliverables:

- System context, container, and data-flow diagrams
- Architecture Decision Records
- Failure-mode and replacement analysis
- Preliminary cost model

Acceptance criteria:

- Every component has a bounded responsibility.
- Tenant, evidence, workflow, and export paths are traceable end to end.

### WP-04 — Security and reliability

Deliverables:

- Threat model
- Tenant-isolation control and test plan
- Prompt-injection control design
- Cross-client leakage test suite design
- Authentication and authorization model
- Audit-logging specification
- Retention and deletion policy
- Backup and disaster-recovery plan
- Cost and runaway-job controls
- Security proof-of-concept report

Acceptance criteria:

- Critical threats have controls, verification methods, owners, and residual-risk decisions.
- Cross-tenant access is denied by design and testable.

### WP-05 — Pilot product and economics

Deliverables:

- Smallest commercial pilot
- Pilot client type
- Initial users and workflow
- First three content types
- Initial grant or proposal workflows
- Client approval workflow
- Export requirements
- Monthly operating budget
- Pilot price and revenue target

Acceptance criteria:

- Pilot can be sold, delivered, evaluated, and supported without building the full platform.
- Cost assumptions include models, research, storage, orchestration, monitoring, and support.

### WP-06 — Benchmark and evaluation system

Deliverables:

- Benchmark corpus
- Known-good and known-failure examples
- Citation and factual-accuracy standards
- SEO/AEO/GEO rubric
- Grant-eligibility and source-verification rubric
- Readability and accessibility rubric
- Export-fidelity rubric
- Release acceptance thresholds

Required benchmark outputs:

- Cited home-ownership manual
- Current car-price article
- Snail e-book
- Two additional approved topics

Acceptance criteria:

- Every benchmark is repeatable.
- Model, cost, run time, revision count, sources, and score are recorded.

### WP-07 — Final go/no-go

Deliverable:

- `docs/GO_NO_GO_DECISION.md`

Allowed outcomes:

- `GO`
- `CONDITIONAL GO`
- `NO-GO`
- `DEFER`

Acceptance criteria:

- Decision cites completed work packages.
- Conditions, unresolved risks, budget, pilot scope, and human approval are recorded.

## Parallelism rules

WP-01 and preliminary WP-02 may run in parallel. WP-03 depends on findings from WP-01 and WP-02. WP-04 depends on the candidate architecture. WP-05 and WP-06 may proceed after customer and architecture assumptions stabilize. WP-07 is strictly last.

## Implementation prohibition

No production scaffolding, application feature development, deployment, or external integration configuration is authorized during Stage 0. Small disposable proofs of concept are allowed only when necessary to test a Stage 0 security or architecture claim and must be clearly labeled non-production.