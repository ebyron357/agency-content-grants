import { randomUUID } from "crypto";
import type {
  PublishProvider,
  PublishDestinationRef,
  PublishContent,
  PublishAttemptResult,
  ExternalPublishStatus,
  CancelResult,
  NormalizedPostMetrics,
  ProviderPostAnalytics,
} from "./types";

/** Deterministic (non-random) string hash so demo analytics are stable across ingestion runs for the same post. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Deterministic simulated metrics for a demo post, derived only from the
 * post's own id and elapsed time since it was published — never
 * Math.random()/Date-seeded randomness — so re-ingesting the same post twice
 * a second apart doesn't produce contradictory numbers, and the pipeline
 * (ingestion -> aggregation -> recommendations) is reproducibly testable.
 * Clearly a simulation: every row this produces is stored with source
 * "demo" so it is never displayed as real platform data.
 */
export function simulatedMetricsForPost(externalPostId: string, publishedAt: Date, now: Date): NormalizedPostMetrics {
  const seed = hashSeed(externalPostId);
  const daysElapsed = Math.max(0, (now.getTime() - publishedAt.getTime()) / 86_400_000);
  const baseImpressions = 200 + (seed % 800); // deterministic 200-1000 base, per post
  const growth = 1 + Math.log2(daysElapsed + 1); // monotonically increasing, diminishing-returns curve
  const impressions = Math.round(baseImpressions * growth);
  const engagementRate = 0.03 + ((seed % 100) / 100) * 0.05; // deterministic 3%-8% engagement rate
  const engagementTotal = Math.round(impressions * engagementRate);
  const likes = Math.round(engagementTotal * 0.6);
  const comments = Math.round(engagementTotal * 0.15);
  const shares = Math.round(engagementTotal * 0.15);
  const quotes = Math.round(engagementTotal * 0.05);
  const saves = Math.round(engagementTotal * 0.05);
  const profileClicks = Math.round(impressions * 0.01);
  const linkClicks = Math.round(impressions * 0.008);
  return { impressions, engagementTotal, likes, comments, shares, quotes, saves, profileClicks, linkClicks };
}

/**
 * Always-available simulated provider. Used for automated tests, local
 * development, and any destination a user explicitly creates with provider
 * "demo" to try the feature before connecting a real account.
 *
 * Deliberately two-phase (publish() never confirms immediately) so the
 * scheduler's confirm-polling path — not just the immediate-confirm path — is
 * genuinely exercised. checkStatus() confirms on the first poll after
 * publish(), matching how a real provider like Typefully confirms
 * asynchronously once a scheduled draft actually goes live.
 *
 * Never silently substituted for a real, misconfigured provider — see
 * lib/publishing/router.ts.
 *
 * Also the reference implementation of idempotency-key dedup: a real "retry
 * after a reclaimed stale claim" scenario must never create a second demo
 * post for the same scheduled publication, so `publish()` remembers every
 * key it has seen and returns the original result on a repeat.
 */
export class DemoPublishProvider implements PublishProvider {
  name = "demo";
  // Backed by the real dedup below: a retried publish() with the same key
  // always returns the original result instead of creating a second post.
  publishIsIdempotent = true;

  private readonly seenIdempotencyKeys = new Map<string, PublishAttemptResult>();
  // Tracks when each demo post was "published" so fetchAnalytics can derive a
  // deterministic, monotonically-growing metrics curve — never a lookup a
  // real provider wouldn't also be able to do from its own publish record.
  private readonly publishedAt = new Map<string, Date>();

  // Demo's platform is entirely simulated by this class, so it can honestly
  // declare analytics support to exercise the full ingestion pipeline
  // end-to-end without live provider credentials (see
  // docs/decisions/content-performance-engine.md).
  supportsAnalytics = true;

  isConfigured(): boolean {
    return true;
  }

  async publish(_destination: PublishDestinationRef, _content: PublishContent, _scheduledFor: Date, idempotencyKey: string): Promise<PublishAttemptResult> {
    const existing = this.seenIdempotencyKeys.get(idempotencyKey);
    if (existing) return existing;

    const result: PublishAttemptResult = {
      externalPostId: `demo_${randomUUID()}`,
      externalUrl: null,
      confirmed: false,
      providerPayload: { submittedAt: new Date().toISOString() },
    };
    this.seenIdempotencyKeys.set(idempotencyKey, result);
    this.publishedAt.set(result.externalPostId, new Date());
    return result;
  }

  async checkStatus(_destination: PublishDestinationRef, externalPostId: string): Promise<ExternalPublishStatus> {
    if (!externalPostId.startsWith("demo_")) {
      return { state: "failed", errorMessage: "Unknown demo post id" };
    }
    return { state: "published", externalUrl: `https://demo.local/posts/${externalPostId}` };
  }

  /**
   * The demo provider never confirms on the first publish() call (see above),
   * so anything a caller might cancel is by definition still un-confirmed —
   * cancellation always succeeds. This still exercises the real
   * cancel-before-confirm code path in the scheduler/workflow tests.
   */
  async cancel(_destination: PublishDestinationRef, _externalPostId: string): Promise<CancelResult> {
    return { cancelled: true };
  }

  /**
   * Simulated analytics for every demo post this instance has issued. Since
   * this map only lives in process memory, a server restart resets it —
   * acceptable for a demo/dev provider (same limitation as its idempotency
   * dedup map above) and clearly not something a real provider integration
   * would ever do.
   */
  async fetchAnalytics(_destination: PublishDestinationRef, range: { startDate: string; endDate: string }): Promise<ProviderPostAnalytics[]> {
    const now = new Date();
    const start = new Date(`${range.startDate}T00:00:00.000Z`);
    const end = new Date(`${range.endDate}T23:59:59.999Z`);
    const results: ProviderPostAnalytics[] = [];
    for (const [externalPostId, postedAt] of this.publishedAt.entries()) {
      if (postedAt < start || postedAt > end) continue;
      const metrics = simulatedMetricsForPost(externalPostId, postedAt, now);
      results.push({
        externalPostId,
        postUrl: `https://demo.local/posts/${externalPostId}`,
        metrics,
        raw: { simulated: true, publishedAt: postedAt.toISOString(), generatedAt: now.toISOString() },
      });
    }
    return results;
  }
}

export const demoPublishProvider = new DemoPublishProvider();
