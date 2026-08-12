# Decision: Content Performance Engine — metrics source

Per `docs/engineering-standards.md`, recorded before building.

## User problem

Once content is published (Content Distribution Engine), a user has no way to know
whether it actually worked: how many people saw it, engaged with it, on which channel,
for which topic/campaign/brand. Without that, "what should I create or repurpose next"
is a guess, not a decision. We need real, provider-sourced performance data — ingested
over time so trends are visible — surfaced as a dashboard and as evidence-backed
recommendations that never fabricate a number and never claim causation the data can't
support.

## Step 2/3: does the Distribution Engine's existing provider already expose this?

Checked before designing a separate ingestion path, per standards step 2 ("check
existing Content Machine capability") and step 3 ("check shared portfolio capability").

- The `PublishProvider` adapter (`artifacts/api-server/src/lib/publishing/types.ts`)
  only defines `publish`/`checkStatus`/`cancel` — no analytics method existed.
- **Typefully's live public API v2 does expose analytics**, confirmed against its
  current published OpenAPI document (`https://api.typefully.com/v2/openapi.json`,
  fetched 2026-08-12) — not just the narrower `docs/api` prose page:
  - `GET /v2/social-sets/{social_set_id}/analytics/{platform}/posts` — paginated,
    date-ranged list of posts with normalized `metrics.impressions` and
    `metrics.engagement.{total,likes,comments,shares,quotes,saves,profile_clicks,link_clicks}`,
    keyed by `draft_id` — which is exactly the id our adapter already stores as
    `ScheduledPublication.externalPostId` after a successful publish. This is a direct,
    reliable correlation key requiring no new lookup table.
  - `GET /v2/social-sets/{social_set_id}/analytics/{platform}/followers` — daily
    follower-count series per social set. Account-level, not tied to a single
    publication, so it's out of scope for this phase (see "Out of scope" below) but
    the same adapter could expose it later without a new provider integration.
  - Current coverage per Typefully's own docs: "X posts performance metrics by date
    range" — i.e. real, provider-confirmed metrics for X today; other platforms may be
    added by Typefully over time without any change needed on our side, since the
    adapter reads whatever the endpoint actually returns rather than assuming a fixed
    platform list.

**Decision: extend the existing `PublishProvider` adapter, not build a parallel
ingestion path.** This satisfies "extending an existing capability beats adding a
parallel one." Two new adapter members are added to the interface:

- `supportsAnalytics: boolean` — declared per provider, mirrors `publishIsIdempotent`'s
  pattern of an explicit, provider-declared capability flag rather than a duck-typed
  guess.
- `fetchAnalytics?(destination, { startDate, endDate }): Promise<ProviderPostAnalytics[]>`
  — optional, present only when `supportsAnalytics` is true.

`typefully` implements both against the real endpoint above. `demo` also implements
both (`supportsAnalytics = true`) so the full ingestion → normalization → aggregation →
recommendation pipeline is exercisable end-to-end in this sandbox without live
Typefully credentials (same rationale as the existing demo publish provider) — its
numbers are clearly labeled `source: "demo"` on every stored row and in the UI, never
presented as real platform data. This has not been exercised against a live Typefully
account in this environment (no `TYPEFULLY_API_KEY` configured here) — same caveat as
the existing publish/status/cancel methods; parsing is defensive and throws on an
unrecognized shape rather than guessing.

## Design: append-only, linked to the full content chain

- New table `performance_snapshots`: one row per (publication, ingestion run). Never
  updated or overwritten — trends over time come from querying the row history, not
  from a mutable "current stats" column. Each row carries normalized indicator fields
  (impressions, engagementTotal, likes, comments, shares, quotes, saves,
  profileClicks, linkClicks) shared across providers, plus the raw provider payload for
  audit/future-indicator use, and `source` (which provider produced it — `demo` never
  silently conflated with `typefully`).
- Linked via `scheduledPublicationId` → `scheduled_publications`, which already carries
  `brandId`, `projectId`, `destinationId` (channel/platform), and either `documentId` or
  `repurposedAssetId` (→ `repurposing_batches.campaignName` for campaign, and
  `documents`/`projects.topic` for topic/format) — no new FK chain needed to reach
  brand/project/document/campaign; the dashboard and recommendation queries join through
  the existing Distribution Engine schema.
- A publication only gets a snapshot once it is `status = "published"` — pending,
  failed, or cancelled content was never actually sent to the platform, so it must never
  gain a fabricated performance number.
- New table `performance_recommendations` persists each generated suggestion
  (evidence, correlation-vs-causation-framed rationale, dedupe key) with a
  `status` (`pending` | `accepted` | `dismissed`) an explicit acceptance-tracking
  mechanism, not just an ephemeral computed list — a user's accept/dismiss decision is
  preserved even when the underlying evidence is later recomputed.

## Out of scope for this phase

- Follower-count/account-growth analytics (Typefully's `/followers` endpoint) — not
  tied to a specific publication, so it doesn't fit the publication-linked schema this
  task calls for. Revisit alongside brand-level channel-growth reporting if requested.
- Any platform Typefully doesn't yet cover for analytics (its docs describe current
  coverage as X only) — the adapter calls the real endpoint and normalizes whatever
  comes back, so broader platform coverage lands automatically as Typefully expands it,
  with no code change required here.
- Predictive/ML forecasting — recommendations are rule-based over ingested evidence
  only, per the task's explicit scope.

## What would trigger revisiting this

- Typefully's analytics endpoint changes shape or is deprecated in favor of something
  else — isolated behind the same `PublishProvider` adapter boundary as publish/cancel,
  so only the one adapter file changes.
- A second real publish provider is added (see
  `docs/decisions/content-distribution-provider.md`) that also exposes analytics —
  its adapter implements `fetchAnalytics` the same way; the ingestion/aggregation/
  recommendation code is already provider-neutral.
- Follower/account-level analytics becomes a requested feature — add a separate
  brand/destination-linked table rather than overloading `performance_snapshots`.
