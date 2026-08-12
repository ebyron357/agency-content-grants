import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { researchPlansTable, researchQuestionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateResearchPlan } from "../lib/workflows/content-workflow";
import { getProjectOwned, getResearchPlanOwned } from "../middleware/ownershipHelpers";

const router: IRouter = Router();

// Only content/context notes may be edited; status controlled by /approve
const PLAN_PATCH_ALLOWED = new Set(["notes", "additionalContext", "scope", "objectives"]);

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

router.get("/projects/:id/research-plan", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const [plan] = await db.select().from(researchPlansTable).where(eq(researchPlansTable.projectId, id)).limit(1);
  if (!plan) { res.status(404).json({ error: "No research plan found" }); return; }
  const questions = await db.select().from(researchQuestionsTable).where(eq(researchQuestionsTable.researchPlanId, plan.id));
  res.json({ ...plan, questions: questions.sort((a, b) => a.priority - b.priority) });
});

router.post("/projects/:id/research-plan", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  try {
    const plan = await generateResearchPlan(id, req.body?.additionalContext);
    const questions = await db.select().from(researchQuestionsTable).where(eq(researchQuestionsTable.researchPlanId, plan.id));
    res.json({ ...plan, questions: questions.sort((a, b) => a.priority - b.priority) });
  } catch (err) {
    req.log.error({ err }, "Research plan generation failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch("/research-plans/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const plan = await getResearchPlanOwned(id, req.session.userId!, res);
  if (!plan) return;

  const update = pickAllowed(req.body, PLAN_PATCH_ALLOWED);
  if ((update as any).__error) { res.status(400).json({ error: (update as any).__error }); return; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const [updated] = await db.update(researchPlansTable).set(update).where(eq(researchPlansTable.id, id)).returning();
  const questions = await db.select().from(researchQuestionsTable).where(eq(researchQuestionsTable.researchPlanId, id));
  res.json({ ...updated, questions });
});

router.post("/research-plans/:id/approve", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const plan = await getResearchPlanOwned(id, req.session.userId!, res);
  if (!plan) return;
  const [updated] = await db.update(researchPlansTable).set({ status: "approved" }).where(eq(researchPlansTable.id, id)).returning();
  const questions = await db.select().from(researchQuestionsTable).where(eq(researchQuestionsTable.researchPlanId, id));
  res.json({ ...updated, questions });
});

export default router;
