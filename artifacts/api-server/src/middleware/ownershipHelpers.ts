/**
 * Ownership helpers.
 *
 * Every helper returns the record if the authenticated user owns it,
 * or sends 404 and returns null (404 prevents ID enumeration).
 * Never trust client-supplied user IDs — always use req.session.userId.
 */
import { db } from "@workspace/db";
import {
  brandsTable,
  projectsTable,
  sourcesTable,
  documentsTable,
  documentSectionsTable,
  researchPlansTable,
  outlinesTable,
  outlineSectionsTable,
  exportsTable,
  qualityEvaluationsTable,
  claimsTable,
  repurposingBatchesTable,
  repurposedAssetsTable,
  repurposingPresetsTable,
  publishingDestinationsTable,
  scheduledPublicationsTable,
  performanceRecommendationsTable,
  apiKeysTable,
  webhookSubscriptionsTable,
  webhookDeliveriesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Response } from "express";

// ── Brand ────────────────────────────────────────────────────────────────────

export async function getBrandOwned(brandId: string, userId: string, res: Response) {
  const [brand] = await db
    .select()
    .from(brandsTable)
    .where(and(eq(brandsTable.id, brandId), eq(brandsTable.userId, userId)))
    .limit(1);
  if (!brand) { res.status(404).json({ error: "Not found" }); return null; }
  return brand;
}

// ── Project ──────────────────────────────────────────────────────────────────

export async function getProjectOwned(projectId: string, userId: string, res: Response) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Not found" }); return null; }
  return project;
}

// ── Source (via project) ─────────────────────────────────────────────────────

export async function getSourceOwned(sourceId: string, userId: string, res: Response) {
  const [source] = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.id, sourceId))
    .limit(1);
  if (!source) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(source.projectId, userId, res);
  if (!project) return null; // 404 already sent
  return source;
}

// ── Document section (via document → project) ────────────────────────────────

export async function getSectionOwned(sectionId: string, userId: string, res: Response) {
  const [section] = await db
    .select()
    .from(documentSectionsTable)
    .where(eq(documentSectionsTable.id, sectionId))
    .limit(1);
  if (!section) { res.status(404).json({ error: "Not found" }); return null; }

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, section.documentId))
    .limit(1);
  if (!doc) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(doc.projectId, userId, res);
  if (!project) return null;
  return section;
}

// ── Research plan (via project) ──────────────────────────────────────────────

export async function getResearchPlanOwned(planId: string, userId: string, res: Response) {
  const [plan] = await db
    .select()
    .from(researchPlansTable)
    .where(eq(researchPlansTable.id, planId))
    .limit(1);
  if (!plan) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(plan.projectId, userId, res);
  if (!project) return null;
  return plan;
}

// ── Outline (via project) ────────────────────────────────────────────────────

export async function getOutlineOwned(outlineId: string, userId: string, res: Response) {
  const [outline] = await db
    .select()
    .from(outlinesTable)
    .where(eq(outlinesTable.id, outlineId))
    .limit(1);
  if (!outline) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(outline.projectId, userId, res);
  if (!project) return null;
  return outline;
}

// ── Outline section (via outline → project) ───────────────────────────────────

export async function getOutlineSectionOwned(sectionId: string, userId: string, res: Response) {
  const [section] = await db
    .select()
    .from(outlineSectionsTable)
    .where(eq(outlineSectionsTable.id, sectionId))
    .limit(1);
  if (!section) { res.status(404).json({ error: "Not found" }); return null; }

  const outline = await getOutlineOwned(section.outlineId, userId, res);
  if (!outline) return null;
  return section;
}

// ── Export (via project) ─────────────────────────────────────────────────────

export async function getExportOwned(exportId: string, userId: string, res: Response) {
  const [exp] = await db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.id, exportId))
    .limit(1);
  if (!exp) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(exp.projectId, userId, res);
  if (!project) return null;
  return exp;
}

// ── Repurposing batch (via project) ──────────────────────────────────────────

export async function getRepurposingBatchOwned(batchId: string, userId: string, res: Response) {
  const [batch] = await db
    .select()
    .from(repurposingBatchesTable)
    .where(eq(repurposingBatchesTable.id, batchId))
    .limit(1);
  if (!batch) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(batch.projectId, userId, res);
  if (!project) return null;
  return batch;
}

// ── Repurposed asset (via project) ───────────────────────────────────────────

