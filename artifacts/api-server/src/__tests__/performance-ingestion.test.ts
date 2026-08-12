/**
 * Ingestion integration test using a mocked provider and a mocked db (no
 * real database or network) — mirrors the fake-db pattern in
 * publishing-workflow.test.ts. Verifies: correlation by externalPostId,
 * skipping provider items with no match, only ever considering "published"
 * publications, and the per-destination ingestion throttle.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = {
    selectQueue: [] as any[][],
    inserts: [] as any[],
  };
  return {
    fakeState: state,
    resetFakeState: () => {
      state.selectQueue = [];
      state.inserts = [];
    },
  };
});

vi.mock("@workspace/db", () => {
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value), orderBy: () => thenable(value) };
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const result = fakeState.selectQueue.shift() ?? [];
          return Object.assign(thenable(result), {
            limit: (n: number) => thenable(result.slice(0, n)),
          });
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.inserts.push(v);
        return thenable(undefined);
      },
    }),
  };
  return {
    db,
    publishingDestinationsTable: {},
    scheduledPublicationsTable: {},
    performanceSnapshotsTable: {},
    brandsTable: {},
  };
});

vi.mock("../lib/workflows/publishing-workflow", () => ({
  destinationRef: (d: any) => ({ externalAccountId: d.externalAccountId ?? null, platform: d.platform, config: d.config ?? null }),
}));

const { routerState } = vi.hoisted(() => ({ routerState: { provider: null as any } }));
vi.mock("../lib/publishing/router", () => ({
  getPublishProvider: () => routerState.provider,
}));

import { ingestDestinationMetrics, ingestDueMetrics, __resetIngestionThrottleForTests } from "../lib/performance/ingestion";

const destination = { id: "dest-1", provider: "demo", platform: "x", externalAccountId: "acct_1", config: null, isActive: true };

const publishedPublication = {
  id: "pub-1",
  destinationId: "dest-1",
  status: "published",
  externalPostId: "demo_abc",
  publishedAt: new Date("2026-08-01T00:00:00.000Z"),
};

function makeProvider(analytics: any[]) {
  return {
    name: "demo",
    supportsAnalytics: true,
    isConfigured: () => true,
    fetchAnalytics: vi.fn(async () => analytics),
  };
}

describe("ingestDestinationMetrics", () => {
  beforeEach(() => {
    resetFakeState();
    __resetIngestionThrottleForTests();
  });

  it("inserts a snapshot for a publication matched by externalPostId", async () => {
    fakeState.selectQueue.push([publishedPublication]); // scheduled_publications lookup
    const provider = makeProvider([
      { externalPostId: "demo_abc", postUrl: "https://demo.local/x", metrics: { impressions: 100, engagementTotal: 10, likes: 5, comments: 3, shares: 2, quotes: null, saves: null, profileClicks: null, linkClicks: null }, raw: { simulated: true } },
    ]);

    const inserted = await ingestDestinationMetrics(destination as any, provider as any, new Date("2026-08-05T00:00:00.000Z"));

    expect(inserted).toBe(1);
    expect(fakeState.inserts).toHaveLength(1);
    expect(fakeState.inserts[0].scheduledPublicationId).toBe("pub-1");
    expect(fakeState.inserts[0].impressions).toBe(100);
    expect(fakeState.inserts[0].source).toBe("demo");
  });

  it("never guesses a match — skips provider items with no corresponding externalPostId in our own data", async () => {
    fakeState.selectQueue.push([publishedPublication]);
    const provider = makeProvider([
      { externalPostId: "demo_unrelated", postUrl: null, metrics: { impressions: 1, engagementTotal: 1, likes: 0, comments: 0, shares: 0, quotes: null, saves: null, profileClicks: null, linkClicks: null }, raw: {} },
    ]);

    const inserted = await ingestDestinationMetrics(destination as any, provider as any, new Date());

    expect(inserted).toBe(0);
    expect(fakeState.inserts).toHaveLength(0);
  });

  it("does nothing when the provider doesn't support analytics", async () => {
    fakeState.selectQueue.push([publishedPublication]);
    const provider = { name: "typefully", supportsAnalytics: false, isConfigured: () => true };
    const inserted = await ingestDestinationMetrics(destination as any, provider as any, new Date());
    expect(inserted).toBe(0);
  });

  it("does nothing when there are no published publications for this destination (nothing to correlate against)", async () => {
    fakeState.selectQueue.push([]); // no published publications
    const provider = makeProvider([{ externalPostId: "demo_abc", postUrl: null, metrics: { impressions: 1, engagementTotal: 1, likes: 0, comments: 0, shares: 0, quotes: null, saves: null, profileClicks: null, linkClicks: null }, raw: {} }]);
    const inserted = await ingestDestinationMetrics(destination as any, provider as any, new Date());
    expect(inserted).toBe(0);
    expect(provider.fetchAnalytics).not.toHaveBeenCalled();
  });
});

describe("ingestDueMetrics", () => {
  beforeEach(() => {
    resetFakeState();
    __resetIngestionThrottleForTests();
    routerState.provider = makeProvider([
      { externalPostId: "demo_abc", postUrl: null, metrics: { impressions: 50, engagementTotal: 5, likes: 3, comments: 1, shares: 1, quotes: null, saves: null, profileClicks: null, linkClicks: null }, raw: {} },
    ]);
  });

  it("throttles repeat ingestion for the same destination within the minimum interval", async () => {
    fakeState.selectQueue.push([destination]); // active destinations
    fakeState.selectQueue.push([publishedPublication]); // that destination's published publications

    const now = new Date("2026-08-05T00:00:00.000Z");
    const first = await ingestDueMetrics(now);
    expect(first.destinationsChecked).toBe(1);

    // Immediately again — within MIN_INGEST_INTERVAL_MS, should be throttled to 0 destinations checked.
    fakeState.selectQueue.push([destination]);
    const second = await ingestDueMetrics(new Date(now.getTime() + 1000));
    expect(second.destinationsChecked).toBe(0);
  });
});
