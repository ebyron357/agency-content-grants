/**
 * Content Performance Engine — ingestion.
 *
 * Pulls normalized post analytics from each active destination's
 * PublishProvider adapter (see docs/decisions/content-performance-engine.md
 * for why this extends the existing adapter rather than a separate
 * ingestion path) and appends a performance_snapshots row per matched post.
 * Snapshots are NEVER updated in place — re-ingesting the same post just
 * appends another row, which is what makes trend-over-time queries possible.
 *
 * Only publications with status "published" are ever considered: pending,
 * failed, or cancelled content was never actually sent to the platform, so
 * it must never gain a performance number.
 */
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  publishingDestinationsTable,
  scheduledPublicationsTable,
  performanceSnapshotsTable,
  brandsTable,
  type PublishingDestination,
} from "@workspace/db";
import { getPublishProvider } from "../publishing/router";
import { destinationRef } from "../workflows/publishing-workflow";
import type { PublishProvider } from "../publishing/types";

// How far back to look for a destination that has never been ingested. Real
// social platforms don't generally expose analytics indefinitely, and this
// keeps a fresh destination's very first ingestion call bounded.
const LOOKBACK_DAYS_FOR_FIRST_INGEST = 90;

// Minimum time between two ingestion runs for the *same* destination via the
// background scheduler. Without this, a short scheduler tick interval would
// flood performance_snapshots with near-duplicate rows for content whose
// metrics haven't meaningfully changed since the last check. An explicit
// manual refresh (ingestNowForUser) deliberately bypasses this.
export const MIN_INGEST_INTERVAL_MS = 15 * 60_000;

// In-memory only: resets on server restart, which just means the next tick
// re-checks a bit earlier than strictly necessary. Acceptable for a
// throttle (not a correctness guarantee) — matches the codebase's existing
// preference for simple in-process state over a new persistence path.
const lastIngestedAt = new Map<string, number>();

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ingest metrics for one destination via its provider, matching each
 * returned post back to one of our own scheduled_publications by
 * externalPostId. A post the provider reports that doesn't match anything of
 * ours is skipped, never guessed at.
 */
export async function ingestDestinationMetrics(destination: PublishingDestination, provider: PublishProvider, now: Date = new Date()): Promise<number> {
  if (!provider.supportsAnalytics || !provider.fetchAnalytics) return 0;
  if (!provider.isConfigured()) return 0;

  const publications = await db
    .select()
    .from(scheduledPublicationsTable)
    .where(and(eq(scheduledPublicationsTable.destinationId, destination.id), eq(scheduledPublicationsTable.status, "published")));

  const byExternalId = new Map(publications.filter((p) => p.externalPostId).map((p) => [p.externalPostId as string, p]));
  if (byExternalId.size === 0) return 0;

  const earliestPublishedAt = publications.reduce<Date>((min, p) => {
    if (!p.publishedAt) return min;
    return p.publishedAt < min ? p.publishedAt : min;
  }, now);
  const lookbackFloor = new Date(now.getTime() - LOOKBACK_DAYS_FOR_FIRST_INGEST * 86_400_000);
  const startDate = toDateOnly(earliestPublishedAt < lookbackFloor ? lookbackFloor : earliestPublishedAt);
  const endDate = toDateOnly(now);

  const analytics = await provider.fetchAnalytics(destinationRef(destination), { startDate, endDate });

  let inserted = 0;
  for (const item of analytics) {
    const pub = byExternalId.get(item.externalPostId);
    if (!pub) continue; // e.g. a manual draft in the provider's account that isn't one of ours — never guess a link

    await db.insert(performanceSnapshotsTable).values({
      id: randomUUID(),
      scheduledPublicationId: pub.id,
      source: destination.provider,
      externalPostId: item.externalPostId,
      postUrl: item.postUrl,
      impressions: item.metrics.impressions,
      engagementTotal: item.metrics.engagementTotal,
      likes: item.metrics.likes,
      comments: item.metrics.comments,
      shares: item.metrics.shares,
      quotes: item.metrics.quotes,
      saves: item.metrics.saves,
      profileClicks: item.metrics.profileClicks,
      linkClicks: item.metrics.linkClicks,
      raw: item.raw,
    });
    inserted++;
  }
  return inserted;
}

/**
 * Background-scheduler entry point: checks every active, analytics-capable
 * destination, throttled per-destination via MIN_INGEST_INTERVAL_MS so
 * frequent ticks don't flood the snapshot history.
 */
export async function ingestDueMetrics(now: Date = new Date()): Promise<{ destinationsChecked: number; snapshotsInserted: number }> {
  const destinations = await db.select().from(publishingDestinationsTable).where(eq(publishingDestinationsTable.isActive, true));

  let destinationsChecked = 0;
  let snapshotsInserted = 0;

  for (const destination of destinations) {
    const provider = getPublishProvider(destination.provider);
    if (!provider.supportsAnalytics) continue;

    const last = lastIngestedAt.get(destination.id) ?? 0;
    if (now.getTime() - last < MIN_INGEST_INTERVAL_MS) continue;

    destinationsChecked++;
    try {
      snapshotsInserted += await ingestDestinationMetrics(destination, provider, now);
      lastIngestedAt.set(destination.id, now.getTime());
    } catch (err) {
      // Deliberately do NOT update lastIngestedAt on failure, so the next
      // tick retries soon instead of silently going dark for a full
      // throttle interval.
      console.error(`[performance-ingestion] failed for destination ${destination.id} (${destination.provider}):`, err);
    }
  }

  return { destinationsChecked, snapshotsInserted };
}

/**
 * Explicit user-triggered ingestion (a "refresh metrics" UI action, or a
 * test) — scoped to destinations owned (via brand) by `userId`, optionally
 * narrowed to one brand. Bypasses the throttle deliberately: this is an
 * explicit action the user asked for, not a background tick.
 */
export async function ingestNowForUser(userId: string, brandId?: string, now: Date = new Date()): Promise<{ destinationsChecked: number; snapshotsInserted: number }> {
  const ownedBrandIds = (
    await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .where(brandId ? and(eq(brandsTable.userId, userId), eq(brandsTable.id, brandId)) : eq(brandsTable.userId, userId))
  ).map((b) => b.id);
  if (ownedBrandIds.length === 0) return { destinationsChecked: 0, snapshotsInserted: 0 };

  const destinations = await db
    .select()
    .from(publishingDestinationsTable)
    .where(and(eq(publishingDestinationsTable.isActive, true), inArray(publishingDestinationsTable.brandId, ownedBrandIds)));

  let destinationsChecked = 0;
  let snapshotsInserted = 0;
  for (const destination of destinations) {
    const provider = getPublishProvider(destination.provider);
    if (!provider.supportsAnalytics) continue;
    destinationsChecked++;
    snapshotsInserted += await ingestDestinationMetrics(destination, provider, now);
    lastIngestedAt.set(destination.id, now.getTime());
  }
  return { destinationsChecked, snapshotsInserted };
}

/** Test-only: reset the in-memory throttle map between test cases. */
export function __resetIngestionThrottleForTests(): void {
  lastIngestedAt.clear();
}
