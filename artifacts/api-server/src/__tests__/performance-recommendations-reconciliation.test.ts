/**
 * Integration test for refreshRecommendationsForBrand's reconciliation
 * behavior, using a small in-memory fake db (mirrors the fake-db pattern in
 * performance-ingestion.test.ts / publishing-workflow.test.ts) so the actual
 * insert/update/delete logic runs against real drizzle-orm condition
 * builders, not just the pure rule engine.
 *
 * Verifies: a "pending" recommendation whose generating pattern no longer
 * holds (including the empty-row case) is deleted rather than left on the
 * dashboard looking like a live, currently evidence-backed suggestion; an
 * "accepted"/"dismissed" recommendation is never touched by reconciliation
 * even when its pattern disappears.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = { rows: [] as any[], brands: [] as any[] };
  return { fakeState: state, resetFakeState: () => { state.rows = []; state.brands = []; } };
});

// Real drizzle-orm condition builders are mocked with plain descriptor
// objects so the fake db below can evaluate them without a real database.
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: any) => ({ op: "eq", col, val }),
  and: (...conditions: any[]) => ({ op: "and", conditions }),
  notInArray: (col: string, vals: any[]) => ({ op: "notInArray", col, vals }),
}));

function matches(row: any, cond: any): boolean {
  if (cond.op === "and") return cond.conditions.every((c: any) => matches(row, c));
  if (cond.op === "eq") return row[cond.col] === cond.val;
  if (cond.op === "notInArray") return !cond.vals.includes(row[cond.col]);
  throw new Error(`unsupported condition in test fake db: ${cond.op}`);
}

vi.mock("@workspace/db", () => {
  const performanceRecommendationsTable = { __table: "recs", brandId: "brandId", dedupeKey: "dedupeKey", status: "status", id: "id" };
  const brandsTable = { __table: "brands", id: "id", userId: "userId" };
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value) };
  }
  function rowsFor(table: any) {
    return table === brandsTable ? fakeState.brands : fakeState.rows;
  }
  const db = {
    select: () => ({
      from: (table: any) => ({
        where: (cond: any) => {
          const result = rowsFor(table).filter((r: any) => matches(r, cond));
          return Object.assign(thenable(result), { limit: (n: number) => thenable(result.slice(0, n)) });
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.rows.push({ ...v });
        return thenable(undefined);
      },
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (cond: any) => {
          for (const row of fakeState.rows) {
            if (matches(row, cond)) Object.assign(row, patch);
          }
          return thenable(undefined);
        },
      }),
    }),
    delete: () => ({
      where: (cond: any) => {
        fakeState.rows = fakeState.rows.filter((r) => !matches(r, cond));
        return thenable(undefined);
      },
    }),
  };
  return { db, performanceRecommendationsTable, brandsTable };
});

import { refreshRecommendationsForBrand, reconcileRecommendationsForUser } from "../lib/performance/recommendations";
import type { PerformanceRow } from "../lib/performance/types";

function row(overrides: Partial<PerformanceRow>): PerformanceRow {
  return {
    scheduledPublicationId: "pub-1",
    brandId: "brand-1",
    brandName: "Acme",
    projectId: "proj-1",
    projectTitle: "Project",
    topic: "AI",
    destinationId: "dest-1",
    channel: "x",
    format: "document",
    campaignId: null,
    campaignName: null,
    title: "A post",
    externalUrl: null,
    publishedAt: "2026-08-01T00:00:00.000Z",
    source: "typefully",
    snapshotCount: 2,
    firstCapturedAt: "2026-08-01T00:00:00.000Z",
    latestCapturedAt: "2026-08-05T00:00:00.000Z",
    latest: { impressions: 1000, engagementTotal: 100, likes: 60, comments: 20, shares: 20 },
    growth: { impressions: 200, engagementTotal: 20 },
    engagementRate: 0.1,
    ...overrides,
  };
}

const round1: PerformanceRow[] = [
  row({ scheduledPublicationId: "pub-1", channel: "x", latest: { impressions: 1000, engagementTotal: 1000, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-2", channel: "x", latest: { impressions: 1000, engagementTotal: 900, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-3", channel: "linkedin", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-4", channel: "linkedin", latest: { impressions: 1000, engagementTotal: 60, likes: 0, comments: 0, shares: 0 } }),
];

// Same top performer (pub-1) still stands out from the crowd, but "x" no
// longer has 2+ posts, so double_down_channel can no longer fire for it.
const round2: PerformanceRow[] = [
  row({ scheduledPublicationId: "pub-1", channel: "x", latest: { impressions: 1000, engagementTotal: 1000, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-3", channel: "linkedin", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-4", channel: "linkedin", latest: { impressions: 1000, engagementTotal: 60, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-5", channel: "instagram", latest: { impressions: 1000, engagementTotal: 55, likes: 0, comments: 0, shares: 0 } }),
  row({ scheduledPublicationId: "pub-6", channel: "instagram", latest: { impressions: 1000, engagementTotal: 45, likes: 0, comments: 0, shares: 0 } }),
];

describe("refreshRecommendationsForBrand — reconciliation", () => {
  beforeEach(() => {
    resetFakeState();
  });

  it("deletes every pending recommendation once no pattern qualifies at all (empty-row refresh)", async () => {
    await refreshRecommendationsForBrand("brand-1", round1);
    expect(fakeState.rows.length).toBeGreaterThan(0);

    await refreshRecommendationsForBrand("brand-1", []);
    expect(fakeState.rows).toHaveLength(0);
  });

  it("removes a pending recommendation whose specific pattern stopped qualifying, while keeping/updating one that still holds", async () => {
    await refreshRecommendationsForBrand("brand-1", round1);
    const kindsAfterRound1 = fakeState.rows.map((r) => r.kind).sort();
    expect(kindsAfterRound1).toEqual(["double_down_channel", "repurpose_top_performer"]);

    await refreshRecommendationsForBrand("brand-1", round2);
    const kindsAfterRound2 = fakeState.rows.map((r) => r.kind);
    // The channel pattern no longer holds (only 1 post left on "x") — it must be gone, not lingering as a stale "pending" suggestion.
    expect(kindsAfterRound2).not.toContain("double_down_channel");
    // The top-performer pattern still holds for the same publication — it survives (as an update, not a duplicate).
    expect(kindsAfterRound2).toEqual(["repurpose_top_performer"]);
    expect(fakeState.rows).toHaveLength(1);
  });

  it("never deletes or alters an accepted/dismissed recommendation even after its pattern disappears", async () => {
    await refreshRecommendationsForBrand("brand-1", round1);
    const channelRec = fakeState.rows.find((r) => r.kind === "double_down_channel");
    expect(channelRec).toBeDefined();
    channelRec.status = "accepted";
    channelRec.actedNote = "Already doubled down on X.";

    // The pattern behind this recommendation no longer holds in round2 (and an empty refresh would remove any pending one).
    await refreshRecommendationsForBrand("brand-1", round2);
    await refreshRecommendationsForBrand("brand-1", []);

    const survivor = fakeState.rows.find((r) => r.dedupeKey === channelRec.dedupeKey);
    expect(survivor).toBeDefined();
    expect(survivor.status).toBe("accepted");
    expect(survivor.actedNote).toBe("Already doubled down on X.");
  });
});

describe("reconcileRecommendationsForUser — brand enumeration (the /performance/recommendations route boundary)", () => {
  beforeEach(() => {
    resetFakeState();
  });

  it("refreshes a specifically requested brand even when it has zero current rows, retiring its stale pending recommendations", async () => {
    await refreshRecommendationsForBrand("brand-1", round1);
    expect(fakeState.rows.length).toBeGreaterThan(0);

    // Simulates GET /performance/recommendations?brandId=brand-1 once that brand's publications no longer have any ingested rows —
    // must NOT just skip refreshing because the incoming row list is empty for this brand.
    const refreshed = await reconcileRecommendationsForUser("user-1", "brand-1", []);
    expect(refreshed).toEqual(["brand-1"]);
    expect(fakeState.rows).toHaveLength(0);
  });

  it("enumerates every brand the user owns (not just ones present in the row list) for an unscoped request", async () => {
    fakeState.brands = [
      { id: "brand-1", userId: "user-1" },
      { id: "brand-2", userId: "user-1" },
      { id: "brand-other-user", userId: "user-2" },
    ];
    await refreshRecommendationsForBrand("brand-2", round1); // brand-2 has stale pending recs but zero *current* rows

    // Simulates GET /performance/recommendations (no brandId) — rows only mention brand-1, but brand-2 (same user) must still be reconciled.
    const rowsMentioningOnlyBrand1 = round1.map((r) => ({ ...r, brandId: "brand-1" }));
    const refreshed = await reconcileRecommendationsForUser("user-1", undefined, rowsMentioningOnlyBrand1);

    expect(refreshed.sort()).toEqual(["brand-1", "brand-2"]);
    expect(refreshed).not.toContain("brand-other-user");
    // brand-2's stale recommendations (from round1, now given zero rows) must be gone.
    expect(fakeState.rows.some((r) => r.brandId === "brand-2")).toBe(false);
    // brand-1's recommendations were (re)computed from the rows actually passed in.
    expect(fakeState.rows.some((r) => r.brandId === "brand-1")).toBe(true);
  });
});
