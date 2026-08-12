# Content Machine Production Closeout Plan

**Date:** 2026-08-12
**Author:** Claude (autonomous agent)
**Status:** DRAFT — requires human approval before execution
**Prerequisite:** Post-Recovery Production Readiness Audit (this plan addresses the gaps identified therein)

---

## 1. Purpose

Define the ordered work required to bring the recovered and stabilized Content Machine baseline from its current validated-but-not-deployable state to a production-ready, deployable system. Each phase has explicit entry criteria, deliverables, and exit gates.

---

## 2. Current State

- Recovery merged to `main` at `6eeead8`
- All build, typecheck, test, and integration gates pass
- Zero authentication, authorization, or tenant isolation
- No deployment infrastructure
- No SBOM or license audit
- No production environment exists
- Governed by `docs/GO_NO_GO_DECISION.md` LIMITED GO (stabilization only)

---

## 3. Phases

### Phase 1: Governance Completion (Stage 0 remaining work packages)

| Step | Deliverable | Gate |
|------|-------------|------|
| 1.1 | WP-02: License inventory and SBOM | All dependencies have documented, compatible licenses |
| 1.2 | WP-03: Architecture decision records | ADRs cover auth, tenancy, deployment, AI routing |
| 1.3 | WP-04: Threat model | STRIDE analysis of all external interfaces |
| 1.4 | WP-05: Cost model | Per-tenant cost projection with AI provider pricing |
| 1.5 | WP-06: Evaluation corpus | Synthetic test data for pipeline validation |
| 1.6 | WP-07: Pilot scope definition | Named pilot customer, success criteria, timeline |

**Exit gate:** All Stage 0 WPs complete; `GO_NO_GO_DECISION.md` updated with human-approved full GO.

### Phase 2: Security Foundation

| Step | Deliverable | Gate |
|------|-------------|------|
| 2.1 | Authentication middleware (JWT or session-based) | All routes require valid credentials |
| 2.2 | Authorization / RBAC | Role-based access enforced; tests prove denial |
| 2.3 | Multi-tenant data isolation | Tenant column on all user-facing tables; RLS or app-layer enforcement |
| 2.4 | Input validation (Zod middleware) | All route handlers validate request bodies |
| 2.5 | Security headers (Helmet.js or equivalent) | CSP, HSTS, X-Frame-Options configured |
| 2.6 | Rate limiting | Per-IP and per-tenant throttling |
| 2.7 | CORS origin whitelist | Only authorized frontend origins allowed |
| 2.8 | Penetration test | No critical or high findings unresolved |

**Exit gate:** Security review passes with no critical/high findings.

### Phase 3: Infrastructure & Operations

| Step | Deliverable | Gate |
|------|-------------|------|
| 3.1 | Containerization (Dockerfile + compose) | Reproducible local and CI builds |
| 3.2 | Infrastructure-as-Code (Terraform/Pulumi) | Environments provisionable from code |
| 3.3 | Secret management (Vault/KMS) | No plaintext secrets in env or config |
| 3.4 | Database backup and restore | Automated daily backup; tested restore |
| 3.5 | Monitoring and alerting (APM + log aggregation) | Dashboards and on-call alerts |
| 3.6 | Graceful shutdown and health checks | Zero-downtime deploys verified |
| 3.7 | CI/CD pipeline | Automated test → build → deploy to staging |

**Exit gate:** Staging environment operational with full monitoring.

### Phase 4: Production Deployment

| Step | Deliverable | Gate |
|------|-------------|------|
| 4.1 | Production environment provisioned | Matches IaC definitions |
| 4.2 | Data migration plan | Schema deployed to production DB |
| 4.3 | DNS and TLS | HTTPS enforced; valid certificates |
| 4.4 | Load testing | Meets defined throughput targets |
| 4.5 | Runbook and incident response | On-call procedures documented |
| 4.6 | Human deployment approval | Explicit sign-off recorded |

**Exit gate:** Production live with pilot customer; monitoring green for 48 hours.

---

## 4. Authorization Requirements

- Phase 1 exit requires a new human-approved GO decision replacing the current LIMITED GO.
- Phase 4 step 4.6 requires explicit human deployment approval.
- No phase may begin until its predecessor's exit gate is met.
- No autonomous agent may merge, deploy, or provision production resources without human approval at each gate.

---

## 5. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI provider API changes | Pipeline breakage | Provider abstraction layer; contract tests |
| License incompatibility discovered in WP-02 | Dependency replacement needed | Early SBOM analysis before feature work |
| Multi-tenant retrofit complexity | Schema migration risk | Design tenant model before adding data |
| Cost overrun on AI calls | Budget exceeded | Per-tenant quotas; cost alerting |
| Recovered source diverges from Replit deployment | Feature parity unknown | Accept gap; document in provenance |

---

## 6. Out of Scope

- New product features (content types, media, video, grants)
- UI redesign
- Customer migration from Replit
- Marketing or go-to-market activities
- Pricing or billing system
