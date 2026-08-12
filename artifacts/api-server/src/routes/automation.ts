/**
 * Automation action API — the safe, idempotent operations an external
 * workflow tool (e.g. n8n) triggers instead of clicking through the
 * dashboard. Every route here accepts either a session cookie or an
 * `Authorization: Bearer <api key>` header (see requireApiKeyOrSession),
 * which is why this router is mounted in the PUBLIC section of routes/index.ts
 * (before the global session-only requireAuth) — it does its own auth check.
 *
 * POST routes additionally require an `Idempotency-Key` header (withIdempotency)
 * so a retried request (e.g. after a dropped response) never repeats the
 * side effect. See docs/automation-api.md for the full external contract.
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  brandsTable,
  projectsTable,
  documentsTable,
  documentSectionsTable,
  repurposingBatchesTable,
  repurposedAssetsTable,
  publishingDestinationsTable,
  scheduledPublicationsTable,
} from "@workspace/db";
import { getBrandOwned, getProjectOwned, getRepurposingBatchOwned, getScheduledPublicationOwned, getPublishingDestinationOwned, getRepurposedAssetOwned } from "../middleware/ownershipHelpers";
import { requireApiKeyOrSession, requireScope, getAutomationUserId } from "../middleware/requireApiKeyOrSession";
import { withIdempotency } from "../lib/automation/idempotency";
import { isValidChannel } from "../lib/repurposing";
import { runRepurposingBatch } from "../lib/workflows/repurposing-workflow";
import { attemptPublication, resolveDocumentContent } from "../lib/workflows/publishing-workflow";
import { emitEvent } from "../lib/webhooks/events";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

router.use(requireApiKeyOrSession);

// ── Projects ────────────────────────────────────────────────────────────────

// POST /automation/projects — create a project (equivalent to POST /projects, action-API contract).
router.post("/automation/projects", requireScope("projects:write"), withIdempotency("POST /automation/projects"), async (req, res): Promise<void> => {
  const userId = getAutomationUserId(req);
  const body = req.body ?? {};
  if (!body.brandId || !body.title || !body.contentType) {
    res.status(400).json({ error: "brandId, title, contentType are required" });
    return;
  }
  const brand = await getBrandOwned(body.brandId, userId, res);
  if (!brand) return;

  const [project] = await db.insert(projectsTable).values({
    id: randomUUID(),
    userId,
    status: "active",
    workflowStage: "assignment",
    brandId: body.brandId,
    title: body.title,
    contentType: body.contentType,
    topic: body.topic,
    purpose: body.purpose,
    intendedAudience: body.intendedAudience,
    audienceKnowledgeLevel: body.audienceKnowledgeLevel,
    desiredReaderOutcome: body.desiredReaderOutcome,
    geographicFocus: body.geographicFocus,
    targetLength: body.targetLength,
    tone: body.tone,
    readingLevel: body.readingLevel,
    pointOfView: body.pointOfView,
    researchFreshness: body.researchFreshness,
    citationRequirement: body.citationRequirement,
    requiredSections: body.requiredSections,
    subjectsToAvoid: body.subjectsToAvoid,
    wordsToAvoid: body.wordsToAvoid,
    additionalInstructions: body.additionalInstructions,
    blueprintId: body.blueprintId ?? null,
  }).returning();

  await logActivity("project_created", `Project "${project.title}" created`, { userId, projectId: project.id, projectTitle: project.title, brandName: brand.name }).catch(() => {});
  await emitEvent({
    type: "project.created", userId, brandId: project.brandId, projectId: project.id,
    data: { projectId: project.id, title: project.title, contentType: project.contentType, brandId: project.brandId },
  });
  res.status(201).json({ ...project, brandName: brand.name });
});

// GET /automation/projects/:id — status lookup for a project created/managed through this API.
router.get("/automation/projects/:id", requireScope("read"), async (req, res): Promise<void> => {
  const project = await getProjectOwned(paramId(req.params.id), getAutomationUserId(req), res);
  if (!project) return;
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);
  res.json({ ...project, brandName: brand?.name ?? null });
});

// ── Repurposing ─────────────────────────────────────────────────────────────

// POST /automation/projects/:id/repurposing-batches — request repurposing for a project's current document.
router.post("/automation/projects/:id/repurposing-batches", requireScope("repurposing:write"), withIdempotency((req) => `POST /automation/projects/${paramId(req.params.id)}/repurposing-batches`), async (req, res): Promise<void> => {
  const userId = getAutomationUserId(req);
  const id = paramId(req.params.id);
  const project = await getProjectOwned(id, userId, res);
  if (!project) return;

  const { channels, documentSectionId, campaignName, tone, audience, cta, targetLength, additionalInstructions } = req.body ?? {};
  if (!Array.isArray(channels) || channels.length === 0) {
    res.status(400).json({ error: "channels must be a non-empty array" });
    return;
  }
  const invalid = channels.filter((c: unknown) => typeof c !== "string" || !isValidChannel(c));
  if (invalid.length > 0) { res.status(400).json({ error: `Unknown channel(s): ${invalid.join(", ")}` }); return; }
  const uniqueChannels = Array.from(new Set(channels as string[]));
  if (uniqueChannels.length !== channels.length) {
    res.status(400).json({ error: "Duplicate channel(s) in request — each channel may only be requested once per batch" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id)).limit(1);
  if (!doc) { res.status(400).json({ error: "No document found for this project" }); return; }

  if (documentSectionId) {
    const [section] = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.id, documentSectionId)).limit(1);
    if (!section || section.documentId !== doc.id) { res.status(400).json({ error: "documentSectionId does not belong to this project's document" }); return; }
  }

  const [batch] = await db.insert(repurposingBatchesTable).values({
    id: randomUUID(),
    projectId: id,
    documentId: doc.id,
    documentSectionId: documentSectionId ?? null,
    campaignName: campaignName ?? null,
    channels,
    tone: tone ?? null,
    audience: audience ?? null,
    cta: cta ?? null,
    targetLength: targetLength ?? null,
    additionalInstructions: additionalInstructions ?? null,
    status: "processing",
  }).returning();

  void runRepurposingBatch(batch.id).catch((err) => {
    req.log.error({ err }, "Repurposing batch failed");
  });

  await logActivity("repurposing_batch_started", `Repurposing batch started for "${project.title}" (${channels.length} channel(s))`, {
    userId, projectId: id, projectTitle: project.title,
  }).catch(() => {});

  res.status(201).json({ ...batch, assets: [] });
});

// GET /automation/repurposing-batches/:id — status + assets for a batch, so a workflow can poll until "completed"/"failed"/"partial".
router.get("/automation/repurposing-batches/:id", requireScope("read"), async (req, res): Promise<void> => {
  const batch = await getRepurposingBatchOwned(paramId(req.params.id), getAutomationUserId(req), res);
  if (!batch) return;
  const assets = await db.select().from(repurposedAssetsTable).where(eq(repurposedAssetsTable.batchId, batch.id));
  res.json({ ...batch, assets: assets.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) });
});

// ── Publishing ──────────────────────────────────────────────────────────────

// POST /automation/scheduled-publications — schedule (or immediately attempt) a publish to an existing destination.
router.post("/automation/scheduled-publications", requireScope("publishing:write"), withIdempotency("POST /automation/scheduled-publications"), async (req, res): Promise<void> => {
  const userId = getAutomationUserId(req);
  const { destinationId, sourceType, documentId, repurposedAssetId, scheduledFor } = req.body ?? {};

  if (typeof destinationId !== "string") { res.status(400).json({ error: "destinationId is required" }); return; }
  const destination = await getPublishingDestinationOwned(destinationId, userId, res);
  if (!destination) return;
  if (!destination.isActive) { res.status(400).json({ error: "This destination is not active" }); return; }

  if (sourceType !== "document" && sourceType !== "repurposed_asset") {
    res.status(400).json({ error: "sourceType must be 'document' or 'repurposed_asset'" });
    return;
  }

  let projectId: string;
  let title: string | null;
  let content: string;

  if (sourceType === "document") {
    if (typeof documentId !== "string") { res.status(400).json({ error: "documentId is required for sourceType 'document'" }); return; }
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }
    const project = await getProjectOwned(doc.projectId, userId, res);
    if (!project) return;
    if (project.brandId !== destination.brandId) { res.status(400).json({ error: "This document belongs to a different brand than the destination" }); return; }
    if (!doc.isPublicationReady) { res.status(400).json({ error: "This document has not been approved for publication yet (quality evaluation must pass isPublicationReady)" }); return; }
    projectId = project.id;
    try {
      const resolved = await resolveDocumentContent(documentId);
      title = resolved.title;
      content = resolved.content;
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
  } else {
    if (typeof repurposedAssetId !== "string") { res.status(400).json({ error: "repurposedAssetId is required for sourceType 'repurposed_asset'" }); return; }
    const asset = await getRepurposedAssetOwned(repurposedAssetId, userId, res);
    if (!asset) return;
    const project = await getProjectOwned(asset.projectId, userId, res);
    if (!project) return;
    if (project.brandId !== destination.brandId) { res.status(400).json({ error: "This asset belongs to a different brand than the destination" }); return; }
    if (!asset.isApproved) { res.status(400).json({ error: "This repurposed asset has not been approved yet" }); return; }
    projectId = project.id;
    title = asset.title;
    content = asset.content;
  }

  const targetTime = scheduledFor ? new Date(scheduledFor) : new Date();
  if (Number.isNaN(targetTime.getTime())) { res.status(400).json({ error: "scheduledFor must be a valid date" }); return; }

  const [publication] = await db.insert(scheduledPublicationsTable).values({
    id: randomUUID(),
    brandId: destination.brandId,
    projectId,
    destinationId: destination.id,
    sourceType,
    documentId: sourceType === "document" ? documentId : null,
    repurposedAssetId: sourceType === "repurposed_asset" ? repurposedAssetId : null,
    title,
    content,
    scheduledFor: targetTime,
    nextAttemptAt: targetTime,
    status: "pending",
  }).returning();

  await logActivity("publication_scheduled", `Scheduled publish to ${destination.label} (${destination.platform})`, { userId, projectId }).catch(() => {});
  await emitEvent({
    type: "publication.scheduled", userId, brandId: destination.brandId, projectId,
    data: { publicationId: publication.id, projectId, destinationId: destination.id, platform: destination.platform, scheduledFor: targetTime.toISOString() },
  });

  if (targetTime.getTime() <= Date.now()) {
    void attemptPublication(publication).catch((err) => {
      req.log.error({ err }, "Immediate publish attempt failed");
    });
  }

  res.status(201).json(publication);
});

// GET /automation/scheduled-publications/:id — status lookup, so a workflow can poll until "published"/"failed".
router.get("/automation/scheduled-publications/:id", requireScope("read"), async (req, res): Promise<void> => {
  const publication = await getScheduledPublicationOwned(paramId(req.params.id), getAutomationUserId(req), res);
  if (!publication) return;
  res.json(publication);
});

export default router;
