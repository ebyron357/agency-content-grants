/**
 * Content Performance Engine — aggregation.
 *
 * Joins ingested performance_snapshots back through the existing content
 * chain (scheduled_publications -> destinations/projects/brands, and
 * optionally -> repurposed_assets/repurposing_batches for format/campaign)
 * to build the per-publication rows the dashboard and recommendation logic
 * both consume. A publication with zero snapshots never appears here — this
 * is the enforcement point for "no analytics is ever displayed without a
 * real data source".
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  scheduledPublicationsTable,
  publishingDestinationsTable,
  projectsTable,
  brandsTable,
  repurposedAssetsTable,
  repurposingBatchesTable,
  performanceSnapshotsTable,
} from "@workspace/db";
import { splitRealAndSimulated, type DimensionAggregate, type PerformanceDimension, type PerformanceMetric, type PerformanceRow } from "./types";

interface DimensionRow {
  scheduledPublicationId: string;
  brandId: string;
  brandName: string;
  projectId: string;
  projectTitle: string;
  topic: string | null;
  destinationId: string;
  channel: string;
  sourceType: string;
  assetChannel: string | null;
  campaignId: string | null;
  campaignName: string | null;
  title: string | null;
  externalUrl: string | null;
  publishedAt: Date | null;
}

/**
 * Every published publication belonging to one of `userId`'s brands, with
 * its dimension info attached (before any snapshot data is joined in).
 * Optionally narrowed to a single brand.
 */
async function getDimensionRowsForUser(userId: string, brandId?: string): Promise<DimensionRow[]> {
  const rows = await db
    .select({
      scheduledPublicationId: scheduledPublicationsTable.id,
      brandId: brandsTable.id,
      brandName: brandsTable.name,
      projectId: projectsTable.id,
      projectTitle: projectsTable.title,
      topic: projectsTable.topic,
      destinationId: publishingDestinationsTable.id,
      channel: publishingDestinationsTable.platform,
      sourceType: scheduledPublicationsTable.sourceType,
      assetChannel: repurposedAssetsTable.channel,
      campaignId: repurposingBatchesTable.id,
      campaignName: repurposingBatchesTable.campaignName,
      title: scheduledPublicationsTable.title,
      externalUrl: scheduledPublicationsTable.externalUrl,
      publishedAt: scheduledPublicationsTable.publishedAt,
    })
    .from(scheduledPublicationsTable)
    .innerJoin(brandsTable, eq(scheduledPublicationsTable.brandId, brandsTable.id))
    .innerJoin(projectsTable, eq(scheduledPublicationsTable.projectId, projectsTable.id))
    .innerJoin(publishingDestinationsTable, eq(scheduledPublicationsTable.destinationId, publishingDestinationsTable.id))
    .leftJoin(repurposedAssetsTable, eq(scheduledPublicationsTable.repurposedAssetId, repurposedAssetsTable.id))
    .leftJoin(repurposingBatchesTable, eq(repurposedAssetsTable.batchId, repurposingBatchesTable.id))
    .where(
      brandId
        ? and(eq(scheduledPublicationsTable.status, "published"), eq(brandsTable.userId, userId), eq(brandsTable.id, brandId))
        : and(eq(scheduledPublicationsTable.status, "published"), eq(brandsTable.userId, userId)),
    );
  return rows;
}

/**
 * Builds one PerformanceRow per publication that has at least one real
 * ingested snapshot. Pure joining/aggregation of already-ingested data — no
 * network calls, no estimation.
 */
