/**
 * Repurposing Engine routes — turn an approved document (or one section) into
 * channel-specific derivative assets. All routes require authentication
 * (mounted after requireAuth) and enforce project ownership.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  documentsTable,
  documentSectionsTable,
  projectsTable,
  repurposingBatchesTable,
  repurposedAssetsTable,
  repurposedAssetRevisionsTable,
  repurposingPresetsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getProjectOwned, getRepurposingBatchOwned, getRepurposedAssetOwned, getBrandOwned, getRepurposingPresetOwned } from "../middleware/ownershipHelpers";
import { isValidChannel, listChannels } from "../lib/repurposing";
import { runRepurposingBatch, regenerateRepurposedAsset } from "../lib/workflows/repurposing-workflow";
import { logActivity } from "../lib/activity";
import { emitEvent } from "../lib/webhooks/events";

const router: IRouter = Router();

const ASSET_PATCH_ALLOWED = new Set(["title", "content"]);

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

async function assetsForBatch(batchId: string) {
  const assets = await db.select().from(repurposedAssetsTable).where(eq(repurposedAssetsTable.batchId, batchId));
  return assets.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

const PRESET_FIELDS = new Set(["name", "tone", "audience", "cta", "targetLength"]);

// ── Presets (saved tone/audience/CTA/length combos, per brand) ────────────────

router.get("/brands/:id/repurposing-presets", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;
  const presets = await db.select().from(repurposingPresetsTable).where(eq(repurposingPresetsTable.brandId, id)).orderBy(desc(repurposingPresetsTable.createdAt));
  res.json(presets);
});

router.post("/brands/:id/repurposing-presets", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const brand = await getBrandOwned(id, req.session.userId!, res);
  if (!brand) return;

  const body = pickAllowed(req.body ?? {}, PRESET_FIELDS);
  if (body.__error) { res.status(400).json({ error: body.__error }); return; }
  if (typeof body.name !== "string" || !body.name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [preset] = await db.insert(repurposingPresetsTable).values({
    id: randomUUID(),
    brandId: id,
    name: body.name.trim(),
    tone: body.tone || null,
    audience: body.audience || null,
    cta: body.cta || null,
    targetLength: body.targetLength || null,
  }).returning();
  res.status(201).json(preset);
});

router.delete("/repurposing-presets/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const preset = await getRepurposingPresetOwned(id, req.session.userId!, res);
  if (!preset) return;
  await db.delete(repurposingPresetsTable).where(eq(repurposingPresetsTable.id, id));
  res.status(204).send();
});

// ── Channel catalog ───────────────────────────────────────────────────────────

router.get("/repurposing-channels", async (_req, res): Promise<void> => {
  res.json(listChannels());
});

// ── Batches ───────────────────────────────────────────────────────────────────

router.get("/projects/:id/repurposing-batches", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const batches = await db.select().from(repurposingBatchesTable).where(eq(repurposingBatchesTable.projectId, id)).orderBy(desc(repurposingBatchesTable.createdAt));
  const withAssets = await Promise.all(batches.map(async (b) => ({ ...b, assets: await assetsForBatch(b.id) })));
  res.json(withAssets);
});

router.post("/projects/:id/repurposing-batches", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const { channels, documentSectionId, campaignName, tone, audience, cta, targetLength, additionalInstructions } = req.body ?? {};

  if (!Array.isArray(channels) || channels.length === 0) {
    res.status(400).json({ error: "channels must be a non-empty array" });
    return;
  }
  const invalid = channels.filter((c: unknown) => typeof c !== "string" || !isValidChannel(c));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown channel(s): ${invalid.join(", ")}` });
    return;
  }
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

  // Generation runs in the background — the client polls GET for status,
  // matching the existing exports pattern (potentially several AI calls).
  void runRepurposingBatch(batch.id).catch((err) => {
    req.log.error({ err }, "Repurposing batch failed");
  });

  logActivity("repurposing_batch_started", `Repurposing batch started for "${project.title}" (${channels.length} channel(s))`, {
    userId: req.session.userId!, projectId: id, projectTitle: project.title,
  }).catch(() => {});

  res.status(201).json({ ...batch, assets: [] });
});

router.get("/repurposing-batches/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const batch = await getRepurposingBatchOwned(id, req.session.userId!, res);
  if (!batch) return;
  res.json({ ...batch, assets: await assetsForBatch(batch.id) });
});

// ── Assets ────────────────────────────────────────────────────────────────────

router.get("/projects/:id/repurposed-assets", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const assets = await db.select().from(repurposedAssetsTable).where(eq(repurposedAssetsTable.projectId, id)).orderBy(desc(repurposedAssetsTable.createdAt));
  res.json(assets);
});

router.get("/repurposed-assets/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;
  res.json(asset);
});

router.patch("/repurposed-assets/:id", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;

  const allowed = pickAllowed(req.body ?? {}, ASSET_PATCH_ALLOWED);
  if (allowed.__error) { res.status(400).json({ error: allowed.__error }); return; }
  if (Object.keys(allowed).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  // Manual edits (content OR title) are versioned the same way regeneration
  // is: the prior content+title are preserved in revision history before
  // being overwritten, and an approved asset drops back to draft since its
  // published-facing text just changed.
  const contentChanged = typeof allowed.content === "string" && allowed.content !== asset.content;
  const titleChanged = typeof allowed.title === "string" && allowed.title !== asset.title;
  if (contentChanged || titleChanged) {
    await db.insert(repurposedAssetRevisionsTable).values({
      id: randomUUID(),
      repurposedAssetId: asset.id,
      title: asset.title,
      content: asset.content,
      versionNumber: asset.versionNumber,
      wasApproved: asset.isApproved,
      editType: "manual_edit",
      notes: "Saved before manual edit",
    });
    (allowed as any).versionNumber = asset.versionNumber + 1;
    (allowed as any).isApproved = false;
    (allowed as any).status = "draft";
  }

  const [updated] = await db.update(repurposedAssetsTable).set(allowed).where(eq(repurposedAssetsTable.id, id)).returning();
  res.json(updated);
});

router.post("/repurposed-assets/:id/regenerate", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;
  try {
    await regenerateRepurposedAsset(id);
    const [updated] = await db.select().from(repurposedAssetsTable).where(eq(repurposedAssetsTable.id, id)).limit(1);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Repurposed asset regeneration failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/repurposed-assets/:id/approve", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;
  const [updated] = await db.update(repurposedAssetsTable).set({ isApproved: true, status: "approved" }).where(eq(repurposedAssetsTable.id, id)).returning();
  logActivity("repurposed_asset_approved", `Derivative asset (${asset.channel}) approved`, {
    userId: req.session.userId!, projectId: asset.projectId,
  }).catch(() => {});
  const [ownerProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, asset.projectId)).limit(1);
  if (ownerProject?.userId) {
    await emitEvent({
      type: "repurposing.asset_approved", userId: ownerProject.userId, brandId: ownerProject.brandId, projectId: asset.projectId,
      data: { assetId: asset.id, channel: asset.channel, batchId: asset.batchId, projectId: asset.projectId },
    });
  }
  res.json(updated);
});

router.post("/repurposed-assets/:id/reject", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;
  const [updated] = await db.update(repurposedAssetsTable).set({ isApproved: false, status: "rejected" }).where(eq(repurposedAssetsTable.id, id)).returning();
  res.json(updated);
});

router.get("/repurposed-assets/:id/revisions", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;
  const revisions = await db.select().from(repurposedAssetRevisionsTable).where(eq(repurposedAssetRevisionsTable.repurposedAssetId, id));
  res.json(revisions.sort((a, b) => b.versionNumber - a.versionNumber));
});

router.post("/repurposed-assets/:id/restore", async (req, res): Promise<void> => {
  const id = paramId(req.params.id);
  const asset = await getRepurposedAssetOwned(id, req.session.userId!, res);
  if (!asset) return;
  const { revisionId } = req.body ?? {};
  if (!revisionId) { res.status(400).json({ error: "revisionId required" }); return; }
  const [revision] = await db.select().from(repurposedAssetRevisionsTable).where(eq(repurposedAssetRevisionsTable.id, revisionId)).limit(1);
  if (!revision || revision.repurposedAssetId !== id) { res.status(404).json({ error: "Revision not found" }); return; }

  await db.insert(repurposedAssetRevisionsTable).values({
    id: randomUUID(),
    repurposedAssetId: asset.id,
    title: asset.title,
    content: asset.content,
    versionNumber: asset.versionNumber,
    wasApproved: asset.isApproved,
    editType: "manual_edit",
    notes: "Saved before restore",
  });

  const [updated] = await db.update(repurposedAssetsTable).set({
    title: revision.title ?? asset.title,
    content: revision.content,
    versionNumber: asset.versionNumber + 1,
    isApproved: false,
    status: "draft",
  }).where(eq(repurposedAssetsTable.id, id)).returning();
  res.json(updated);
});

export default router;