export async function getRepurposedAssetOwned(assetId: string, userId: string, res: Response) {
  const [asset] = await db
    .select()
    .from(repurposedAssetsTable)
    .where(eq(repurposedAssetsTable.id, assetId))
    .limit(1);
  if (!asset) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(asset.projectId, userId, res);
  if (!project) return null;
  return asset;
}

// ── Repurposing preset (via brand) ───────────────────────────────────────────

export async function getRepurposingPresetOwned(presetId: string, userId: string, res: Response) {
  const [preset] = await db
    .select()
    .from(repurposingPresetsTable)
    .where(eq(repurposingPresetsTable.id, presetId))
    .limit(1);
  if (!preset) { res.status(404).json({ error: "Not found" }); return null; }

  const brand = await getBrandOwned(preset.brandId, userId, res);
  if (!brand) return null;
  return preset;
}

// ── Quality evaluation (via project) ─────────────────────────────────────────

export async function getQualityEvalOwned(evalId: string, userId: string, res: Response) {
  const [evaluation] = await db
    .select()
    .from(qualityEvaluationsTable)
    .where(eq(qualityEvaluationsTable.id, evalId))
    .limit(1);
  if (!evaluation) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(evaluation.projectId, userId, res);
  if (!project) return null;
  return evaluation;
}

// ── Publishing destination (via brand) ───────────────────────────────────────

export async function getPublishingDestinationOwned(destinationId: string, userId: string, res: Response) {
  const [destination] = await db
    .select()
    .from(publishingDestinationsTable)
    .where(eq(publishingDestinationsTable.id, destinationId))
    .limit(1);
  if (!destination) { res.status(404).json({ error: "Not found" }); return null; }

  const brand = await getBrandOwned(destination.brandId, userId, res);
  if (!brand) return null;
  return destination;
}

// ── Scheduled publication (via brand) ────────────────────────────────────────

export async function getScheduledPublicationOwned(publicationId: string, userId: string, res: Response) {
  const [publication] = await db
    .select()
    .from(scheduledPublicationsTable)
    .where(eq(scheduledPublicationsTable.id, publicationId))
    .limit(1);
  if (!publication) { res.status(404).json({ error: "Not found" }); return null; }

  const brand = await getBrandOwned(publication.brandId, userId, res);
  if (!brand) return null;
  return publication;
}

// ── Performance recommendation (via brand) ───────────────────────────────────

export async function getPerformanceRecommendationOwned(recommendationId: string, userId: string, res: Response) {
  const [recommendation] = await db
    .select()
    .from(performanceRecommendationsTable)
    .where(eq(performanceRecommendationsTable.id, recommendationId))
    .limit(1);
  if (!recommendation) { res.status(404).json({ error: "Not found" }); return null; }

  const brand = await getBrandOwned(recommendation.brandId, userId, res);
  if (!brand) return null;
  return recommendation;
}

// ── API key (direct ownership) ───────────────────────────────────────────────

export async function getApiKeyOwned(keyId: string, userId: string, res: Response) {
  const [key] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.userId, userId)))
    .limit(1);
  if (!key) { res.status(404).json({ error: "Not found" }); return null; }
  return key;
}

// ── Webhook subscription (direct ownership) ──────────────────────────────────

export async function getWebhookSubscriptionOwned(subscriptionId: string, userId: string, res: Response) {
  const [subscription] = await db
    .select()
    .from(webhookSubscriptionsTable)
    .where(and(eq(webhookSubscriptionsTable.id, subscriptionId), eq(webhookSubscriptionsTable.userId, userId)))
    .limit(1);
  if (!subscription) { res.status(404).json({ error: "Not found" }); return null; }
  return subscription;
}

// ── Webhook delivery (via subscription) ──────────────────────────────────────

export async function getWebhookDeliveryOwned(deliveryId: string, userId: string, res: Response) {
  const [delivery] = await db
    .select()
    .from(webhookDeliveriesTable)
    .where(eq(webhookDeliveriesTable.id, deliveryId))
    .limit(1);
  if (!delivery) { res.status(404).json({ error: "Not found" }); return null; }

  const subscription = await getWebhookSubscriptionOwned(delivery.subscriptionId, userId, res);
  if (!subscription) return null;
  return delivery;
}

// ── Claim (via project) ──────────────────────────────────────────────────────

export async function getClaimOwned(claimId: string, userId: string, res: Response) {
  const [claim] = await db
    .select()
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId))
    .limit(1);
  if (!claim) { res.status(404).json({ error: "Not found" }); return null; }

  const project = await getProjectOwned(claim.projectId, userId, res);
  if (!project) return null;
  return claim;
}
