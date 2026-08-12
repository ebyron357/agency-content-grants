/**
 * Content Performance Engine routes — query ingested performance data,
 * best/worst aggregation, per-publication trend history, evidence-backed
 * recommendations, and a manual ingestion trigger. All routes require
 * authentication (mounted after requireAuth) and are scoped to the caller's
 * own brands.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, performanceRecommendationsTable } from "@workspace/db";
import { getBrandOwned, getScheduledPublicationOwned, getPerformanceRecommendationOwned } from "../middleware/ownershipHelpers";
import { getPerformanceRowsForUser, getSnapshotHistory, bestAndWorst } from "../lib/performance/aggregation";
import { reconcileRecommendationsForUser } from "../lib/performance/recommendations";
import { ingestNowForUser } from "../lib/performance/ingestion";
import { logActivity } from "../lib/activity";
import type { PerformanceDimension, PerformanceMetric } from "../lib/performance/types";

const router: IRouter = Router();

const VALID_DIMENSIONS = new Set<PerformanceDimension>(["channel", "format", "topic", "campaign", "brand"]);
const VALID_METRICS = new Set<PerformanceMetric>(["impressions", "engagementTotal", "engagementRate", "likes"]);

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

// GET /performance/publications — every ingested publication's latest metrics, optionally scoped to one brand.
router.get("/performance/publications", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : undefined;
  if (brandId) {
    const brand = await getBrandOwned(brandId, userId, res);
    if (!brand) return;
  }
  const rows = await getPerformanceRowsForUser(userId, brandId);
  res.json(rows);
});

// GET /performance/best-worst?dimension=channel&metric=engagementTotal&limit=5
router.get("/performance/best-worst", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : undefined;
  if (brandId) {
    const brand = await getBrandOwned(brandId, userId, res);
    if (!brand) return;
  }
  const dimension = typeof req.query.dimension === "string" ? req.query.dimension : "channel";
  const metric = typeof req.query.metric === "string" ? req.query.metric : "engagementTotal";
  const limit = req.query.limit ? Number(req.query.limit) : 5;

  if (!VALID_DIMENSIONS.has(dimension as PerformanceDimension)) {
    res.status(400).json({ error: `Invalid dimension. Must be one of: ${Array.from(VALID_DIMENSIONS).join(", ")}` });
    return;
  }
  if (!VALID_METRICS.has(metric as PerformanceMetric)) {
    res.status(400).json({ error: `Invalid metric. Must be one of: ${Array.from(VALID_METRICS).join(", ")}` });
    return;
  }

  const rows = await getPerformanceRowsForUser(userId, brandId);
  const result = bestAndWorst(rows, dimension as PerformanceDimension, metric as PerformanceMetric, Number.isFinite(limit) ? limit : 5);
  res.json(result);
});

// GET /performance/publications/:id/history — full ordered snapshot history for one publication.
router.get("/performance/publications/:id/history", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const publication = await getScheduledPublicationOwned(paramId(req.params.id), userId, res);
  if (!publication) return;
  const history = await getSnapshotHistory(publication.id);
  res.json(history);
});

// POST /performance/ingest — manual "refresh metrics now" trigger, scoped to the caller's own brand(s).
router.post("/performance/ingest", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brandId = typeof req.body?.brandId === "string" ? req.body.brandId : undefined;
  if (brandId) {
    const brand = await getBrandOwned(brandId, userId, res);
    if (!brand) return;
  }
  const result = await ingestNowForUser(userId, brandId);
  if (result.snapshotsInserted > 0) {
    await logActivity(
      "performance.ingested",
      `Ingested ${result.snapshotsInserted} performance snapshot${result.snapshotsInserted === 1 ? "" : "s"} across ${result.destinationsChecked} destination${result.destinationsChecked === 1 ? "" : "s"}`,
      { userId },
    ).catch(() => {}); // activity logging must never block the actual ingestion result
  }
  res.json(result);
});

// GET /performance/recommendations?brandId= — recompute (from real ingested data) and return recommendations.
router.get("/performance/recommendations", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : undefined;
  if (brandId) {
    const brand = await getBrandOwned(brandId, userId, res);
    if (!brand) return;
  }

  const rows = await getPerformanceRowsForUser(userId, brandId);
  // Refreshes every brand in scope (including ones with zero rows) so a
  // brand whose data disappeared still gets its stale "pending"
  // recommendations reconciled away, not just brands with current rows.
  const brandIds = await reconcileRecommendationsForUser(userId, brandId, rows);

  if (brandIds.length === 0) {
    res.json([]);
    return;
  }

  const recommendations = (
    await Promise.all(brandIds.map((id) => db.select().from(performanceRecommendationsTable).where(eq(performanceRecommendationsTable.brandId, id))))
  ).flat();

  recommendations.sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  res.json(recommendations);
});

// PATCH /performance/recommendations/:id — accept or dismiss, the acceptance-tracking mechanism.
router.patch("/performance/recommendations/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const recommendation = await getPerformanceRecommendationOwned(paramId(req.params.id), userId, res);
  if (!recommendation) return;

  const status = req.body?.status;
  if (status !== "accepted" && status !== "dismissed" && status !== "pending") {
    res.status(400).json({ error: "status must be 'accepted', 'dismissed', or 'pending'" });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note : null;

  const [updated] = await db
    .update(performanceRecommendationsTable)
    .set({
      status,
      actedAt: status === "pending" ? null : new Date(),
      actedNote: status === "pending" ? null : note,
    })
    .where(eq(performanceRecommendationsTable.id, recommendation.id))
    .returning();

  await logActivity(`performance.recommendation.${status}`, `${status === "accepted" ? "Accepted" : status === "dismissed" ? "Dismissed" : "Reset"} recommendation: ${recommendation.title}`, { userId }).catch(() => {});

  res.json(updated);
});

export default router;
