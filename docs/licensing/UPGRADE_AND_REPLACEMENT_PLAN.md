# Upgrade and Replacement Plan

## Objective

Prevent the platform from becoming operationally or commercially trapped by any framework, workflow engine, model provider, integration vendor, storage service, or deployment platform.

## General rules

- Pin exact versions in immutable lockfiles and deployment artifacts.
- Do not use floating `latest` tags in controlled environments.
- Separate domain logic from vendor SDKs through narrow adapters.
- Store canonical business data in portable formats and platform-owned schemas.
- Maintain export and migration tests before a component becomes critical.
- Record deprecation, end-of-life, security, cost, and license-change signals.
- Review major upgrades through focused pull requests with rollback instructions.

## Component plans

### PostgreSQL — ADOPT

Upgrade approach:

- Use a currently supported major version selected during implementation planning.
- Apply minor security releases promptly after validation.
- Rehearse major upgrades against restored production-like backups.
- Validate extensions independently.

Replacement path:

- Preserve standard SQL and avoid unnecessary provider-specific features.
- Maintain logical exports and tested restore procedures.
- Document every extension and nonportable feature.

Exit trigger:

- Unsupported version, unacceptable managed-service restrictions, persistent reliability failure, or architectural requirements PostgreSQL cannot meet.

### Payload — PILOT

Pilot proof requirements:

- Tenant-scoped authorization cannot be bypassed.
- Migrations are deterministic and reversible.
- Admin access is auditable.
- Content schemas can be exported without proprietary hosted dependencies.
- The team can upgrade across supported releases without destructive rewrites.

Replacement path:

- Keep domain services independent of Payload collection hooks where practical.
- Expose application-owned service interfaces.
- Maintain database and content exports.
- Compare a custom Next.js control plane and alternative permissive frameworks during WP-03.

Exit triggers:

- Tenant-isolation weakness, excessive framework coupling, unstable migration path, unacceptable operational cost, or license change.

### Temporal — PILOT

Pilot proof requirements:

- Durable workflows materially outperform a simpler queue/worker design for approved use cases.
- Operational burden and cost fit the pilot budget.
- Workflow versioning and replay behavior are understood and tested.
- Tenant and cost limits can be enforced.

Replacement path:

- Hide Temporal behind an application-owned job interface.
- Store business state outside workflow history where practical.
- Keep workflow inputs and outputs versioned and serializable.
- Maintain a simpler queue/worker alternative for early-stage workloads.

Exit triggers:

- Complexity exceeds value, worker cost is excessive, replay/versioning risk is unacceptable, or approved workflows do not require its guarantees.

### LangGraph — PILOT

Pilot proof requirements:

- State graphs improve reliability, inspection, and evaluation over ordinary application orchestration.
- Workflows can run with multiple model providers.
- Checkpoint and trace data remain portable.
- Core prompts, evaluators, and state definitions remain platform-owned.

Replacement path:

- Keep model calls behind provider adapters.
- Represent workflow definitions in application-owned modules and schemas.
- Avoid requiring a proprietary hosted control plane.

Exit triggers:

- Framework churn, unacceptable coupling, inability to reproduce runs, cost/latency regression, or license change.

### n8n — REPLACE

Current rule:

- Do not include n8n as a required component under the Sustainable Use License for the customer-facing platform.

Replacement path:

- Use native connector workers and the approved durable-execution layer.
- Define an internal connector contract for authentication, input validation, retries, idempotency, rate limits, audit events, and secret references.
- Evaluate permissively licensed alternatives only after full license and maturity review.

Reconsideration trigger:

- A written commercial agreement explicitly grants the required embedding, customer-facing, credential-processing, hosting, modification, and redistribution rights at an approved cost.

## Upgrade cadence

- Security updates: triaged immediately; emergency process for exploitable critical issues.
- Minor updates: grouped and validated regularly.
- Major updates: explicit architecture review, migration rehearsal, benchmark comparison, and rollback plan.
- License changes: immediate freeze on the affected new version until reviewed.
- Model/API changes: benchmark and cost regression testing before promotion.

## Required upgrade evidence

Each material upgrade must record:

- Current and proposed versions
- Release notes and breaking changes
- License comparison
- Migration steps
- Data compatibility
- Security impact
- Benchmark impact
- Cost impact
- Rollback steps
- Test results
- Approval status

## Ownership

Architecture owns component selection and replacement readiness. Security owns vulnerability and threat implications. Product owns workflow impact. Finance owns material cost changes. The project owner approves high-risk exceptions and commercial-license commitments.