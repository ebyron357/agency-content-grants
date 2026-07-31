# Governance Baseline

## Status

Approved by the owner on July 31, 2026. This document is the canonical Stage 0 governance baseline until replaced by a later approved version.

## Approved agency customer

The first target customer is a small-to-mid-sized marketing or professional-services agency that manages evidence-backed content across multiple separated client workspaces and requires repeatable research, citations, approvals, version history, and client isolation.

The initial commercial pilot will use one agency with a small controlled user group. The pilot is content-first. Grant and proposal workflows remain research-scoped until source verification, eligibility controls, citation standards, and submission approvals are proven.

## Scale assumption

The design target is 300-plus long-term total logical workspaces across the platform. It is not a requirement for 300 simultaneous active workspaces on the first release.

Planning assumptions:

- Every workspace belongs to exactly one tenant.
- Workspaces may contain multiple projects and users.
- Workload will be uneven, with bursty research and generation jobs.
- The pilot may begin with approximately 5 to 20 active workspaces.
- Architecture must demonstrate a credible path to 300-plus total workspaces without requiring premature distributed complexity.
- Concurrency, storage, job volume, and model usage must be measured during the pilot before production capacity commitments are made.

## Tenant and ownership model

- A tenant represents the contracting agency or direct customer.
- A workspace belongs to exactly one tenant.
- No implicit cross-tenant access is permitted.
- Client work product, sources, drafts, approvals, exports, and audit history belong to the tenant or client according to the governing contract.
- Platform configuration, generic workflows, non-client-specific evaluation methods, and platform code remain platform assets unless a contract states otherwise.
- No client data may be used for model training, cross-client retrieval, product benchmarking, or demonstrations without explicit written authorization and approved de-identification rules.
- Tenant deletion must include a documented export, retention, and verified deletion process.

## Data classifications

| Class | Examples | Default handling |
|---|---|---|
| Public | Published web pages, public grant notices | May be ingested with source metadata, retrieval date, and provenance |
| Internal | Workflow settings, internal drafts, operating notes | Tenant-restricted access with audit logging |
| Confidential | Client strategy, unpublished proposals, financial narratives | Encryption, least privilege, explicit processor controls, and no cross-tenant processing |
| Restricted | Credentials, regulated identifiers, sensitive personal, health, payment, classified, or protected legal records | Prohibited in the pilot unless a later approved control framework explicitly permits them |

## Sensitive-content boundary

Stage 0 and the initial pilot must not process:

- Authentication secrets or payment-card data
- Social Security numbers or equivalent government identifiers
- Protected health information
- Classified information
- Unredacted sensitive legal records
- Data whose processing requires a compliance regime not yet implemented and approved
- Highly sensitive personal information that is unnecessary for the approved content workflow

## Human approval requirements

Human approval is mandatory before:

- Publishing, exporting as final, or delivering client content
- Submitting a grant or proposal
- Representing grant eligibility as confirmed
- Using a source with unresolved credibility, authority, date, or conflict concerns
- Overriding a failed factual, citation, originality, privacy, or quality check
- Moving confidential data to a new processor or model provider
- Changing retention, export, or deletion rules
- Enabling a new external integration with client data access
- Accepting material legal, licensing, cost, security, or tenant-isolation risk
- Deploying to production or merging a change that bypasses an approved release gate

## Grant-research source restrictions

Preferred sources, in order:

1. Official funder or government program pages
2. Official notices, regulations, application documents, amendments, and award materials
3. Official FAQs and eligibility guidance
4. Authorized grant databases whose terms permit the intended commercial use
5. Reputable secondary sources used only for discovery or corroboration

Search snippets, scraped summaries, AI-generated pages, and unverified aggregators may not serve as final evidence of eligibility, deadlines, award amounts, requirements, or submission rules.

Every material grant claim must preserve the source URL, title, publisher, publication or update date when available, retrieval date, relevant excerpt or snapshot reference, and verification status.

## Approved pilot sequence

1. Build and evaluate the evidence-first content workflow.
2. Pilot with one small-to-mid-sized marketing or professional-services agency.
3. Limit the initial pilot to a controlled user group and approximately 5 to 20 workspaces.
4. Require human approval for every final deliverable.
5. Evaluate citation accuracy, source completeness, tenant isolation, cost, revision count, and export quality.
6. Add grant/proposal workflows only after the research and eligibility controls pass their own Stage 0 acceptance criteria.

## Completion decision

WP-01 is complete. The approved governance baseline authorizes WP-02 licensing, SBOM, dependency, and commercial-use analysis. It does not authorize production implementation.