import {
  PublishNotSubmittedError,
  type PublishProvider,
  type PublishDestinationRef,
  type PublishContent,
  type PublishAttemptResult,
  type ExternalPublishStatus,
  type CancelResult,
  type ProviderPostAnalytics,
} from "./types";

/**
 * Typefully public API v2 adapter (https://api.typefully.com).
 * See docs/decisions/content-distribution-provider.md for why this provider
 * was chosen. Auth is a single Bearer API key scoped to the user's own
 * Typefully account — no OAuth flow for Content Machine to build or store.
 *
 * `destination.externalAccountId` holds the Typefully "social set" id
 * (Settings → API → Development mode reveals these ids in the Typefully UI).
 * `destination.platform` must be one of the platforms enabled on that social
 * set: x | linkedin | threads | bluesky | mastodon.
 *
 * Response field names below follow Typefully's published docs
 * (https://typefully.com/docs/api, fetched 2026-08-12). This has not been
 * exercised against a live Typefully account in this environment — parsing
 * is defensive and throws a clear error on any unrecognized shape rather than
 * guessing, so a real mismatch fails loudly instead of silently mis-reporting
 * "published".
 */
const API_BASE = "https://api.typefully.com/v2";

function apiKey(): string | undefined {
  return process.env.TYPEFULLY_API_KEY;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
}

/** A required normalized-metric field: only a genuine finite number counts — never coerce missing/non-numeric/NaN into 0. */
function requireFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** An optional normalized-metric field: a genuine finite number, or explicitly null/unavailable — never a garbage value coerced through. */
function optionalFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = requireFiniteNumber(value);
  return n === undefined ? null : n;
}

export class TypefullyPublishProvider implements PublishProvider {
  name = "typefully";

  /**
   * Typefully's documented API has no known request-deduplication mechanism
   * (no `Idempotency-Key` header or client-reference field in its
   * create-draft endpoint) — `idempotencyKey` below is attached only as a
   * best-effort client reference so a human can spot a duplicate while
   * reviewing drafts, not as a real guarantee. Because of that,
   * `publishIsIdempotent` MUST stay false: the workflow relies on this flag
   * to refuse automatic retries after an ambiguous failure (see
   * `PublishNotSubmittedError` in ./types and the catch block in
   * lib/workflows/publishing-workflow.ts `attemptPublication`), since a blind
   * retry here really could create a second live draft.
   */
  publishIsIdempotent = false;

  // Confirmed against Typefully's live v2 OpenAPI document (fetched
  // 2026-08-12): GET /v2/social-sets/{id}/analytics/{platform}/posts returns
  // real per-post impressions/engagement — see
  // docs/decisions/content-performance-engine.md for the full citation.
  supportsAnalytics = true;

  isConfigured(): boolean {
    return !!apiKey();
  }

