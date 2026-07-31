# Governance Baseline

## Status

Draft for owner approval. This document defines safe defaults and separates approved constraints from unresolved business decisions.

## Proposed agency customer

Primary hypothesis: a small-to-mid-sized professional-services or marketing agency that manages content and grant/proposal work across multiple client workspaces and requires evidence, approvals, repeatability, and client separation.

Not yet approved:

- Exact agency vertical
- Employee count
- Client count
- Pilot client type
- Whether grant consulting and marketing content belong in one initial product

## Scale assumption

Design target: 300+ logical workspaces across the platform, with each workspace assigned to exactly one tenant and no implicit cross-tenant access.

Planning assumptions:

- Workspaces may contain multiple projects and users.
- Workload will be uneven, with bursty research and generation jobs.
- Scale does not authorize premature distributed architecture.
- Architecture must prove a migration path beyond the pilot.

## Tenant and ownership model

- A tenant represents the contracting agency or direct customer.
- A workspace belongs to exactly one tenant.
- Client work product, sources, drafts, approvals, exports, and audit history belong to the tenant or client according to the governing contract.
- Platform configuration, generic workflows, non-client-specific evaluation methods, and platform code remain platform assets unless a contract states otherwise.
- No data may be used for model training, cross-client retrieval, or product benchmarking without explicit authorization and de-identification rules.

## Data classifications

| Class | Examples | Default handling |
|---|---|---|
| Public | Published web pages, public grant notices | May be ingested with source metadata and retrieval date |
| Internal | Workflow settings, internal drafts, operating notes | Tenant-restricted; logged access |
| Confidential | Client strategy, unpublished proposals, financial narratives | Encryption, least privilege, no cross-tenant processing |
| Restricted | Credentials, regulated identifiers, sensitive personal or legal records | Prohibited in pilot unless specifically approved and controlled |

## Sensitive-content boundary

The Stage 0 and initial pilot must not process:

- Authentication secrets or payment-card data
- Social Security numbers or equivalent identifiers
- Protected health information
- Classified information
- Unredacted sensitive legal records
- Data whose processing requires a compliance regime not yet implemented

## Human approval requirements

Human approval is mandatory before:

- Publishing or delivering client content
- Submitting a grant or proposal
- Representing eligibility as confirmed
- Using a source with unresolved credibility or date conflicts
- Overriding a failed factual or citation check
- Moving confidential data to a new processor
- Changing retention or deletion rules
- Accepting material legal, licensing, cost, or security risk

## Grant-research source restrictions

Preferred sources, in order:

1. Official funder or government program pages
2. Official notices, regulations, and application documents
3. Official FAQs and amendments
4. Authorized grant databases that permit the intended use
5. Reputable secondary sources only as discovery aids

Search snippets, scraped summaries, AI-generated pages, and unverified aggregators may not serve as final evidence of eligibility, deadlines, award amounts, or requirements.

## Open owner decisions

1. Select the exact first agency customer profile.
2. Select the initial pilot client type.
3. Confirm whether 300+ workspaces means active concurrent workspaces or long-term total workspaces.
4. Approve client/workspace ownership language.
5. Approve restricted-data exclusions.
6. Approve the human-approval matrix.
7. Decide whether the pilot combines content and grants or begins with one workflow family.

## Completion rule

WP-01 remains incomplete until the owner approves the open decisions.