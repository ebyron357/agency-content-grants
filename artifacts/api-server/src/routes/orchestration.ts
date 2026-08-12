import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  researchPlansTable,
  outlinesTable,
  outlineSectionsTable,
  documentsTable,
  documentSectionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  generateResearchPlan,
  generateOutline,
} from "../lib/workflows/content-workflow";
import { getProjectOwned } from "../middleware/ownershipHelpers";
import { emitEvent } from "../lib/webhooks/events";

const router: IRouter = Router();

const STAGE_LABELS: Record<string, string> = {
  research: "Preparing your project",
  outlining: "Building the outline",
  document: "Getting ready to write",
  unknown: "Processing",
};

router.post("/projects/:id/generate-brief", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const completedStages = ["drafting", "editing", "quality", "export", "complete"];
  if (completedStages.includes(project.workflowStage ?? "")) {
    const existingDocs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
    const sections = existingDocs[0]
      ? await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, existingDocs[0].id))
      : [];
    res.json({
      projectId: id,
      workflowStage: project.workflowStage,
      alreadyCompleted: true,
      document: existingDocs[0] ?? null,
      sections: sections.sort((a, b) => a.sortOrder - b.sortOrder),
    });
    return;
  }

  let failedStage: string | null = null;

  try {
    const [existingPlan] = await db.select().from(researchPlansTable).where(eq(researchPlansTable.projectId, id)).limit(1);
    if (!existingPlan || existingPlan.status !== "approved") {
      failedStage = "research";
      await generateResearchPlan(id);
      const [plan] = await db.select().from(researchPlansTable).where(eq(researchPlansTable.projectId, id)).limit(1);
      if (plan) {
        await db.update(researchPlansTable).set({ status: "approved" }).where(eq(researchPlansTable.id, plan.id));
      }
    }

    await db.update(projectsTable).set({ workflowStage: "outline" }).where(eq(projectsTable.id, id));
    if (project.userId) {
      await emitEvent({
        type: "project.workflow_stage_changed", userId: project.userId, brandId: project.brandId, projectId: id,
        data: { projectId: id, projectTitle: project.title, fromStage: project.workflowStage, toStage: "outline" },
      });
    }

    const [existingOutline] = await db.select().from(outlinesTable).where(eq(outlinesTable.projectId, id)).limit(1);
    if (!existingOutline || existingOutline.status !== "approved") {
      failedStage = "outline";
      await generateOutline(id);
      const [outline] = await db.select().from(outlinesTable).where(eq(outlinesTable.projectId, id)).limit(1);
      if (outline) {
        await db.update(outlinesTable).set({ status: "approved" }).where(eq(outlinesTable.id, outline.id));
      }
    }

    failedStage = "document";
    const existingDocs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
    let docId: string;

    if (!existingDocs[0]) {
      const [doc] = await db.insert(documentsTable).values({
        id: randomUUID(),
        projectId: id,
        title: project.title,
        status: "draft",
        wordCount: 0,
        isPublicationReady: false,
      }).returning();
      docId = doc.id;

      const [outline] = await db.select().from(outlinesTable).where(eq(outlinesTable.projectId, id)).limit(1);
      if (outline) {
        const outlineSections = await db.select().from(outlineSectionsTable).where(eq(outlineSectionsTable.outlineId, outline.id));
        const sorted = outlineSections.sort((a, b) => a.sortOrder - b.sortOrder);
        if (sorted.length > 0) {
          await db.insert(documentSectionsTable).values(
            sorted.map((os, i) => ({
              id: randomUUID(),
              documentId: docId,
              outlineSectionId: os.id,
              title: os.title,
              sortOrder: i,
              status: "pending",
              isLocked: false,
              isApproved: false,
              revisionCount: 0,
            }))
          );
        }
      }
    } else {
      docId = existingDocs[0].id;
    }

    await db.update(projectsTable).set({ workflowStage: "drafting" }).where(eq(projectsTable.id, id));
    if (project.userId) {
      await emitEvent({
        type: "project.workflow_stage_changed", userId: project.userId, brandId: project.brandId, projectId: id,
        data: { projectId: id, projectTitle: project.title, fromStage: "outline", toStage: "drafting" },
      });
    }

    const [finalDoc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
    const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, docId));

    res.json({
      projectId: id,
      workflowStage: "drafting",
      alreadyCompleted: false,
      document: finalDoc,
      sections: sections.sort((a, b) => a.sortOrder - b.sortOrder),
    });
  } catch (err) {
    req.log.error({ err, failedStage }, "generate-brief failed");
    res.status(500).json({
      error: (err as Error).message,
      failedStage,
      stageLabel: failedStage ? STAGE_LABELS[failedStage] ?? failedStage : STAGE_LABELS.unknown,
    });
  }
});

export default router;
