import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  qualityEvaluationsTable,
  qualityIssuesTable,
  documentsTable,
  documentSectionsTable,
  sourcesTable,
  claimsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { runQualityEvaluation } from "../lib/workflows/content-workflow";
import { getProjectOwned, getQualityEvalOwned } from "../middleware/ownershipHelpers";

const router: IRouter = Router();

async function getEvaluationWithIssues(evaluationId: string) {
  const [evaluation] = await db.select().from(qualityEvaluationsTable).where(eq(qualityEvaluationsTable.id, evaluationId)).limit(1);
  if (!evaluation) return null;
  const issues = await db.select().from(qualityIssuesTable).where(eq(qualityIssuesTable.evaluationId, evaluationId));
  return { ...evaluation, issues };
}

router.get("/projects/:id/quality", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const evaluations = await db.select().from(qualityEvaluationsTable)
    .where(eq(qualityEvaluationsTable.projectId, id))
    .orderBy(desc(qualityEvaluationsTable.createdAt))
    .limit(1);
  if (!evaluations[0]) { res.status(404).json({ error: "No quality evaluation found" }); return; }
  const result = await getEvaluationWithIssues(evaluations[0].id);
  res.json(result);
});

router.post("/projects/:id/quality", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  try {
    const evaluation = await runQualityEvaluation(id);
    const result = await getEvaluationWithIssues(evaluation.id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Quality evaluation failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/quality-evaluations/:id/issues/:issueId/fix", async (req, res): Promise<void> => {
  const issueId = Array.isArray(req.params.issueId) ? req.params.issueId[0] : req.params.issueId;
  const evalId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  // Verify ownership through evaluation → project
  const evaluation = await getQualityEvalOwned(evalId, req.session.userId!, res);
  if (!evaluation) return;
  const [issue] = await db.update(qualityIssuesTable).set({ status: "fixed" }).where(eq(qualityIssuesTable.id, issueId)).returning();
  if (!issue) { res.status(404).json({ error: "Issue not found" }); return; }
  res.json(issue);
});

router.get("/projects/:id/publication-readiness", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
  const document = docs[0];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const completedChecks: string[] = [];

  if (!document) {
    blockers.push("No document created yet");
  } else {
    const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, document.id));
    const sources = await db.select().from(sourcesTable).where(eq(sourcesTable.projectId, id));
    const claims = await db.select().from(claimsTable).where(eq(claimsTable.projectId, id));

    const withoutContent = sections.filter((s) => !s.content);
    if (withoutContent.length > 0) blockers.push(`${withoutContent.length} section(s) have no content`);
    else completedChecks.push("All sections have content");

    const unsupportedClaims = claims.filter((c) => c.verificationStatus === "unsupported");
    if (unsupportedClaims.length > 0) blockers.push(`${unsupportedClaims.length} unsupported claim(s) in document`);
    else completedChecks.push("No unsupported claims");

    if (sources.filter((s) => s.status === "approved").length === 0) warnings.push("No approved sources");
    else completedChecks.push("At least one approved source");

    if (!document.isPublicationReady) warnings.push("Quality evaluation has not passed");
    else completedChecks.push("Quality evaluation passed");
  }

  res.json({ projectId: id, isReady: blockers.length === 0, blockers, warnings, completedChecks });
});

export default router;