export async function getPerformanceRowsForUser(userId: string, brandId?: string): Promise<PerformanceRow[]> {
  const dimensionRows = await getDimensionRowsForUser(userId, brandId);
  if (dimensionRows.length === 0) return [];

  const ids = dimensionRows.map((r) => r.scheduledPublicationId);
  const snapshots = await db
    .select()
    .from(performanceSnapshotsTable)
    .where(inArray(performanceSnapshotsTable.scheduledPublicationId, ids))
    .orderBy(performanceSnapshotsTable.capturedAt);

  const snapshotsByPublication = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    const list = snapshotsByPublication.get(snap.scheduledPublicationId) ?? [];
    list.push(snap);
    snapshotsByPublication.set(snap.scheduledPublicationId, list);
  }

  const result: PerformanceRow[] = [];
  for (const dim of dimensionRows) {
    const history = snapshotsByPublication.get(dim.scheduledPublicationId);
    if (!history || history.length === 0) continue; // no real data ingested yet — never display a placeholder row

    const first = history[0];
    const latest = history[history.length - 1];
    const format = dim.sourceType === "repurposed_asset" ? (dim.assetChannel ?? "repurposed") : "document";

    result.push({
      scheduledPublicationId: dim.scheduledPublicationId,
      brandId: dim.brandId,
      brandName: dim.brandName,
      projectId: dim.projectId,
      projectTitle: dim.projectTitle,
      topic: dim.topic,
      destinationId: dim.destinationId,
      channel: dim.channel,
      format,
      campaignId: dim.campaignId,
      campaignName: dim.campaignName,
      title: dim.title,
      externalUrl: dim.externalUrl,
      publishedAt: dim.publishedAt ? dim.publishedAt.toISOString() : null,
      source: latest.source,
      snapshotCount: history.length,
      firstCapturedAt: first.capturedAt.toISOString(),
      latestCapturedAt: latest.capturedAt.toISOString(),
      latest: {
        impressions: latest.impressions,
        engagementTotal: latest.engagementTotal,
        likes: latest.likes,
        comments: latest.comments,
        shares: latest.shares,
      },
      growth: {
        impressions: history.length > 1 ? latest.impressions - first.impressions : 0,
        engagementTotal: history.length > 1 ? latest.engagementTotal - first.engagementTotal : 0,
      },
      engagementRate: latest.impressions > 0 ? latest.engagementTotal / latest.impressions : null,
    });
  }
  return result;
}

/** Full ordered snapshot history for a single publication (for a trend chart). Caller is responsible for ownership checks. */
export async function getSnapshotHistory(scheduledPublicationId: string) {
  return db
    .select()
    .from(performanceSnapshotsTable)
    .where(eq(performanceSnapshotsTable.scheduledPublicationId, scheduledPublicationId))
    .orderBy(performanceSnapshotsTable.capturedAt);
}

function metricValue(row: PerformanceRow, metric: PerformanceMetric): number | null {
  if (metric === "engagementRate") return row.engagementRate;
  if (metric === "likes") return row.latest.likes;
  if (metric === "impressions") return row.latest.impressions;
  return row.latest.engagementTotal;
}

function dimensionLabel(row: PerformanceRow, dimension: PerformanceDimension): string | null {
  switch (dimension) {
    case "channel":
      return row.channel;
    case "format":
      return row.format;
    case "topic":
      return row.topic;
    case "campaign":
      return row.campaignName;
    case "brand":
      return row.brandName;
  }
}

/**
 * Groups rows by the requested dimension and averages the requested metric
 * within each group (average, not sum, so a channel with many small posts
 * isn't automatically ranked above one with fewer, stronger posts). Rows
 * with no value for the dimension (e.g. a document has no campaign) are
 * excluded from that dimension's aggregate rather than lumped into a
 * misleading "Unspecified" bucket.
 */
export function aggregateByDimension(rows: PerformanceRow[], dimension: PerformanceDimension, metric: PerformanceMetric): DimensionAggregate[] {
  const groups = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const label = dimensionLabel(row, dimension);
    if (!label) continue;
    const value = metricValue(row, metric);
    if (value === null) continue;
    const g = groups.get(label) ?? { total: 0, count: 0 };
    g.total += value;
    g.count += 1;
    groups.set(label, g);
  }
  return Array.from(groups.entries())
    .map(([label, g]) => ({ label, value: g.total / g.count, publicationCount: g.count }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Rankings a user can act on. Simulated (demo-provider) rows are always
 * excluded here — even mixed in with real data — because "best on X"
 * necessarily implies genuine observed performance, and a demo destination
 * has none. `excludedSimulatedPublications` reports how many rows were
 * dropped for this reason so the UI can say so explicitly instead of
 * silently showing fewer results than the publications table.
 */
export function bestAndWorst(
  rows: PerformanceRow[],
  dimension: PerformanceDimension,
  metric: PerformanceMetric,
  limit = 5,
): { best: DimensionAggregate[]; worst: DimensionAggregate[]; excludedSimulatedPublications: number } {
  const { real, simulated } = splitRealAndSimulated(rows);
  const aggregates = aggregateByDimension(real, dimension, metric);
  return {
    best: aggregates.slice(0, limit),
    worst: aggregates.slice(-limit).reverse(),
    excludedSimulatedPublications: simulated.length,
  };
}