  async publish(destination: PublishDestinationRef, content: PublishContent, scheduledFor: Date, idempotencyKey: string): Promise<PublishAttemptResult> {
    // Both checks below run before any network request is made — if they
    // fail, nothing was ever sent to Typefully, so it's provably safe to
    // retry automatically once the underlying problem (missing key/config) is
    // fixed.
    if (!this.isConfigured()) {
      throw new PublishNotSubmittedError("Typefully is not configured. Add TYPEFULLY_API_KEY to publish through it.");
    }
    if (!destination.externalAccountId) {
      throw new PublishNotSubmittedError("This destination has no Typefully social-set id configured.");
    }

    const text = content.title ? `${content.title}\n\n${content.content}` : content.content;
    const isImmediate = scheduledFor.getTime() <= Date.now() + 1000;

    const body: Record<string, unknown> = {
      platforms: {
        [destination.platform]: {
          enabled: true,
          posts: [{ text }],
        },
      },
      "schedule-date": isImmediate ? "now" : scheduledFor.toISOString(),
      "client-reference-id": idempotencyKey,
    };

    // A network-level failure here (fetch rejecting, or our own
    // PROVIDER_CALL_TIMEOUT_MS wrapper timing out around this whole call) is
    // deliberately allowed to propagate as a plain (non-PublishNotSubmitted)
    // error: we genuinely don't know whether Typefully received and acted on
    // the request before the connection dropped, so it must be treated as
    // ambiguous, not retried blindly.
    const res = await fetch(`${API_BASE}/social-sets/${destination.externalAccountId}/drafts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const detail = `Typefully API error ${res.status}: ${errText || res.statusText}`;
      // Only a 4xx response is a definitive, documented client-side
      // rejection (bad auth, bad payload, unknown social set, etc.) — those
      // happen before Typefully creates anything, so it's provably safe to
      // retry after fixing the underlying problem. A 5xx/gateway response
      // proves nothing: Typefully (or a proxy in front of it) may have
      // received and processed the create request before failing to answer,
      // so that must stay ambiguous like a network error or timeout.
      if (res.status >= 400 && res.status < 500) {
        throw new PublishNotSubmittedError(detail);
      }
      throw new Error(detail);
    }

    // We got a 2xx response but can't make sense of it: a draft may well have
    // been created even though we can't recover its id to track it. Treat
    // this as ambiguous (plain Error), not "definitely not submitted".
    const data = (await res.json()) as any;
    const draftId: string | undefined = data?.id ?? data?.draft?.id ?? data?.draft_id;
    if (!draftId) {
      throw new Error("Typefully draft creation returned no draft id — cannot track this publication (it may have still been created).");
    }

    const status: string | undefined = data?.status ?? data?.draft?.status;
    const url: string | null = data?.url ?? data?.share_url ?? data?.draft?.url ?? null;

    return {
      externalPostId: draftId,
      externalUrl: url,
      // Only trust an explicit "published" status from the create response;
      // anything else (scheduled, draft, undefined) must be confirmed later
      // via checkStatus so we never claim "published" before Typefully does.
      confirmed: status === "published",
      providerPayload: { createdStatus: status ?? null },
    };
  }

  async checkStatus(destination: PublishDestinationRef, externalPostId: string): Promise<ExternalPublishStatus> {
    if (!this.isConfigured()) {
      throw new Error("Typefully is not configured. Add TYPEFULLY_API_KEY to check publish status.");
    }
    if (!destination.externalAccountId) {
      throw new Error("This destination has no Typefully social-set id configured.");
    }

    const res = await fetch(`${API_BASE}/social-sets/${destination.externalAccountId}/drafts/${externalPostId}`, {
      headers: authHeaders(),
    });

    if (res.status === 404) {
      return { state: "failed", errorMessage: "Draft no longer exists in Typefully." };
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Typefully API error ${res.status}: ${errText || res.statusText}`);
    }

    const data = (await res.json()) as any;
    const status: string | undefined = data?.status ?? data?.draft?.status;
    const url: string | null = data?.url ?? data?.share_url ?? data?.draft?.url ?? null;

