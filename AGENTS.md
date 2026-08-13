# AGENTS.md

## Mission

Finish the Agency Content and Grant Intelligence Platform as an evidence-first, secure, multi-tenant Content Machine that supports professional long-form content creation, manual/guide workflows, media-rich editing, export, publishing readiness, and production deployment without weakening tenant isolation, security, or evidence standards.

## Current authorization

The human owner authorized the recovery baseline and stabilization on 2026-08-12 and subsequently authorized execution of the remaining product closeout work needed to finish the Content Machine at production quality.

`docs/GO_NO_GO_DECISION.md` is the controlling authorization record. The current authorization is **GO — evidence-gated product closeout and production-readiness execution**.

Agents may implement, test, integrate, and prepare deployment for the approved closeout scope. Merge and production promotion are allowed only after the explicit evidence gates in this file and `docs/GO_NO_GO_DECISION.md` pass. No agent may bypass a failing gate merely to meet a schedule.

## Source of truth

1. GitHub `main` is the technical source of truth for accepted code and governing documents.
2. ClickUp is the executive operating board and should be updated to match verified GitHub/production state.
3. Replit is recovery/reference evidence only and is not the development or deployment authority.
4. Preview deployments and agent self-reports are evidence inputs, not proof of production completion.

## Approved closeout scope

The autonomous closeout may implement and verify the product capabilities required for the approved Content Machine outcome, including:

- Long-form blog/article creation and editing.
- Manuals, guides, reports, and other long-form document workflows.
- Rich editor behavior required for practical authoring.
- Image upload, placement, captioning, alt text, replacement, and persistence.
- Video embedding using safe supported URLs/embeds, with validation and persistence.
- Project/document lifecycle, save/reload, navigation, and usable workspace flow.
- Existing export workflows, including evidence-backed DOCX behavior, and any approved export repairs required for closeout.
- Backend/API/database changes required by the approved product behavior.
- Authentication, authorization, tenant isolation, rate limiting, validation, and security repairs required for production.
- Production build/deployment configuration and browser verification.
- Accessibility, responsive UX, SEO/metadata, error states, and reliability fixes required for a production-quality product.
- Removal or consolidation of duplicate recovered UI/source trees only when the canonical implementation is proven, unique assets are preserved, and the change is covered by tests/evidence.

Grant/proposal intelligence features outside the already approved product plan remain separately gated when they introduce source eligibility, legal/compliance, submission, or regulated-data obligations not needed for the Content Machine closeout.

## Non-negotiable rules

1. Inspect the relevant repository code and governing documents before changing behavior.
2. Treat the latest approved repository documents as the canonical source of truth; replace superseded governing text rather than layering contradictory fragments.
3. Never invent completed evidence, tests, benchmarks, licenses, costs, customer facts, product capabilities, or approvals.
4. Distinguish verified facts, assumptions, recommendations, and unresolved dependencies.
5. Cite primary sources for licensing, security, standards, products, grants, and technical claims that depend on external facts.
6. Never use client data from one tenant to answer, train, or operate workflows for another tenant.
7. Never commit secrets, credentials, private client data, regulated data, or copyrighted source snapshots without explicit authorization.
8. Never weaken compiler settings, tests, authentication, authorization, tenant isolation, secret controls, database safety guards, or quality gates to obtain a passing result.
9. Never force-merge, bypass branch protection, hide failures, dismiss actionable review feedback without resolution, or promote a failing build.
10. Work in a dedicated branch and use a focused pull request for implementation changes unless an existing approved closeout PR is explicitly designated as canonical.
11. Run all applicable validation before declaring a deliverable complete.
12. Production merge/promotion is permitted only after the Definition of Done and deployment gates below pass and the resulting state is recorded in GitHub and ClickUp.
13. Do not purchase services, change billing, rotate unrelated credentials, or perform destructive production-data operations as part of closeout without explicit owner approval.
14. Use synthetic/test data for verification whenever possible. Production smoke tests must be clearly labeled and must not create misleading customer/business records.
15. Replit must not be treated as the canonical source or production deployment target unless a later approved governing decision explicitly changes that rule.

## Required work method

For each closeout work package:

