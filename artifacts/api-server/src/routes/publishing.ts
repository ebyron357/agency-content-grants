/**
 * Content Distribution Engine routes — connect/manage destinations, and
 * schedule/cancel/reschedule publications for approved documents or
 * repurposed assets. All routes require authentication (mounted after
 * requireAuth) and enforce ownership + approval-before-publish.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  documentsTable,
  repurposedAssetsTable,
  projectsTable,
  publishingDestinationsTable,
  scheduledPublicationsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  getBrandOwned,
  getProjectOwned,
  getPublishingDestinationOwned,
  getScheduledPublicationOwned,
  getRepurposedAssetOwned,
} from "../middleware/ownershipHelpers";
import { isValidPublishProvider, getPublishProvidersStatus } from "../lib/publishing/router";
import { attemptPublication, getAttemptHistory, cancelPublication, removePublishingDestination, resolveDocumentContent } from "../lib/workflows/publishing-workflow";
import { logActivity } from "../lib/activity";
import { emitEvent } from "../lib/webhooks/events";

const router: IRouter = Router();

const VALID_PLATFORMS = new Set(["x", "linkedin", "threads", "bluesky", "mastodon", "demo"]);
const DESTINATION_PATCH_ALLOWED = new Set(["label", "externalAccountId", "config", "isActive"]);

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

// ── Provider catalog ──────────────────────────────────────────────────────────

router.get("/publishing-providers", async (_req, res): Promise<void> => {
  res.json(getPublishProvidersStatus());
});

// ── Destinations (per brand) ──────────────────────────────────────────────────

router.get("/brands/:id/publishing-destinations", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  const destinations = await db.select().from(publishingDestinationsTable).where(eq(publishingDestinationsTable.brandId, id)).orderBy(desc(publishingDestinationsTable.createdAt));
  res.json(destinations);
});

router.post("/brands/:id/publishing-destinations", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;

  const { provider, platform, label, externalAccountId, config } = req.body ?? {};
  if (typeof provider !== "string" || !isValidPublishProvider(provider)) {
    res.status(400).json({ error: "provider must be one of the registered publish providers" });
    return;
  }
  if (typeof platform !== "string" || !VALID_PLATFORMS.has(platform)) {
    res.status(400).json({ error: `platform must be one of: ${Array.from(VALID_PLATFORMS).join(", ")}` });
    return;
  }
  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }

  const [destination] = await db.insert(publishingDestinationsTable).values({
    id: randomUUID(),
    brandId: id,
    provider,
    platform,
    label: label.trim(),
    externalAccountId: externalAccountId ?? null,
    config: config ?? null,
    isActive: true,
  }).returning();
  res.status(201).json(destination);
});

router.patch("/publishing-destinations/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const destination = await getPublishingDestinationOwned(id, req.session.userId!, res);
  if (!destination) return;

  const allowed = pickAllowed(req.body ?? {}, DESTINATION_PATCH_ALLOWED);
  if (allowed.__error) { res.status(400).json({ error: allowed.__error }); return; }
  if (Object.keys(allowed).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(publishingDestinationsTable).set(allowed).where(eq(publishingDestinationsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/publishing-destinations/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const destination = await getPublishingDestinationOwned(id, req.session.userId!, res);
  if (!destination) return;

  // See removePublishingDestination: refuses the delete (409) instead of
  // silently erasing scheduled/published history when any publication still
  // references this destination. The caller should deactivate it instead.
  const result = await removePublishingDestination(id);
  if (result.outcome === "in_use") {
    res.status(409).json({
      error: `This destination has ${result.publicationCount} scheduled or historical publication${result.publicationCount === 1 ? "" : "s"} attached to it. Deactivate it instead of deleting to keep that history intact.`,
      inUse: true,
      publicationCount: result.publicationCount,
    });
    return;
  }
  res.status(204).send();
});

// ── Scheduled publications ────────────────────────────────────────────────────

router.get("/brands/:id/scheduled-publications", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  const publications = await db.select().from(scheduledPublicationsTable).where(eq(scheduledPublicationsTable.brandId, id)).orderBy(desc(scheduledPublicationsTable.scheduledFor));
  res.json(publications);
});

router.post("/scheduled-publications", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
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
    // Approval-before-publish is enforced here, not just advisory: a document
    // must have passed quality evaluation (isPublicationReady) before it can
    // be scheduled or published, regardless of what the client sends.
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

  logActivity("publication_scheduled", `Scheduled publish to ${destination.label} (${destination.platform})`, {
    userId, projectId,
  }).catch(() => {});
  await emitEvent({
    type: "publication.scheduled", userId, brandId: destination.brandId, projectId,
    data: { publicationId: publication.id, projectId, destinationId: destination.id, platform: destination.platform, scheduledFor: targetTime.toISOString() },
  });

  // If the requested time is now (or already past), attempt immediately
  // instead of waiting for the next scheduler tick, so "publish now" feels
  // instant. The scheduler will still pick it up if this attempt fails.
  if (targetTime.getTime() <= Date.now()) {
    void attemptPublication(publication).catch((err) => {
      req.log.error({ err }, "Immediate publish attempt failed");
    });
  }

  res.status(201).json(publication);
});

router.get("/scheduled-publications/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const publication = await getScheduledPublicationOwned(id, req.session.userId!, res);
  if (!publication) return;
  const attempts = await getAttemptHistory(id);
  res.json({ ...publication, attempts });
});

router.get("/scheduled-publications/:id/attempts", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const publication = await getScheduledPublicationOwned(id, req.session.userId!, res);
  if (!publication) return;
  res.json(await getAttemptHistory(id));
});

router.patch("/scheduled-publications/:id/cancel", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const publication = await getScheduledPublicationOwned(id, req.session.userId!, res);
  if (!publication) return;

  // cancelPublication handles every status atomically, including a real
  // provider-side cancellation for content already submitted to the provider
  // ("queued") — a DB-only status flip is not enough once a post has been
  // handed off, and could otherwise leave the UI showing "cancelled" for
  // something that still gets published externally.
  const result = await cancelPublication(id);

  if (result.outcome === "not_cancellable") {
    res.status(400).json({ error: result.message ?? "This publication cannot be cancelled." });
    return;
  }
  if (result.outcome === "already_published") {
    // The provider published it before the cancel could take effect — report
    // the true state (published), not a false "cancelled".
    res.status(409).json({ error: result.message, publication: result.publication });
    return;
  }
  if (result.outcome === "pending_best_effort") {
    res.status(202).json({ message: result.message, publication: result.publication });
    return;
  }
  res.json(result.publication);
});

router.patch("/scheduled-publications/:id/reschedule", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const publication = await getScheduledPublicationOwned(id, req.session.userId!, res);
  if (!publication) return;

  const { scheduledFor } = req.body ?? {};
  const targetTime = scheduledFor ? new Date(scheduledFor) : null;
  if (!targetTime || Number.isNaN(targetTime.getTime())) { res.status(400).json({ error: "scheduledFor must be a valid date" }); return; }

  // Atomic: only succeeds if the row is still "pending" at the moment of the
  // update, so a scheduler tick that just claimed it for an attempt (status
  // -> "publishing") can't have its in-flight work silently ignored by a
  // reschedule that lands a moment later.
  const [updated] = await db.update(scheduledPublicationsTable).set({
    scheduledFor: targetTime,
    nextAttemptAt: targetTime,
  }).where(and(eq(scheduledPublicationsTable.id, id), eq(scheduledPublicationsTable.status, "pending"))).returning();

  if (!updated) {
    res.status(400).json({ error: "Only a pending publication can be rescheduled (it may currently be publishing, or already finalized)." });
    return;
  }
  res.json(updated);
});

export default router;
