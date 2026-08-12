/**
 * Content Performance Engine — rule-based, evidence-backed recommendations.
 *
 * Every recommendation is generated only from real ingested PerformanceRow
 * data (never fabricated), requires a minimum sample size before it fires
 * (so a single data point never masquerades as a trend), and its rationale
 * text explicitly frames the evidence as correlation, not proven causation —
 * per the task's "no analytics or recommendation is ever displayed without a
 * real data source" and "distinguish correlation from causation" rules.
 */
import { randomUUID } from "crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { db, brandsTable, performanceRecommendationsTable, type InsertPerformanceRecommendation } from "@workspace/db";
import { splitRealAndSimulated, type PerformanceRow } from "./types";
import { aggregateByDimension } from "./aggregation";

// Below this many data points, a dimension's average is not meaningfully
// different from noise — never generate a "this is your best X" claim from
// fewer real ingested publications than this.
const MIN_SAMPLE_SIZE = 2;
// A channel/topic average must beat the overall average by at least this
// multiple before it's worth surfacing as a pattern.
const NOTABLE_MULTIPLE = 1.3;

export interface RecommendationDraft {
  brandId: string;
  kind: string;
  title: string;
  rationale: string;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string;
  evidence: Record<string, unknown>;
}

function dedupeKeyFor(d: RecommendationDraft): string {
  return `${d.brandId}:${d.kind}:${d.subjectType}:${d.subjectId ?? d.subjectLabel}`;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Generates recommendation drafts for one brand's worth of PerformanceRows.
 * Pure function over already-ingested data — no I/O, so it's directly unit
 * testable without a database.
 */
export function generateRecommendationsForBrand(brandId: string, allRows: PerformanceRow[]): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = [];
  // A "recommendation" is an evidence-backed claim about real audience
  // behavior. Simulated (demo-provider) rows are never real evidence, so
  // they are excluded here even if that's all a brand currently has —
  // filtered at the single point every caller of this function goes
  // through, rather than trusting each call site to remember to do it.
  const rows = splitRealAndSimulated(allRows).real;
  if (rows.length < MIN_SAMPLE_SIZE) return drafts;

  const overallAvgEngagementTotal = average(rows.map((r) => r.latest.engagementTotal));

  // ── Rule 1: repurpose the top performer ────────────────────────────────
  const sortedByEngagement = [...rows].sort((a, b) => b.latest.engagementTotal - a.latest.engagementTotal);
  const top = sortedByEngagement[0];
  if (top && overallAvgEngagementTotal > 0) {
    const multiple = top.latest.engagementTotal / overallAvgEngagementTotal;
    if (multiple >= NOTABLE_MULTIPLE) {
      drafts.push({
        brandId,
        kind: "repurpose_top_performer",
        title: `Repurpose "${top.title ?? "your top performer"}" to other channels`,
        rationale:
          `This is your highest-engagement published piece (${top.latest.engagementTotal} total engagement vs. an average of ` +
          `${Math.round(overallAvgEngagementTotal)} across ${rows.length} published pieces — ${multiple.toFixed(1)}x). ` +
          `That correlation is the strongest evidence available right now for what resonates with your audience, but it does not ` +
          `prove the same content or angle will perform the same way on a different channel or topic — treat this as a lead worth ` +
          `testing, not a guarantee.`,
        subjectType: "document",
        subjectId: top.scheduledPublicationId,
        subjectLabel: top.title ?? top.scheduledPublicationId,
        evidence: {
          scheduledPublicationId: top.scheduledPublicationId,
          channel: top.channel,
          format: top.format,
          engagementTotal: top.latest.engagementTotal,
          impressions: top.latest.impressions,
          brandAverageEngagementTotal: Math.round(overallAvgEngagementTotal),
          sampleSize: rows.length,
          multipleOfAverage: Number(multiple.toFixed(2)),
        },
      });
    }
  }

  // ── Rule 2: double down on a channel ───────────────────────────────────
  const byChannel = aggregateByDimension(rows, "channel", "engagementTotal");
  const bestChannel = byChannel.find((c) => c.publicationCount >= MIN_SAMPLE_SIZE);
  if (bestChannel && overallAvgEngagementTotal > 0) {
    const multiple = bestChannel.value / overallAvgEngagementTotal;
    if (multiple >= NOTABLE_MULTIPLE && byChannel.length > 1) {
      drafts.push({
        brandId,
        kind: "double_down_channel",
        title: `Publish more on ${bestChannel.label}`,
        rationale:
          `Across ${bestChannel.publicationCount} published posts on ${bestChannel.label}, average engagement is ` +
          `${Math.round(bestChannel.value)} vs. ${Math.round(overallAvgEngagementTotal)} overall (${multiple.toFixed(1)}x). ` +
          `This is a correlation observed in your own published history, not proof that ${bestChannel.label} itself causes ` +
          `higher engagement — audience overlap, timing, or content type could also explain it. Worth allocating more content ` +
          `there to see if the pattern holds.`,
        subjectType: "channel",
        subjectId: null,
        subjectLabel: bestChannel.label,
        evidence: {
          channel: bestChannel.label,
          averageEngagementTotal: Math.round(bestChannel.value),
          brandAverageEngagementTotal: Math.round(overallAvgEngagementTotal),
          sampleSize: bestChannel.publicationCount,
          multipleOfAverage: Number(multiple.toFixed(2)),
        },
      });
    }
  }

  // ── Rule 3: topic momentum ──────────────────────────────────────────────
  const byTopic = aggregateByDimension(rows, "topic", "engagementTotal");
  const bestTopic = byTopic.find((t) => t.publicationCount >= MIN_SAMPLE_SIZE);
  if (bestTopic && overallAvgEngagementTotal > 0) {
    const multiple = bestTopic.value / overallAvgEngagementTotal;
    if (multiple >= NOTABLE_MULTIPLE && byTopic.length > 1) {
      drafts.push({
        brandId,
        kind: "topic_momentum",
        title: `Create more content on "${bestTopic.label}"`,
        rationale:
          `${bestTopic.publicationCount} published pieces on "${bestTopic.label}" average ${Math.round(bestTopic.value)} ` +
          `engagement vs. ${Math.round(overallAvgEngagementTotal)} across all topics (${multiple.toFixed(1)}x). This shows a ` +
          `correlation between this topic and stronger engagement in your history so far — it doesn't guarantee a new piece on ` +
          `the same topic will repeat it, since other factors (timing, format, channel mix) were not held constant.`,
        subjectType: "topic",
        subjectId: null,
        subjectLabel: bestTopic.label,
        evidence: {
          topic: bestTopic.label,
          averageEngagementTotal: Math.round(bestTopic.value),
          brandAverageEngagementTotal: Math.round(overallAvgEngagementTotal),
          sampleSize: bestTopic.publicationCount,
          multipleOfAverage: Number(multiple.toFixed(2)),
        },
      });
    }
  }

  // ── Rule 4: format underperformance (worst-performer insight) ─────────
  const byFormat = aggregateByDimension(rows, "format", "engagementTotal");
  const eligibleFormats = byFormat.filter((f) => f.publicationCount >= MIN_SAMPLE_SIZE);
  const worstFormat = eligibleFormats[eligibleFormats.length - 1];
  if (worstFormat && overallAvgEngagementTotal > 0 && eligibleFormats.length > 1) {
    const ratio = worstFormat.value / overallAvgEngagementTotal;
    if (ratio <= 1 / NOTABLE_MULTIPLE) {
      drafts.push({
        brandId,
        kind: "format_underperformance",
        title: `Reconsider investing further in "${worstFormat.label}"`,
        rationale:
          `${worstFormat.publicationCount} published "${worstFormat.label}" pieces average ${Math.round(worstFormat.value)} ` +
          `engagement vs. ${Math.round(overallAvgEngagementTotal)} overall — noticeably below average so far. This is a ` +
          `correlation in a limited sample, not a verdict: it may reflect topic or channel choices for those specific pieces ` +
          `rather than the format itself. Worth reviewing before investing more there.`,
        subjectType: "format",
        subjectId: null,
        subjectLabel: worstFormat.label,
        evidence: {
          format: worstFormat.label,
          averageEngagementTotal: Math.round(worstFormat.value),
          brandAverageEngagementTotal: Math.round(overallAvgEngagementTotal),
          sampleSize: worstFormat.publicationCount,
          ratioOfAverage: Number(ratio.toFixed(2)),
        },
      });
    }
  }

  return drafts;
}

