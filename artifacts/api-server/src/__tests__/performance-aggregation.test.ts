/**
 * Pure normalization/aggregation logic tests (no DB, no network) — the
 * dimension-grouping and best/worst-ranking logic that the performance
 * dashboard and recommendation engine both build on.
 */
import { describe, it, expect } from "vitest";
import { aggregateByDimension, bestAndWorst } from "../lib/performance/aggregation";
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
    source: "typefully", // real provider by default — bestAndWorst deliberately excludes demo/simulated rows, see dedicated tests below
    snapshotCount: 2,
    firstCapturedAt: "2026-08-01T00:00:00.000Z",
    latestCapturedAt: "2026-08-05T00:00:00.000Z",
    latest: { impressions: 1000, engagementTotal: 100, likes: 60, comments: 20, shares: 20 },
    growth: { impressions: 200, engagementTotal: 20 },
    engagementRate: 0.1,
    ...overrides,
  };
}

describe("aggregateByDimension", () => {
  it("averages the metric within each dimension group, not sums it", () => {
    const rows = [
      row({ scheduledPublicationId: "1", channel: "x", latest: { impressions: 1000, engagementTotal: 100, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", channel: "x", latest: { impressions: 1000, engagementTotal: 200, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "3", channel: "linkedin", latest: { impressions: 1000, engagementTotal: 900, likes: 0, comments: 0, shares: 0 } }),
    ];
    const result = aggregateByDimension(rows, "channel", "engagementTotal");
    const byLabel = Object.fromEntries(result.map((r) => [r.label, r]));
    expect(byLabel.x.value).toBe(150); // average of 100 and 200, not their sum
    expect(byLabel.x.publicationCount).toBe(2);
    expect(byLabel.linkedin.value).toBe(900);
  });

  it("sorts descending by value", () => {
    const rows = [
      row({ scheduledPublicationId: "1", channel: "low", latest: { impressions: 10, engagementTotal: 1, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", channel: "high", latest: { impressions: 10, engagementTotal: 99, likes: 0, comments: 0, shares: 0 } }),
    ];
    const result = aggregateByDimension(rows, "channel", "engagementTotal");
    expect(result.map((r) => r.label)).toEqual(["high", "low"]);
  });

  it("excludes rows with no value for the dimension instead of lumping them into an 'unspecified' bucket", () => {
    const rows = [
      row({ scheduledPublicationId: "1", campaignId: "c1", campaignName: "Launch" }),
      row({ scheduledPublicationId: "2", campaignId: null, campaignName: null }), // e.g. a plain document, not part of a campaign
    ];
    const result = aggregateByDimension(rows, "campaign", "engagementTotal");
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Launch");
  });

  it("excludes rows with a null metric value (e.g. engagementRate with zero impressions) rather than treating null as 0", () => {
    const rows = [
      row({ scheduledPublicationId: "1", channel: "x", engagementRate: null }),
      row({ scheduledPublicationId: "2", channel: "x", engagementRate: 0.5 }),
    ];
    const result = aggregateByDimension(rows, "channel", "engagementRate");
    expect(result[0].value).toBe(0.5); // averaged over 1 real value, not 2 (which would drag it toward 0.25)
    expect(result[0].publicationCount).toBe(1);
  });
});

describe("bestAndWorst", () => {
  it("returns top N as best and bottom N (reversed, worst-first) as worst", () => {
    const rows = ["a", "b", "c", "d", "e"].map((label, i) =>
      row({ scheduledPublicationId: label, channel: label, latest: { impressions: 10, engagementTotal: (i + 1) * 10, likes: 0, comments: 0, shares: 0 } }),
    );
    const result = bestAndWorst(rows, "channel", "engagementTotal", 2);
    expect(result.best.map((r) => r.label)).toEqual(["e", "d"]); // highest engagement first
    expect(result.worst.map((r) => r.label)).toEqual(["a", "b"]); // lowest engagement first
  });

  it("returns empty best/worst when there is no real ingested data for the dimension", () => {
    const result = bestAndWorst([], "channel", "engagementTotal");
    expect(result.best).toEqual([]);
    expect(result.worst).toEqual([]);
    expect(result.excludedSimulatedPublications).toBe(0);
  });

  it("excludes demo/simulated rows entirely from rankings, even when they are the only data available", () => {
    const rows = ["a", "b", "c"].map((label, i) =>
      row({ scheduledPublicationId: label, channel: label, source: "demo", latest: { impressions: 10, engagementTotal: (i + 1) * 10, likes: 0, comments: 0, shares: 0 } }),
    );
    const result = bestAndWorst(rows, "channel", "engagementTotal");
    // A brand with only demo destinations has no real evidence yet — rankings must say so, not fabricate them from simulated numbers.
    expect(result.best).toEqual([]);
    expect(result.worst).toEqual([]);
    expect(result.excludedSimulatedPublications).toBe(3);
  });

  it("excludes demo rows even when mixed with real ones, and reports the exclusion count", () => {
    const rows = [
      row({ scheduledPublicationId: "1", channel: "x", source: "typefully", latest: { impressions: 1000, engagementTotal: 100, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", channel: "linkedin", source: "typefully", latest: { impressions: 1000, engagementTotal: 200, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "3", channel: "instagram", source: "demo", latest: { impressions: 1000, engagementTotal: 99999, likes: 0, comments: 0, shares: 0 } }), // would dominate "best" if not excluded
    ];
    const result = bestAndWorst(rows, "channel", "engagementTotal");
    expect(result.best.map((r) => r.label)).not.toContain("instagram");
    expect(result.best.map((r) => r.label).sort()).toEqual(["linkedin", "x"]);
    expect(result.excludedSimulatedPublications).toBe(1);
  });
});
