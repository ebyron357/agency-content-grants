# Decision: Content Distribution Engine — publishing provider

Per `docs/engineering-standards.md`, recorded before building.

## User problem

Approved content (documents and repurposed derivative assets) has nowhere to go once
approved — a user has to manually copy/paste into each platform, with no scheduling,
no record of what was posted where, and no way to see it failed vs. succeeded. We need
to let users connect a destination, schedule or immediately publish an approved piece,
see real (provider-confirmed) status, and retry failures — without Content Machine
building and maintaining a native OAuth integration for every social platform.

## Options considered

1. **Build native OAuth + posting for each platform (X, LinkedIn, etc.) ourselves.**
   Explicitly out of scope per the task brief. Rejected: high maintenance burden (each
   platform's API changes independently), large security surface (many OAuth apps and
   token stores), and directly duplicates commodity infrastructure the standards doc
   says to avoid rebuilding.

2. **Self-host Postiz (AGPL-3.0, OSS multi-platform scheduler).**
   - Licensing: AGPL is copyleft; running it only as an isolated self-hosted service
     (not linking its code into our app) would avoid disclosure obligations, but it's
     still a second full application (Next.js/Nx monorepo, its own Postgres + Redis)
     that needs deployment, patching, and its own OAuth app registrations per platform
     — i.e. it does not remove the "native OAuth app per platform" burden, it just
     relocates it into a second codebase we now operate.
   - Cost: real (hosting + ops), and violates "external projects are wrapped, never
     become a second app surface" — Postiz ships its own dashboard we'd have to avoid
     using, while still paying to run it.
   - Rejected for this environment: disproportionate ops cost for the affordability
     constraint, and not straightforward to run inside this project's sandbox.

3. **Ayrshare-style hosted aggregator API (pay-per-use SaaS, own token vault).**
   Viable in principle (single API key, many platforms) but is an unvetted paid
   third-party we'd need to newly contract with, with per-post cost at our unproven
   usage volume — no clear advantage here over an already-available option (#4).

4. **Typefully public API v2 (`api.typefully.com`), via Replit's own connector catalog
   entry (`connector_catalog:typefully`) — chosen.**
   - What it is: a hosted aggregator that creates/schedules/publishes drafts across X,
     LinkedIn, Threads, Bluesky, and Mastodon from one API call, using "social sets" to
     represent distinct accounts (maps cleanly onto our per-brand destinations), plus
     webhooks for publish-status events.
   - Licensing: proprietary hosted SaaS, API-key auth — no copyleft exposure, nothing
     imported into our codebase.
   - Security: single Bearer API key scoped to the user's own Typefully account;
     stored as a server-side secret, never sent to the frontend; no OAuth flow for us
     to build or secure.
   - Privacy: only the destination content we explicitly send it, plus whatever
     platforms the user's own Typefully account is already connected to.
   - Maintenance burden: low — REST API v2 launched Dec 2025, actively maintained,
     Content Machine only depends on a narrow "drafts" resource we wrap in one adapter.
   - Operating cost: usage-based, geared at personal/small-team automation — fits the
     affordability constraint far better than standing up and operating a second app.
   - Vendor lock-in / replacement path: isolated entirely behind our own
     `PublishProvider` adapter interface (mirrors the existing multi-provider AI router
     pattern in `artifacts/api-server/src/lib/ai/router.ts`). Swapping to Postiz's
     hosted API, Ayrshare, or a native platform integration later means writing one new
     adapter file — no changes to scheduling, retry, approval, or UI code.
   - Already available as a Replit-managed integration (`connector_catalog:typefully`),
     satisfying "check shared portfolio capability" (standards step 3) ahead of
     evaluating raw OSS/paid APIs from scratch (steps 4–5).

## Decision

Build one provider-neutral `PublishProvider` adapter interface. Ship two concrete
providers behind it:

- `demo` — always configured, deterministic simulated publish lifecycle
  (queued → provider-confirmed published after a short delay). Used for automated
  tests, local development, and any destination a user explicitly adds as "demo" to
  try the feature without connecting a real account. Mirrors the existing
  `demoProvider` fallback pattern in the AI router.
- `typefully` — real integration against Typefully's public API v2, gated behind
  `isConfigured()` (present only when `TYPEFULLY_API_KEY` is set). Not silently
  substituted with `demo` if unconfigured: a destination explicitly configured for
  `typefully` fails loudly with a clear "not configured" error rather than pretending
  to publish through a different provider.

Adding a second real platform integration later (Postiz's hosted API, Ayrshare, or a
native single-platform OAuth app) means adding one more file implementing
`PublishProvider` — no changes to the scheduling, retry, approval, or calendar logic.

## What would trigger revisiting this

- Typefully's usage-based pricing stops fitting actual publish volume once real usage
  data exists.
- A user needs a platform Typefully doesn't support (as of this decision: X, LinkedIn,
  Threads, Bluesky, Mastodon).
- Typefully's API/ToS changes in a way that stops fitting personal/small-team
  automation use (their docs note high-volume multi-tenant apps should use platform
  APIs directly instead).
