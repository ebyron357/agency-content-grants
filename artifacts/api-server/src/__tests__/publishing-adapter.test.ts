/**
 * Publishing adapter contract unit tests (deterministic, no DB/network).
 * Verifies the PublishProvider interface implementations and the router that
 * looks them up — the seam that lets a second real provider be added later
 * without touching core scheduling/retry logic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DemoPublishProvider } from "../lib/publishing/demo-provider";
import { TypefullyPublishProvider } from "../lib/publishing/typefully-provider";
import { PUBLISH_PROVIDERS, isValidPublishProvider, getPublishProvider, getPublishProvidersStatus } from "../lib/publishing/router";
import { PublishNotSubmittedError } from "../lib/publishing/types";

const destination = { externalAccountId: "acct_1", platform: "x", config: null };

describe("DemoPublishProvider", () => {
  const provider = new DemoPublishProvider();

  it("is always configured", () => {
    expect(provider.isConfigured()).toBe(true);
  });

  it("publish() never confirms immediately (two-phase, like a real async provider)", async () => {
    const result = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-1");
    expect(result.confirmed).toBe(false);
    expect(result.externalPostId).toMatch(/^demo_/);
  });

  it("checkStatus() confirms a post it issued", async () => {
    const issued = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-2");
    const status = await provider.checkStatus(destination, issued.externalPostId);
    expect(status.state).toBe("published");
  });

  it("checkStatus() fails loudly for an unrecognized post id instead of guessing", async () => {
    const status = await provider.checkStatus(destination, "not-a-demo-id");
    expect(status.state).toBe("failed");
  });

  it("cancel() reports success instead of silently no-op'ing (satisfies the adapter's cancel contract)", async () => {
    const issued = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-3");
    const result = await provider.cancel(destination, issued.externalPostId!);
    expect(result.cancelled).toBe(true);
  });

  it("publish() with a repeated idempotencyKey returns the original result instead of creating a second post", async () => {
    const first = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-repeat");
    const second = await provider.publish(destination, { title: "different title", content: "different content" }, new Date(), "idem-repeat");
    expect(second.externalPostId).toBe(first.externalPostId);
  });

  it("publish() with a different idempotencyKey creates a distinct post", async () => {
    const first = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-a");
    const second = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-b");
    expect(second.externalPostId).not.toBe(first.externalPostId);
  });

  it("declares itself idempotent — it backs that claim with real dedup, so the workflow may auto-retry any failure", () => {
    expect(provider.publishIsIdempotent).toBe(true);
  });

  it("declares analytics support and returns deterministic simulated metrics for a post it issued", async () => {
    expect(provider.supportsAnalytics).toBe(true);
    const issued = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-analytics-1");
    const today = new Date().toISOString().slice(0, 10);
    const analytics1 = await provider.fetchAnalytics!(destination, { startDate: "2020-01-01", endDate: today });
    const analytics2 = await provider.fetchAnalytics!(destination, { startDate: "2020-01-01", endDate: today });
    const post1 = analytics1.find((a) => a.externalPostId === issued.externalPostId);
    const post2 = analytics2.find((a) => a.externalPostId === issued.externalPostId);
    expect(post1).toBeDefined();
    // Deterministic (hash + elapsed-time based, not Math.random()) — two calls
    // moments apart must agree, or the whole pipeline's tests would be flaky.
    expect(post2!.metrics).toEqual(post1!.metrics);
    expect(post1!.raw.simulated).toBe(true); // always clearly labeled as simulated, never confusable with real data
  });

  it("fetchAnalytics excludes posts published outside the requested date range", async () => {
    const issued = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-analytics-2");
    const analytics = await provider.fetchAnalytics!(destination, { startDate: "2000-01-01", endDate: "2000-01-02" });
    expect(analytics.find((a) => a.externalPostId === issued.externalPostId)).toBeUndefined();
  });
});

describe("TypefullyPublishProvider", () => {
  const originalKey = process.env.TYPEFULLY_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.TYPEFULLY_API_KEY;
    else process.env.TYPEFULLY_API_KEY = originalKey;
  });

  it("is not configured when TYPEFULLY_API_KEY is unset", () => {
    delete process.env.TYPEFULLY_API_KEY;
    const provider = new TypefullyPublishProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it("is configured once TYPEFULLY_API_KEY is set", () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const provider = new TypefullyPublishProvider();
    expect(provider.isConfigured()).toBe(true);
  });

  it("refuses to publish when unconfigured instead of silently no-op'ing", async () => {
    delete process.env.TYPEFULLY_API_KEY;
    const provider = new TypefullyPublishProvider();
    await expect(provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-1")).rejects.toThrow();
  });

  it("refuses to cancel when unconfigured instead of silently reporting a false cancellation", async () => {
    delete process.env.TYPEFULLY_API_KEY;
    const provider = new TypefullyPublishProvider();
    await expect(provider.cancel(destination, "draft_1")).rejects.toThrow();
  });

  it("declares itself NOT idempotent — it has no verified provider-side dedup, so the workflow must not auto-retry ambiguous failures", () => {
    const provider = new TypefullyPublishProvider();
    expect(provider.publishIsIdempotent).toBe(false);
  });

  it("throws PublishNotSubmittedError (safe to auto-retry) when unconfigured — nothing was ever sent", async () => {
    delete process.env.TYPEFULLY_API_KEY;
    const provider = new TypefullyPublishProvider();
    await expect(provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-1")).rejects.toBeInstanceOf(PublishNotSubmittedError);
  });

  it("throws PublishNotSubmittedError (safe to auto-retry) when the destination has no social-set id — nothing was ever sent", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const provider = new TypefullyPublishProvider();
    await expect(provider.publish({ ...destination, externalAccountId: null }, { title: "t", content: "c" }, new Date(), "idem-1")).rejects.toBeInstanceOf(PublishNotSubmittedError);
  });

  it("throws PublishNotSubmittedError (safe to auto-retry) when Typefully rejects the request outright (non-2xx response)", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response("bad request", { status: 400, statusText: "Bad Request" })) as any;
    try {
      const provider = new TypefullyPublishProvider();
      await expect(provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-1")).rejects.toBeInstanceOf(PublishNotSubmittedError);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws a plain (ambiguous, NOT PublishNotSubmittedError) error on a 5xx/gateway response — Typefully may have processed the request before failing to answer", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response("upstream timeout", { status: 502, statusText: "Bad Gateway" })) as any;
    try {
      const provider = new TypefullyPublishProvider();
      const err = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-1").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PublishNotSubmittedError);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws a plain (ambiguous, NOT PublishNotSubmittedError) error when a 2xx response can't be parsed into a draft id — a draft may still have been created", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response(JSON.stringify({ status: "draft" }), { status: 200 })) as any;
    try {
      const provider = new TypefullyPublishProvider();
      const err = await provider.publish(destination, { title: "t", content: "c" }, new Date(), "idem-1").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PublishNotSubmittedError);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("declares analytics support and maps the real v2 analytics response shape, correlating by draft_id", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const provider = new TypefullyPublishProvider();
    expect(provider.supportsAnalytics).toBe(true);
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              draft_id: "draft_123",
              url: "https://x.com/foo/status/1",
              metrics: { impressions: 5000, engagement: { total: 250, likes: 200, comments: 30, shares: 20, saves: 5, profile_clicks: 10, link_clicks: 3 } },
            },
            { draft_id: null, metrics: { impressions: 999 } }, // no correlation id — must be skipped, never guessed
          ],
          next: false,
        }),
        { status: 200 },
      )) as any;
    try {
      const analytics = await provider.fetchAnalytics!({ externalAccountId: "ss_1", platform: "x", config: null }, { startDate: "2026-08-01", endDate: "2026-08-12" });
      expect(analytics).toHaveLength(1);
      expect(analytics[0].externalPostId).toBe("draft_123");
      expect(analytics[0].metrics.impressions).toBe(5000);
      expect(analytics[0].metrics.engagementTotal).toBe(250);
      expect(analytics[0].metrics.saves).toBe(5);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("fetchAnalytics throws (never returns fabricated data) when unconfigured", async () => {
    delete process.env.TYPEFULLY_API_KEY;
    const provider = new TypefullyPublishProvider();
    await expect(provider.fetchAnalytics!(destination, { startDate: "2026-08-01", endDate: "2026-08-12" })).rejects.toThrow();
  });

  it("never fabricates a zero for a required metric that is missing, null, or non-numeric — drops the whole item instead", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const provider = new TypefullyPublishProvider();
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { draft_id: "missing_impressions", metrics: { engagement: { total: 10, likes: 5, comments: 3, shares: 2 } } }, // impressions absent entirely
            { draft_id: "null_engagement_total", metrics: { impressions: 100, engagement: { total: null, likes: 5, comments: 3, shares: 2 } } },
            { draft_id: "non_numeric_likes", metrics: { impressions: 100, engagement: { total: 10, likes: "n/a", comments: 3, shares: 2 } } },
            { draft_id: "fully_valid", metrics: { impressions: 100, engagement: { total: 10, likes: 5, comments: 3, shares: 2 } } },
          ],
          next: false,
        }),
        { status: 200 },
      )) as any;
    try {
      const analytics = await provider.fetchAnalytics!({ externalAccountId: "ss_1", platform: "x", config: null }, { startDate: "2026-08-01", endDate: "2026-08-12" });
      // Only the one fully-valid item survives — the other three are dropped
      // outright rather than persisted with a fabricated 0 for the field
      // that was missing/null/non-numeric.
      expect(analytics).toHaveLength(1);
      expect(analytics[0].externalPostId).toBe("fully_valid");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("treats a missing/non-numeric OPTIONAL metric (e.g. saves) as explicitly null, never as a coerced garbage value", async () => {
    process.env.TYPEFULLY_API_KEY = "test-key";
    const provider = new TypefullyPublishProvider();
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { draft_id: "d1", metrics: { impressions: 100, engagement: { total: 10, likes: 5, comments: 3, shares: 2, saves: "unknown", profile_clicks: undefined } } },
          ],
          next: false,
        }),
        { status: 200 },
      )) as any;
    try {
      const analytics = await provider.fetchAnalytics!({ externalAccountId: "ss_1", platform: "x", config: null }, { startDate: "2026-08-01", endDate: "2026-08-12" });
      expect(analytics).toHaveLength(1);
      expect(analytics[0].metrics.saves).toBeNull();
      expect(analytics[0].metrics.profileClicks).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("publish provider router", () => {
  it("registers exactly the known providers", () => {
    expect(Object.keys(PUBLISH_PROVIDERS).sort()).toEqual(["demo", "typefully"]);
  });

  it("isValidPublishProvider distinguishes known from unknown names", () => {
    expect(isValidPublishProvider("demo")).toBe(true);
    expect(isValidPublishProvider("typefully")).toBe(true);
    expect(isValidPublishProvider("bufferapp")).toBe(false);
  });

  it("getPublishProvider throws for an unknown provider rather than falling back silently", () => {
    expect(() => getPublishProvider("bufferapp")).toThrow(/Unknown publish provider/);
  });

  it("getPublishProvider never substitutes a different provider for the one requested", () => {
    expect(getPublishProvider("demo").name).toBe("demo");
    expect(getPublishProvider("typefully").name).toBe("typefully");
  });

  it("getPublishProvidersStatus reports configuration state per provider", () => {
    const status = getPublishProvidersStatus();
    const byName = Object.fromEntries(status.map((s) => [s.name, s.isConfigured]));
    expect(byName.demo).toBe(true);
    expect(typeof byName.typefully).toBe("boolean");
  });
});