/**
 * Recomputes and upserts recommendations for a brand. A recommendation the
 * user has already accepted or dismissed is left untouched — its evidence
 * may be stale, but the user's decision about it must never be silently
 * reset by a later recomputation. Only "pending" rows are refreshed in
 * place; genuinely new patterns are inserted as new pending rows.
 *
 * Reconciliation: a "pending" recommendation whose dedupe key is no longer
 * among the freshly generated drafts means the pattern that justified it no
 * longer holds against the current evidence (e.g. more data diluted the
 * multiple below the notable threshold, or the underlying rows disappeared
 * entirely). It is deleted rather than left around indefinitely — a stale
 * "pending" row would otherwise sit on the dashboard looking like a live,
 * currently evidence-backed suggestion when it no longer is one. This never
 * touches accepted/dismissed rows: the user's decision on those must survive
 * regardless of what the evidence looks like today.
 */
export async function refreshRecommendationsForBrand(brandId: string, rows: PerformanceRow[]): Promise<void> {
  const drafts = generateRecommendationsForBrand(brandId, rows);
  const currentDedupeKeys = drafts.map(dedupeKeyFor);

  await db
    .delete(performanceRecommendationsTable)
    .where(
      currentDedupeKeys.length > 0
        ? and(
            eq(performanceRecommendationsTable.brandId, brandId),
            eq(performanceRecommendationsTable.status, "pending"),
            notInArray(performanceRecommendationsTable.dedupeKey, currentDedupeKeys),
          )
        : and(eq(performanceRecommendationsTable.brandId, brandId), eq(performanceRecommendationsTable.status, "pending")),
    );

  for (const draft of drafts) {
    const dedupeKey = dedupeKeyFor(draft);
    const [existing] = await db
      .select()
      .from(performanceRecommendationsTable)
      .where(and(eq(performanceRecommendationsTable.brandId, brandId), eq(performanceRecommendationsTable.dedupeKey, dedupeKey)))
      .limit(1);

    if (!existing) {
      const insert: InsertPerformanceRecommendation = {
        id: randomUUID(),
        brandId: draft.brandId,
        kind: draft.kind,
        title: draft.title,
        rationale: draft.rationale,
        evidence: draft.evidence,
        subjectType: draft.subjectType,
        subjectId: draft.subjectId,
        subjectLabel: draft.subjectLabel,
        dedupeKey,
        status: "pending",
        actedAt: null,
        actedNote: null,
      };
      await db.insert(performanceRecommendationsTable).values(insert);
      continue;
    }

    if (existing.status === "pending") {
      await db
        .update(performanceRecommendationsTable)
        .set({ title: draft.title, rationale: draft.rationale, evidence: draft.evidence })
        .where(eq(performanceRecommendationsTable.id, existing.id));
    }
    // accepted/dismissed rows are left exactly as the user last saw them.
  }
}

/**
 * Refreshes every brand in scope for a `/performance/recommendations`
 * request — not just brands that happen to appear in `rows`. A brand whose
 * publications lost all their ingested data (or dropped below eligibility)
 * still needs its stale "pending" recommendations reconciled away, which
 * only happens as a side effect of calling refreshRecommendationsForBrand;
 * skipping a zero-row brand would let its old recommendations linger
 * forever. Returns the brand ids that were refreshed.
 */
export async function reconcileRecommendationsForUser(userId: string, requestedBrandId: string | undefined, rows: PerformanceRow[]): Promise<string[]> {
  const rowsByBrand = new Map<string, PerformanceRow[]>();
  for (const row of rows) {
    const list = rowsByBrand.get(row.brandId) ?? [];
    list.push(row);
    rowsByBrand.set(row.brandId, list);
  }

  const brandIds = requestedBrandId
    ? [requestedBrandId]
    : (await db.select({ id: brandsTable.id }).from(brandsTable).where(eq(brandsTable.userId, userId))).map((b) => b.id);

  for (const brandId of brandIds) {
    await refreshRecommendationsForBrand(brandId, rowsByBrand.get(brandId) ?? []);
  }
  return brandIds;
}
