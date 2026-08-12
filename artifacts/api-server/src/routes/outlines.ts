import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { outlinesTable, outlineSectionsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { generateOutline } from "../lib/workflows/content-workflow";
import { getProjectOwned, getOutlineOwned, getOutlineSectionOwned } from "../middleware/ownershipHelpers";

const router: IRouter = Router();

const OUTLINE_SECTION_PATCH_ALLOWED = new Set([
  "title", "description", "keyPoints", "notes", "wordCountTarget", "sortOrder",
]);

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

async function getOutlineWithSections(outlineId: string) {
  const [outline] = await db.select().from(outlinesTable).where(eq(outlinesTable.id, outlineId)).limit(1);
  if (!outline) return null;
  const sections = await db.select().from(outlineSectionsTable).where(eq(outlineSectionsTable.outlineId, outlineId));
  return { ...outline, sections: sections.sort((a, b) => a.sortOrder - b.sortOrder) };
}

router.get("/projects/:id/outline", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const [outline] = await db.select().from(outlinesTable).where(eq(outlinesTable.projectId, id)).limit(1);
  if (!outline) { res.status(404).json({ error: "No outline found" }); return; }
  const sections = await db.select().from(outlineSectionsTable).where(eq(outlineSectionsTable.outlineId, outline.id));
  res.json({ ...outline, sections: sections.sort((a, b) => a.sortOrder - b.sortOrder) });
});

router.post("/projects/:id/outline", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  try {
    const outline = await generateOutline(id, req.body?.additionalContext);
    const result = await getOutlineWithSections(outline.id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Outline generation failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/outlines/:id/approve", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const outline = await getOutlineOwned(id, req.session.userId!, res);
  if (!outline) return;
  const [updated] = await db.update(outlinesTable).set({ status: "approved" }).where(eq(outlinesTable.id, id)).returning();
  await db.update(projectsTable).set({ workflowStage: "drafting" }).where(eq(projectsTable.id, outline.projectId));
  const result = await getOutlineWithSections(id);
  res.json(result);
});

router.post("/outlines/:id/sections", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const outline = await getOutlineOwned(id, req.session.userId!, res);
  if (!outline) return;
  if (!req.body.title) { res.status(400).json({ error: "title is required" }); return; }
  const existing = await db.select().from(outlineSectionsTable).where(eq(outlineSectionsTable.outlineId, id));
  const [section] = await db.insert(outlineSectionsTable).values({
    id: randomUUID(),
    outlineId: id,
    sortOrder: req.body.sortOrder ?? existing.length,
    ...req.body,
  }).returning();
  res.status(201).json(section);
});

router.patch("/outline-sections/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getOutlineSectionOwned(id, req.session.userId!, res);
  if (!section) return;

  const update = pickAllowed(req.body, OUTLINE_SECTION_PATCH_ALLOWED);
  if ((update as any).__error) { res.status(400).json({ error: (update as any).__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(outlineSectionsTable).set(update).where(eq(outlineSectionsTable.id, id)).returning();
  res.json(updated);
});

router.delete("/outline-sections/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getOutlineSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  await db.delete(outlineSectionsTable).where(eq(outlineSectionsTable.id, id));
  res.sendStatus(204);
});

router.post("/outlines/:id/reorder", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const outline = await getOutlineOwned(id, req.session.userId!, res);
  if (!outline) return;
  const { sectionIds } = req.body;
  if (!Array.isArray(sectionIds)) { res.status(400).json({ error: "sectionIds array required" }); return; }
  for (let i = 0; i < sectionIds.length; i++) {
    await db.update(outlineSectionsTable).set({ sortOrder: i }).where(eq(outlineSectionsTable.id, sectionIds[i]));
  }
  const result = await getOutlineWithSections(id);
  res.json(result);
});

export default router;