1. Confirm the required user outcome and current canonical baseline.
2. Inspect existing implementation and remove duplicate/conflicting plans before adding new work.
3. Identify exact gaps against the Definition of Done.
4. Implement the smallest complete set of changes that closes those gaps; do not redesign already-approved work without a verified requirement.
5. Add or update automated tests at the cause of the behavior.
6. Run the full applicable validation suite with no hidden skips.
7. Perform browser/end-to-end verification for user-critical flows.
8. Verify database/integration side effects where the feature depends on persistence or external routing.
9. Record evidence, unresolved external dependencies, and GO/NO-GO status.
10. Update `docs/PROJECT_STATUS.md` as one complete current-state document.
11. Open/update one focused canonical pull request and resolve all actionable review threads.
12. Merge and promote only when the production gate is green; otherwise leave an exact blocker with an executable next action.

## Required product verification matrix

The final closeout evidence must explicitly evaluate at least:

| Area | Required evidence |
|---|---|
| Long-form article/blog creation | Create, save, reopen, edit, and persist a representative long-form document |
| Manual/guide creation | Create and persist a structured multi-section manual/guide or equivalent long-form artifact |
| Rich editor | Headings, paragraphs, lists/structure, links and supported formatting survive save/reload |
| Images | Add an image, persist metadata/alt text where supported, render after reload |
| Video | Add a supported video embed/URL, validate it, save it, and render after reload |
| Navigation/workspace | Core authoring/project routes work without dead ends or critical 404s |
| Persistence | Database-backed records survive service restart/reload and remain tenant-correct |
| Export | Existing required export path creates a valid artifact associated with the correct project/document |
| Authentication/authorization | Unauthenticated and cross-tenant access are rejected; intended user flow passes |
| Build/tests | Frozen install, typecheck, lint where configured, automated tests, migrations, integration tests, and production build pass |
| Accessibility/responsive | Core flows are keyboard-usable, labels/focus/error states are usable, and primary layouts work at mobile/desktop breakpoints |
| Production | Approved deployment is healthy, critical routes load, runtime errors are checked, and repository/deployment parity is proven |

If a listed capability is intentionally out of final scope, the governing PR must state the owner-approved exclusion; absence may not be silently treated as PASS.

## Definition of Done

A project is **COMPLETE / GO** only when all applicable conditions are true:

- Required product implementation is finished.
- Frozen dependency installation succeeds.
- Repository-wide typecheck passes.
- Lint passes where configured.
- Required unit/integration/end-to-end tests pass with no hidden skips.
- Database migrations/setup are reproducible and destructive test guards remain active.
- Production build succeeds.
- Critical browser flows pass on the candidate deployment.
- Required persistence, media, export, and integration behavior is verified end to end.
- Authentication, authorization, tenant isolation, rate limiting, validation, and secret scanning have no unresolved P0 or required P1 defect.
- No P0 defect remains.
- No required P1 defect remains.
- Review threads/requested changes are resolved with evidence.
- The canonical GitHub branch contains the approved implementation.
- The deployed production commit matches the approved repository state.
- Runtime/production health is checked after promotion.
- Evidence is recorded in GitHub and ClickUp.
- Final status is explicitly documented as **GO**.

## Merge and production deployment gate

Merge to `main` and production promotion are authorized when:

1. The closeout PR is mergeable and current with its base.
2. Required checks are green.
3. No unresolved requested changes or actionable P0/P1 review findings remain.
4. Required preview/browser verification passes.
5. No unresolved secret/security finding blocks release.
6. Production configuration/dependencies needed for the approved scope are verified.
7. The deployment target is identified and repository-to-deployment parity can be proven.

After promotion, run a production smoke test and verify runtime health. If production verification fails, record **NO-GO**, roll back or fix through the safest available path, and do not declare completion.

## Decision labels

Every evaluated technology or proposal receives one decision:

- `ADOPT`
- `PILOT`
- `REPLACE`
- `REJECT`
- `DEFER`

Each decision must include rationale, evidence, risks, conditions, owner, and review date.

## Completion standard

A checkbox or project status may be marked complete only when:

- The named capability/artifact exists.
- Its evidence is traceable.
- Acceptance criteria are explicitly evaluated.
- Contradictions are resolved or visibly recorded.
- Required owner approval is documented.
- Deployment claims, when applicable, are verified against the actual production target.

## Current execution directive

Recovery is complete and the baseline is stable. The next authorized action is not another planning-only Stage 0 loop. Execute the remaining Content Machine product gaps, verify them against this document, and drive the canonical implementation through one evidence-backed closeout PR to final production GO.