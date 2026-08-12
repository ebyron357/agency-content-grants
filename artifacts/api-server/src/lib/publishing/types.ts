/**
 * Provider-neutral publishing adapter contract. Mirrors the AIProvider pattern
 * in `lib/ai/types.ts`: core scheduling/retry logic (see
 * `lib/workflows/publishing-workflow.ts`) only ever talks to this interface,
 * never to a specific provider's SDK/REST shape. Adding a new platform means
 * adding one file that implements `PublishProvider` and registering it in
 * `lib/publishing/router.ts` — no other file changes.
 */

export interface PublishDestinationRef {
  /** Provider-specific identifier for the connected account (e.g. a Typefully social-set id). Null if not yet linked. */
  externalAccountId: string | null;
  /** The target platform, e.g. "x" | "linkedin" | "threads" | "bluesky" | "mastodon" | "demo". */
  platform: string;
  /** Provider-specific extra config, isolated from core scheduling fields. */
  config: Record<string, unknown> | null;
}

export interface PublishContent {
  title: string | null;
  content: string;
}

/**
 * Result of attempting to hand content to the provider. `confirmed: true` means
 * the provider has ALREADY told us it's live (safe to mark "published"
 * immediately). `confirmed: false` means the provider accepted the request but
 * publishing is not yet confirmed — the scheduler must poll `checkStatus`
 * before ever showing "published" to the user.
 */
export interface PublishAttemptResult {
  externalPostId: string;
  externalUrl: string | null;
  confirmed: boolean;
  providerPayload?: Record<string, unknown>;
}

export type ExternalPublishStatus =
  | { state: "published"; externalUrl: string | null }
  | { state: "pending" }
  | { state: "failed"; errorMessage: string };

/**
 * Result of asking the provider to cancel a submitted-but-not-yet-confirmed
 * post. `cancelled: false` is an expected outcome (the provider has no cancel
 * endpoint, or the post can no longer be pulled back) — it is NOT an error, so
 * implementations should return it rather than throw. Throwing is reserved
 * for transient/unexpected failures the caller should retry.
 */
export interface CancelResult {
  cancelled: boolean;
  /** True if the provider reports the post is already live: cancellation is impossible and the caller must treat this as published, never as cancelled. */
  alreadyPublished?: boolean;
  externalUrl?: string | null;
  reason?: string;
}

/**
 * A provider must throw this (never a plain `Error`) from `publish()` when it
 * can prove the content was never handed to — or was explicitly rejected
 * by — the provider (e.g. local validation failed before any request was
 * sent, or the provider responded with a definitive non-2xx rejection). This
 * is the ONLY category of publish failure safe to auto-retry for a provider
 * whose `publishIsIdempotent` is false: nothing was created externally, so
 * retrying cannot create a duplicate. Any other thrown error (a timeout, a
 * network failure, an unparseable success response) must be treated as
 * "submission unknown" — the request may have actually gone through even
 * though we never got a usable answer back.
 */
export class PublishNotSubmittedError extends Error {}

/**
 * Normalized post-performance indicators, shared across every analytics
 * provider (see docs/decisions/content-performance-engine.md). Fields that
 * not every provider reports (quotes/saves/profileClicks/linkClicks) are
 * nullable rather than defaulted to 0 — a real "0 people saved this" is
 * different from "this provider doesn't report saves", and callers must be
 * able to tell them apart instead of silently treating "unknown" as zero.
 */
export interface NormalizedPostMetrics {
  impressions: number;
  engagementTotal: number;
  likes: number;
  comments: number;
  shares: number;
  quotes: number | null;
  saves: number | null;
  profileClicks: number | null;
  linkClicks: number | null;
}

/** One post's analytics as reported by a provider, keyed for correlation back to our own ScheduledPublication.externalPostId. */
export interface ProviderPostAnalytics {
  /** Must match the externalPostId this provider returned at publish/checkStatus time. */
  externalPostId: string;
  postUrl: string | null;
  metrics: NormalizedPostMetrics;
  /** Full provider payload for this post, kept for audit/future-indicator use. */
  raw: Record<string, unknown>;
}

export interface PublishProvider {
  name: string;
  /** Whether this provider has the credentials/config it needs to be used right now. */
  isConfigured(): boolean;
  /**
   * True only if `publish()` can guarantee that calling it twice with the
   * same `idempotencyKey` never creates two external posts (e.g. the demo
   * provider's in-memory dedup map). When false, the workflow will NOT
   * automatically retry an ambiguous publish failure (anything other than a
   * `PublishNotSubmittedError`) — since a blind retry could create a real
   * duplicate post, an ambiguous outcome is instead surfaced as a terminal
   * failure requiring a human to verify on the provider directly before
   * republishing.
   */
  publishIsIdempotent: boolean;
  /**
   * Hand content to the provider for immediate or scheduled publishing. Must
   * throw on failure — never return a fabricated success. Throw
   * `PublishNotSubmittedError` specifically when the failure is proven to
   * have happened before/without the provider accepting the content; throw a
   * plain `Error` (or let a timeout propagate) for anything ambiguous.
   *
   * `idempotencyKey` is stable per scheduled publication (its row id) and is
   * passed on every attempt, including retries after a reclaimed stale claim.
   * Providers that support request deduplication should use it to guarantee
   * a retried/duplicated call never creates a second external post — this is
   * the caller's only defense against a duplicate dispatch when a prior claim
   * timed out on our side without the provider call actually having failed.
   * Providers that cannot deduplicate must document that limitation via
   * `publishIsIdempotent = false`; it is not safe to ignore this silently and
   * pretend the guarantee holds.
   */
  publish(destination: PublishDestinationRef, content: PublishContent, scheduledFor: Date, idempotencyKey: string): Promise<PublishAttemptResult>;
  /** Ask the provider for the current truth about a previously-submitted post. Must throw on failure to check (transient errors surface as retries, not as "published"). */
  checkStatus(destination: PublishDestinationRef, externalPostId: string): Promise<ExternalPublishStatus>;
  /**
   * Attempt to cancel a post that was already handed to the provider but not
   * yet confirmed live. Cancelling in our own database is not sufficient once
   * content has been submitted — this is what actually stops (or fails to
   * stop) the external post. Must throw only for transient/unexpected errors.
   */
  cancel(destination: PublishDestinationRef, externalPostId: string): Promise<CancelResult>;
  /**
   * Whether this provider's platform genuinely exposes a metrics/analytics
   * API. False means Content Machine must never display performance data for
   * this provider — there is no real data source behind it (see
   * docs/decisions/content-performance-engine.md: "no analytics is ever
   * displayed without a real data source"). Declared explicitly, mirroring
   * `publishIsIdempotent`, rather than inferred from whether `fetchAnalytics`
   * happens to be defined.
   */
  supportsAnalytics: boolean;
  /**
   * Fetch normalized post analytics for every post this provider knows about
   * for `destination` within [startDate, endDate] (inclusive, "YYYY-MM-DD").
   * Only present when `supportsAnalytics` is true. Must throw on failure —
   * never return estimated/fabricated numbers in place of a real answer.
   */
  fetchAnalytics?(destination: PublishDestinationRef, range: { startDate: string; endDate: string }): Promise<ProviderPostAnalytics[]>;
}
