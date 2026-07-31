# Dependency and License Decision Matrix

## Status

Stage 0 WP-02 evidence review. These are architecture-input decisions, not authorization to scaffold the production application.

Retrieval date: July 31, 2026.

## Decision scale

- `ADOPT`: suitable in principle for the commercial platform, subject to version pinning and implementation validation.
- `PILOT`: suitable only for a bounded proof of concept before architecture approval.
- `REPLACE`: do not use in the proposed role; evaluate a different component.
- `REJECT`: exclude from further consideration.
- `DEFER`: insufficient evidence or premature decision.

## Candidate decisions

| Candidate | Proposed role | License finding | Commercial/client-delivery implications | Decision | Conditions |
|---|---|---|---|---|---|
| PostgreSQL | Canonical relational data layer | PostgreSQL License, permissive and similar to BSD/MIT | Commercial use, modification, and distribution are permitted with required notices | ADOPT | Use supported major version; preserve notices; managed-service terms reviewed separately |
| Payload CMS | Application control plane and admin UI | MIT | Commercial use and modification permitted with copyright and license notice preservation | PILOT | Prove tenant authorization, row-level isolation, migrations, auditability, and upgrade path before ADOPT |
| Temporal Server and SDKs | Durable workflow execution | MIT for the reviewed server repository | Commercial and self-hosted use permitted with notice preservation; managed Temporal Cloud terms are separate | PILOT | Use only if benchmarked workflows justify operational complexity; pin server and SDK versions independently |
| LangGraph | AI workflow/state orchestration | MIT | Commercial use, modification, and redistribution permitted with notices | PILOT | Keep application logic portable; prohibit proprietary hosted-service coupling from becoming mandatory |
| n8n Community/Sustainable Use code | Customer-facing integrations or embedded automation | Sustainable Use License with internal-business restrictions; not OSI open source | White-labeling, charging customers for access, or certain customer-credential-powered backend uses can require a separate commercial agreement | REPLACE | Do not make it a required platform component. A separately licensed commercial agreement could reopen review |

## Primary evidence

### PostgreSQL

Official license: https://www.postgresql.org/about/licence/

Finding: broad rights to use, copy, modify, and distribute, subject to preserving the stated copyright and license paragraphs.

### Payload

Official repository license: https://github.com/payloadcms/payload/blob/main/LICENSE.md

Finding: MIT License. Preserve the copyright and permission notice in copies or substantial portions.

### Temporal

Official repository license: https://github.com/temporalio/temporal/blob/main/LICENSE

Finding: MIT License for the reviewed server repository. Every selected SDK, UI, Helm chart, and auxiliary package must still be inventoried independently.

### LangGraph

Official repository license: https://github.com/langchain-ai/langgraph/blob/main/LICENSE

Finding: MIT License. Model providers, tracing services, datasets, prompts, and separately installed LangChain ecosystem packages require their own review.

### n8n

Official license: https://github.com/n8n-io/n8n/blob/master/LICENSE.md

Official explanation: https://docs.n8n.io/privacy-and-security/sustainable-use-license/

Finding: source-available under a commercially restricted Sustainable Use License, with separate enterprise-licensed files. The proposed multi-tenant customer platform creates material ambiguity and likely restriction if n8n is embedded, white-labeled, exposed to customers, or processes customer credentials as a paid feature.

## n8n replacement requirement

The architecture must define integrations without depending on n8n. Acceptable directions for WP-03 comparison include:

1. Native integration workers using the platform's durable execution layer.
2. A thin connector framework owned by the platform.
3. A permissively licensed workflow/integration alternative after a full license and maturity review.
4. A separately negotiated n8n commercial license, only if its cost and rights are documented and owner-approved.

No n8n package may be added to a production manifest under the current Stage 0 decision.

## License obligations baseline

For all adopted or piloted software:

- Preserve required copyright and license notices.
- Maintain a machine-readable dependency inventory and SBOM.
- Record exact package, version, source, checksum or lockfile identity, declared license, verified license text, and transitive dependencies.
- Review container images, plugins, SDKs, model artifacts, datasets, fonts, templates, and copied code separately.
- Do not treat a repository-level license as proof that every bundled or optional artifact has the same license.
- Review SaaS and managed-cloud terms separately from source-code licenses.
- Escalate copyleft, network-copyleft, source-available, field-of-use, noncommercial, or custom terms for human approval.

## Legal limitation

This document is an engineering license-risk assessment, not legal advice. Material commercial-license decisions should receive qualified legal review before client delivery.