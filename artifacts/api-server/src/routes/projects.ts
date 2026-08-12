import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  brandsTable,
  generationRunsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getProjectOwned, getBrandOwned } from "../middleware/ownershipHelpers";
import { emitEvent } from "../lib/webhooks/events";

const router: IRouter = Router();

const WORKFLOW_STAGES = [
  { stage: "assignment", label: "Assignment Brief" },
  { stage: "research_plan", label: "Research Plan" },
  { stage: "sources", label: "Source Collection" },
  { stage: "claims", label: "Claim Ledger" },
  { stage: "outline", label: "Outline" },
  { stage: "drafting", label: "Drafting" },
  { stage: "editing", label: "Editing" },
  { stage: "quality", label: "Quality Review" },
  { stage: "export", label: "Export" },
];

// Fields that may be PATCHED by the client
const PROJECT_PATCH_ALLOWED = new Set([
  "title", "topic", "contentType", "purpose", "intendedAudience", "audienceKnowledgeLevel",
  "desiredReaderOutcome", "geographicFocus", "targetLength", "tone", "readingLevel",
  "pointOfView", "researchFreshness", "citationRequirement", "requiredSections",
  "subjectsToAvoid", "wordsToAvoid", "additionalInstructions", "status",
  // NOTE: workflowStage is intentionally excluded; it is controlled by dedicated workflow actions.
]);

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  }
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

router.get("/projects", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const brandId = req.query.brandId as string | undefined;
  const status = req.query.status as string | undefined;

  let rows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(projectsTable.updatedAt);

  if (brandId) rows = rows.filter((p) => p.brandId === brandId);
  if (status) rows = rows.filter((p) => p.status === status);

  const brands = await db.select().from(brandsTable).where(eq(brandsTable.userId, userId));
  const brandMap = Object.fromEntries(brands.map((b) => [b.id, b.name]));

  res.json(rows.reverse().map((p) => ({ ...p, brandName: brandMap[p.brandId] ?? null })));
});

router.post("/projects", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const body = req.body;
  if (!body.brandId || !body.title || !body.contentType) {
    res.status(400).json({ error: "brandId, title, contentType are required" });
    return;
  }
  // Verify the brand belongs to the user
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
  // Audit write is best-effort: never fail the create because logging failed
  await db.insert(activityLogTable).values({
    id: randomUUID(),
    type: "project_created",
    description: `Project "${project.title}" created`,
    userId: req.session.userId!,
    projectId: project.id,
    projectTitle: project.title,
    brandName: brand.name,
  }).catch((e: unknown) => req.log?.warn({ err: e }, "activity log failed"));
  await emitEvent({
    type: "project.created", userId, brandId: project.brandId, projectId: project.id,
    data: { projectId: project.id, title: project.title, contentType: project.contentType, brandId: project.brandId },
  });
  res.status(201).json({ ...project, brandName: brand.name });
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);
  res.json({ ...project, brandName: brand?.name ?? null });
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const update = pickAllowed(req.body, PROJECT_PATCH_ALLOWED);
  if ((update as any).__error) { res.status(400).json({ error: (update as any).__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(projectsTable).set(update).where(eq(projectsTable.id, id)).returning();
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, updated.brandId)).limit(1);
  if (update.status && update.status !== project.status) {
    await db.insert(activityLogTable).values({
      id: randomUUID(),
      type: "project_status_changed",
      description: `Project "${updated.title}" status: ${project.status} → ${update.status}`,
      userId: req.session.userId!,
      projectId: updated.id,
      projectTitle: updated.title,
      brandName: brand?.name,
    }).catch((e: unknown) => req.log?.warn({ err: e }, "activity log failed"));
  }
  res.json({ ...updated, brandName: brand?.name ?? null });
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.sendStatus(204);
});

router.get("/projects/:id/workflow-status", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const currentIdx = WORKFLOW_STAGES.findIndex((s) => s.stage === project.workflowStage);
  const stages = WORKFLOW_STAGES.map((s, i) => ({
    stage: s.stage,
    label: s.label,
    status: i < currentIdx ? "completed" : i === currentIdx ? "active" : "pending",
    completedAt: i < currentIdx ? project.updatedAt?.toISOString() : null,
  }));

  res.json({
    projectId: id,
    currentStage: project.workflowStage,
    stages,
    isBlocked: false,
    blockingReason: null,
  });
});

router.get("/projects/:id/generation-runs", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const runs = await db.select().from(generationRunsTable).where(eq(generationRunsTable.projectId, id));
  res.json(runs.reverse());
});

export default router;
