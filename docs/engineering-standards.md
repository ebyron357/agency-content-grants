# Content Machine — Engineering Standards (Access-First, Reuse-First)

Governance document. Binding for all future work on Content Machine — agents and humans. It exists to keep the platform affordable to build and operate, avoid reinventing commodity infrastructure, and keep engineering effort concentrated on what actually differentiates Content Machine as a product.

This document does not change any existing behavior, UI, API, schema, or deployment. It governs how *future* work is decided and recorded.

In the project owner's own words:
- "we need to utilize it" — reuse before rebuilding.
- "make these apps... affordable" — cost is an architecture constraint, not an afterthought.
- "open source is legit... I don't give a fuck where it's from" — provenance/popularity is not a filter; fitness for purpose is.
- "we dress it up with our UI, our dash, our look, our modernization" — external projects are wrapped and adapted behind Content Machine's own product surface; they are never the product surface itself.

## Decision sequence (required, in order, before building new functionality)

1. **Define the real user problem first.** Write down, in plain language, what a Content Machine user is trying to accomplish and why the current product doesn't get them there. No solution path is chosen before this is explicit.
2. **Check existing Content Machine capability.** Search this repo's schema, routes, libs, and UI for something that already solves it or is close. Extending an existing capability beats adding a parallel one.
3. **Check shared portfolio capability.** Check whether a sibling Replit project/artifact/shared library already solves this problem (auth, object storage, AI provider routing, etc.) before rebuilding it inside Content Machine.
4. **Evaluate vetted open source for commodity functionality.** If the problem is commodity infrastructure (crawling, document parsing, scheduling/queues, webhook delivery, calendar UI, SERP/keyword data, LLM observability, workflow automation), identify real candidates and evaluate them — do not default to building from scratch because it "seems simple."
5. **Compare API/service options.** Where a hosted API/service exists (search, SERP data, publishing aggregation, analytics), compare at least two on cost, reliability, and terms before committing.
6. **Build custom only where needed or strategically justified.** Custom build is justified when: (a) nothing vetted fits the actual requirement, (b) the capability is core to Content Machine's competitive differentiation (see "Owned product layer"), or (c) integrating an external option would cost more in engineering/ops than a narrow, purpose-built version.
7. **Record the reasoning.** Every non-trivial build-vs-integrate decision is written down (see "Where to record decisions") with: problem statement, options considered, why the chosen option won, and what would trigger revisiting it.

## Evaluation criteria (apply to every candidate — OSS, API/service, or custom build)

For each option seriously considered, check and record:

- **Licensing** — compatible with a commercial, closed-source product? Watch for copyleft terms (e.g. AGPL/SSPL-style) that could force disclosure if linked into Content Machine's own code; using such a project only as an isolated self-hosted service may still be fine — check the specific clause.
- **Security** — attack surface added, track record, how secrets/credentials are handled.
- **Privacy** — what user/brand/content data flows to or through it, and under what terms.
- **Accessibility** — for anything touching the UI or generated content, does it support accessible output/interaction.
- **Maintenance burden** — who patches it, how active is the project, what happens if it's abandoned.
- **Operating cost** — actual dollar cost at expected usage volume, not list price at zero scale. Affordability is a hard constraint (see below).
- **Vendor lock-in** — how hard is it to leave; is data portable; is the integration point an adapter or a hard dependency woven through the codebase.
- **Replacement path** — if this stops being viable in a year, what does swapping it out look like. No credible answer is a reason to isolate it behind an adapter, not a reason to avoid the option outright.

**Never treat popularity or GitHub star count as evidence of suitability.** A project is evaluated on fitness against the criteria above — not fame. Equally, obscurity is not disqualifying; the same criteria apply either way.

## Owned product layer — do not outsource or dilute

Content Machine's own domain model, UX, and product logic are the thing being built, and are never satisfied by importing someone else's app wholesale. This includes, at minimum:

- Brands and Brand Brain (voice, knowledge entries, validation/scoring)
- Projects and the content lifecycle (research → outline → draft → quality → approval → export)
- Research/evidence relationships (sources, claims, provenance, verification status)
- Approvals and review workflows
- Content intelligence (quality evaluation, brand-consistency scoring, and future SEO/performance intelligence)

External projects may power *infrastructure underneath* these (crawling, parsing, scheduling, publishing transport, observability plumbing), but never become the product surface. Users interact with Content Machine's own UI, data model, and workflows at all times.

## Integration pattern — adapters, not applications

When a vetted external project is adopted:

- Wrap it behind a narrow, replaceable adapter/service boundary specific to the capability it provides (a "crawler" interface, a "publishing provider" interface, an "LLM observability sink" interface) — not a direct, scattered dependency on its SDK throughout the codebase.
- Do not import or run an entire external application as Content Machine's UI or as a user-facing surface. If the external project is itself a full app (e.g. a self-hosted publishing dashboard), only its API/service layer is integrated; Content Machine's own UI remains what the user sees ("our UI, our dash, our look, our modernization").
- Prefer the option that lets Content Machine swap the underlying provider without a schema or UX rewrite.

## Affordability and access constraints

- Cost — both the external service's price and the engineering/ops cost of running it — is an architectural constraint on every decision in this document, not a final check at the end. Prefer usage-based or free/self-hosted tiers over large fixed commitments while Content Machine's own usage volume is unproven.
- Content Machine must remain viable for professional and educational access. Do not choose an option whose pricing model or minimum spend would price out that audience when a comparable option exists that doesn't.

## Verification before claiming completion

No feature — custom-built or integration-based — is "done" until:

- Automated tests covering it pass (not just typecheck).
- Real behavior has been checked end-to-end (an actual request/response, not just reading the code).
- Any new external dependency's actual behavior (not just its docs) has been verified against real Content Machine data it will touch.

## Where to record decisions

- Build-vs-integrate reasoning for a specific feature: a short "Decision" note in the relevant task/PR description, referencing this document's evaluation criteria explicitly.
- Standing architectural choices future work should stay consistent with: `replit.md` → "Architecture decisions".
- This document itself changes only when the standard changes, not per-feature.

## Current first-pass candidate set (for future evaluation only — not adopted, not installed)

Starting points for the "evaluate vetted open source" step above, not commitments. Each still requires the full evaluation above before any code depends on it. **None of the following are installed or wired into the app by this document.**

| Capability | Candidate(s) | Where it would matter |
|---|---|---|
| Document ingestion (beyond current PDF/text) | MarkItDown | Research Engine — normalizing varied source document formats |
| Isolated web research crawling | Crawl4AI or an equivalent sandboxed crawler | Research Engine — automated source discovery/retrieval; must run isolated from the rest of the app since it touches untrusted content |
| SEO intelligence | OpenSEO (as an architecture/concepts reference, not necessarily the dependency itself) | SEO Intelligence module |
| Social distribution + approvals | Postiz / BrightBean / TryPost (patterns) | Distribution Engine — provider abstraction, scheduling, approval-before-publish |
| LLM observability/evaluation | Langfuse | AI observability — extending the existing `generation_runs` tracking with tracing/eval tooling |
| External workflow automation | n8n | Automation foundation — Content Machine exposes events/actions; n8n (or similar) is the external orchestrator, not built into Content Machine |

Adopting any of these requires the decision-sequence steps above, a recorded decision, and an adapter boundary — applied when that specific engine is actually scheduled for work.
