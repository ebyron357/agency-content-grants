# Document Ownership Map

| Document | Purpose | Canonical owner | Change authority |
|---|---|---|---|
| `README.md` | Public project orientation | Product owner | Product owner or approved PR |
| `AGENTS.md` | Repository-wide agent rules | Product owner | Product owner approval required |
| `.cursor/rules/*` | Cursor execution controls | Product owner | Product owner approval required |
| `docs/PROGRAM_CHARTER.md` | Strategic intent and boundaries | Product owner | Product owner approval required |
| `docs/STAGE_0_EXECUTION_PLAN.md` | Ordered Stage 0 work | Program lead | Approved PR |
| `docs/PROJECT_STATUS.md` | Current source of truth | Program lead | Updated by every accepted work package |
| `docs/governance/*` | Customer, data, ownership, and approval policy | Product owner | Product owner approval required for final decisions |
| `docs/licensing/*` | Dependency and license evidence | Technical lead | Legal review where obligations are material |
| `docs/architecture/*` | ADRs and architecture evidence | Technical lead | Product owner approves material cost/ownership tradeoffs |
| `docs/security/*` | Threat model and security controls | Security lead | Product owner accepts residual risk |
| `docs/benchmarks/*` | Evaluation corpus and release rubric | Product and quality leads | Product owner approves release thresholds |

## Rule

When an approved governing rule changes, replace the complete canonical document. Do not leave fragmented amendments or competing sources of truth.