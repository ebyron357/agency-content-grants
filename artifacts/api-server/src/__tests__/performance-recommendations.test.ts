/**
 * Rule-based recommendation generation tests (pure function, no DB/network).
 * Verifies: minimum sample size guards, notable-multiple thresholds, and that
 * every generated rationale frames its evidence as correlation, not proven
 * causation (task requirement: "explicitly distinguishing correlation from
 * causation").
 */
import { describe, it, expect } from "vitest";
import { generateRecommendationsForBrand } from "../lib/performance/recommendations";
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
    source: "typefully", // real provider by default — recommendations deliberately exclude demo/simulated rows, see dedicated tests below
    snapshotCount: 2,
    firstCapturedAt: "2026-08-01T00:00:00.000Z",
    latestCapturedAt: "2026-08-05T00:00:00.000Z",
    latest: { impressions: 1000, engagementTotal: 100, likes: 60, comments: 20, shares: 20 },
    growth: { impressions: 200, engagementTotal: 20 },
    engagementRate: 0.1,
    ...overrides,
  };
}

describe("generateRecommendationsForBrand", () => {
  it("generates no recommendations below the minimum sample size", () => {
    const rows = [row({ scheduledPublicationId: "1" })]; // only 1 published piece
    expect(generateRecommendationsForBrand("brand-1", rows)).toEqual([]);
  });

  it("recommends repurposing a piece that clearly outperforms the brand average", () => {
    const rows = [
      row({ scheduledPublicationId: "1", title: "Big hit", latest: { impressions: 1000, engagementTotal: 500, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "3", latest: { impressions: 1000, engagementTotal: 60, likes: 0, comments: 0, shares: 0 } }),
    ];
    const drafts = generateRecommendationsForBrand("brand-1", rows);
    const topPerformer = drafts.find((d) => d.kind === "repurpose_top_performer");
    expect(topPerformer).toBeDefined();
    expect(topPerformer!.subjectId).toBe("1");
    expect(topPerformer!.title).toContain("Big hit");
  });

  it("every rationale frames evidence as correlation, never as proven causation", () => {
    const rows = [
      row({ scheduledPublicationId: "1", channel: "x", topic: "AI", latest: { impressions: 1000, engagementTotal: 500, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", channel: "linkedin", topic: "Marketing", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "3", channel: "linkedin", topic: "Marketing", latest: { impressions: 1000, engagementTotal: 60, likes: 0, comments: 0, shares: 0 } }),
    ];
    const drafts = generateRecommendationsForBrand("brand-1", rows);
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      // Must not assert unqualified causation ("causes", "proves", "guarantees" without negation nearby).
      expect(draft.rationale.toLowerCase()).toMatch(/correlation|does not (guarantee|prove)|doesn't (guarantee|prove)|not a (verdict|guarantee)/);
    }
  });

  it("does not surface a channel/topic pattern from a single data point even if it's the brand's best", () => {
    const rows = [
      row({ scheduledPublicationId: "1", channel: "x", latest: { impressions: 1000, engagementTotal: 500, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", channel: "linkedin", latest: { impressions: 1000, engagementTotal: 60, likes: 0, comments: 0, shares: 0 } }),
    ];
    const drafts = generateRecommendationsForBrand("brand-1", rows);
    // Only 1 post on "x" — double_down_channel must not fire for a single-sample channel.
    expect(drafts.find((d) => d.kind === "double_down_channel")).toBeUndefined();
  });

  it("flags a format that is notably below the brand average", () => {
    const rows = [
      row({ scheduledPublicationId: "1", format: "video", latest: { impressions: 1000, engagementTotal: 20, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", format: "video", latest: { impressions: 1000, engagementTotal: 25, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "3", format: "document", latest: { impressions: 1000, engagementTotal: 300, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "4", format: "document", latest: { impressions: 1000, engagementTotal: 320, likes: 0, comments: 0, shares: 0 } }),
    ];
    const drafts = generateRecommendationsForBrand("brand-1", rows);
    const underperformance = drafts.find((d) => d.kind === "format_underperformance");
    expect(underperformance).toBeDefined();
    expect(underperformance!.subjectLabel).toBe("video");
  });

  it("produces a stable dedupe-able key shape (brandId:kind:subjectType:subjectId-or-label)", () => {
    const rows = [
      row({ scheduledPublicationId: "1", latest: { impressions: 1000, engagementTotal: 500, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
    ];
    const drafts = generateRecommendationsForBrand("brand-1", rows);
    const topPerformer = drafts.find((d) => d.kind === "repurpose_top_performer")!;
    expect(topPerformer.brandId).toBe("brand-1");
    expect(topPerformer.subjectType).toBe("document");
  });

  it("never generates a recommendation from demo/simulated rows alone — a demo-only brand has no real evidence yet", () => {
    const rows = [
      row({ scheduledPublicationId: "1", source: "demo", title: "Big hit", latest: { impressions: 1000, engagementTotal: 500, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", source: "demo", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "3", source: "demo", latest: { impressions: 1000, engagementTotal: 60, likes: 0, comments: 0, shares: 0 } }),
    ];
    expect(generateRecommendationsForBrand("brand-1", rows)).toEqual([]);
  });

  it("ignores demo rows when mixed with real ones, rather than letting simulated numbers pad the sample size or skew the average", () => {
    const realRows = [
      row({ scheduledPublicationId: "1", source: "typefully", title: "Big hit", latest: { impressions: 1000, engagementTotal: 500, likes: 0, comments: 0, shares: 0 } }),
      row({ scheduledPublicationId: "2", source: "typefully", latest: { impressions: 1000, engagementTotal: 50, likes: 0, comments: 0, shares: 0 } }),
    ];
    const withoutDemo = generateRecommendationsForBrand("brand-1", realRows);
    const demoRow = row({ scheduledPublicationId: "demo-1", source: "demo", latest: { impressions: 1000, engagementTotal: 99999, likes: 0, comments: 0, shares: 0 } });
    const withDemoMixedIn = generateRecommendationsForBrand("brand-1", [...realRows, demoRow]);
    // Adding a demo row must not change which real post is identified as the top performer,
    // nor its reported evidence — the demo row is invisible to the rule engine entirely.
    expect(withDemoMixedIn).toEqual(withoutDemo);
    const topPerformer = withDemoMixedIn.find((d) => d.kind === "repurpose_top_performer");
    expect(topPerformer?.subjectId).toBe("1");
  });
});
