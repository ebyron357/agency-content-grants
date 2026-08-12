/**
 * Shared shapes for performance aggregation/recommendation logic. Kept
 * separate from lib/publishing/types.ts (the provider adapter contract) —
 * these describe the *ingested and joined* view used by dashboards and
 * recommendations, not the provider boundary itself.
 */

export interface PerformanceRow {
  scheduledPublicationId: string;
  brandId: string;
  brandName: string;
  projectId: string;
  projectTitle: string;
  topic: string | null;
  destinationId: string;
  channel: string; // platform, e.g. "x" | "linkedin"
  format: string; // "document" (full-length original) or the repurposed asset's channel key
  campaignId: string | null;
  campaignName: string | null;
  title: string | null;
  externalUrl: string | null;
  publishedAt: string | null;
  source: string; // provider that produced the latest snapshot ("typefully" | "demo")
  snapshotCount: number;
  firstCapturedAt: string;
  latestCapturedAt: string;
  // Latest cumulative values (each snapshot's numbers are the provider's
  // running totals for the post, not a per-period delta).
  latest: {
    impressions: number;
    engagementTotal: number;
    likes: number;
    comments: number;
    shares: number;
  };
  // Growth since the first snapshot we have — only meaningful once
  // snapshotCount >= 2; 0 for a single-snapshot post rather than an inflated
  // "this is all new" delta.
  growth: {
    impressions: number;
    engagementTotal: number;
  };
  // engagementTotal / impressions for the latest snapshot, or null if there
  // were no impressions to divide by (never silently reported as 0, which
  // would look identical to "genuinely no engagement").
  engagementRate: number | null;
}

export type PerformanceDimension = "channel" | "format" | "topic" | "campaign" | "brand";
export type PerformanceMetric = "impressions" | "engagementTotal" | "engagementRate" | "likes";

export interface DimensionAggregate {
  label: string;
  value: number;
  publicationCount: number;
}

/**
 * Sources whose numbers are simulated (never captured from a real connected
 * platform) — currently just the local dev/testing "demo" provider. Any
 * evidence-backed surface (best/worst rankings, recommendations) MUST
 * exclude these: a brand with only demo-provider destinations connected has
 * no real evidence yet, and must show that honestly rather than ranking or
 * recommending against fabricated numbers. Per-publication displays may
 * still show simulated rows, but only ever alongside an explicit "demo"
 * source label (never presented as real).
 */
const SIMULATED_SOURCES = new Set(["demo"]);

export function isRealPerformanceSource(source: string): boolean {
  return !SIMULATED_SOURCES.has(source);
}

/** Splits rows into ones backed by a real connected provider vs. simulated/demo ones. */
export function splitRealAndSimulated(rows: PerformanceRow[]): { real: PerformanceRow[]; simulated: PerformanceRow[] } {
  const real: PerformanceRow[] = [];
  const simulated: PerformanceRow[] = [];
  for (const row of rows) {
    (isRealPerformanceSource(row.source) ? real : simulated).push(row);
  }
  return { real, simulated };
}