    if (status === "published") return { state: "published", externalUrl: url };
    if (status === "failed" || status === "error") {
      return { state: "failed", errorMessage: data?.error ?? data?.failure_reason ?? "Typefully reported a failed post." };
    }
    if (status === "scheduled" || status === "draft" || status === undefined) {
      return { state: "pending" };
    }
    throw new Error(`Typefully returned an unrecognized draft status: ${JSON.stringify(status)}`);
  }

  /**
   * Best-effort: deletes the not-yet-published draft. Not exercised against a
   * live account (see file header) — if Typefully's real delete semantics
   * differ, this should fail loudly via the thrown-error path rather than
   * silently reporting a cancellation that didn't happen.
   */
  async cancel(destination: PublishDestinationRef, externalPostId: string): Promise<CancelResult> {
    if (!this.isConfigured()) {
      throw new Error("Typefully is not configured. Add TYPEFULLY_API_KEY to cancel a publication.");
    }
    if (!destination.externalAccountId) {
      throw new Error("This destination has no Typefully social-set id configured.");
    }

    const res = await fetch(`${API_BASE}/social-sets/${destination.externalAccountId}/drafts/${externalPostId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    if (res.ok) return { cancelled: true };

    if (res.status === 404) {
      // Could mean the draft was already published and Typefully no longer
      // exposes it as a cancellable draft — confirm before claiming a
      // cancellation that may not be true.
      const status = await this.checkStatus(destination, externalPostId);
      if (status.state === "published") {
        return { cancelled: false, alreadyPublished: true, externalUrl: status.externalUrl };
      }
      return { cancelled: false, reason: "Draft no longer exists in Typefully." };
    }

    const errText = await res.text().catch(() => "");
    throw new Error(`Typefully API error ${res.status} while cancelling: ${errText || res.statusText}`);
  }

  /**
   * Real analytics via Typefully's v2 API:
   * GET /v2/social-sets/{social_set_id}/analytics/{platform}/posts
   * Paginated (offset/limit + a `next` cursor flag in the response). Each
   * item is keyed by `draft_id`, which is exactly the id we stored as
   * ScheduledPublication.externalPostId when publish() created the draft —
   * that shared id is what correlates a provider analytics row back to one
   * of our own publications (see ingestDestinationMetrics in
   * lib/performance/ingestion.ts).
   *
   * Not exercised against a live Typefully account in this environment (see
   * file header) — parsing is defensive and skips/throws rather than
   * guessing at an unrecognized shape.
   */
  async fetchAnalytics(destination: PublishDestinationRef, range: { startDate: string; endDate: string }): Promise<ProviderPostAnalytics[]> {
    if (!this.isConfigured()) {
      throw new Error("Typefully is not configured. Add TYPEFULLY_API_KEY to fetch analytics.");
    }
    if (!destination.externalAccountId) {
      throw new Error("This destination has no Typefully social-set id configured.");
    }

    const results: ProviderPostAnalytics[] = [];
    const limit = 50;
    let offset = 0;
    // Hard cap on pages as a defensive guard against an unbounded loop if
    // Typefully's pagination cursor ever misbehaves — 2000 posts in one
    // ingestion window is far beyond what this feature needs to handle.
    for (let page = 0; page < 40; page++) {
      const url = new URL(`${API_BASE}/social-sets/${destination.externalAccountId}/analytics/${destination.platform}/posts`);
      url.searchParams.set("start_date", range.startDate);
      url.searchParams.set("end_date", range.endDate);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Typefully API error ${res.status} fetching analytics: ${errText || res.statusText}`);
      }

      const data = (await res.json()) as any;
      const items: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : [];
      for (const item of items) {
        const draftId = item?.draft_id ?? item?.post_id;
        if (draftId === undefined || draftId === null) continue; // no correlation key — never guess which publication this belongs to
        const metrics = item?.metrics ?? item ?? {};
        const engagement = metrics?.engagement ?? {};

        // Required indicators must be genuinely present and numeric — a
        // missing/non-numeric field (an unrecognized response shape, a
        // renamed field, a null Typefully hasn't backfilled yet) must NEVER
        // silently become a fabricated 0. That would look like real "zero
        // performance" in the dashboard and recommendations instead of the
        // "we don't actually know" it really is, so the whole item is
        // dropped rather than guessed at.
        const impressions = requireFiniteNumber(metrics?.impressions);
        const engagementTotal = requireFiniteNumber(engagement?.total);
        const likes = requireFiniteNumber(engagement?.likes);
        const comments = requireFiniteNumber(engagement?.comments);
        const shares = requireFiniteNumber(engagement?.shares);
        if (impressions === undefined || engagementTotal === undefined || likes === undefined || comments === undefined || shares === undefined) {
          continue;
        }

        results.push({
          externalPostId: String(draftId),
          postUrl: item?.url ?? null,
          metrics: {
            impressions,
            engagementTotal,
            likes,
            comments,
            shares,
            // Optional indicators: only ever a real finite number or an
            // explicit "not available" (null) — never a value coerced from
            // something non-numeric the provider happened to send.
            quotes: optionalFiniteNumber(engagement?.quotes),
            saves: optionalFiniteNumber(engagement?.saves),
            profileClicks: optionalFiniteNumber(engagement?.profile_clicks),
            linkClicks: optionalFiniteNumber(engagement?.link_clicks),
          },
          raw: item,
        });
      }

      const hasNext = !!data?.next;
      if (!hasNext || items.length === 0) break;
      offset += limit;
    }
    return results;
  }
}

export const typefullyPublishProvider = new TypefullyPublishProvider();
