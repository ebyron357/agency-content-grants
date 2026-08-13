import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  documentsTable,
  documentSectionsTable,
  sectionRevisionsTable,
  outlinesTable,
  outlineSectionsTable,
  projectsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { draftSection, editSection } from "../lib/workflows/content-workflow";
import { getProjectOwned, getSectionOwned } from "../middleware/ownershipHelpers";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

// Only these fields may be PATCHed on a document section
const SECTION_PATCH_ALLOWED = new Set(["title", "content", "notes", "contentFormat"]);

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

async function getDocumentWithSections(documentId: string) {
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
  if (!doc) return null;
  const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, documentId));
  return { ...doc, sections: sections.sort((a, b) => a.sortOrder - b.sortOrder) };
}

router.get("/projects/:id/document", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
  if (!docs[0]) { res.status(404).json({ error: "No document found" }); return; }
  const result = await getDocumentWithSections(docs[0].id);
  res.json(result);
});

router.post("/projects/:id/document", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const existing = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
  if (existing[0]) {
    const result = await getDocumentWithSections(existing[0].id);
    res.status(201).json(result);
    return;
  }

  const [doc] = await db.insert(documentsTable).values({
    id: randomUUID(),
    projectId: id,
    title: project.title,
    status: "draft",
    wordCount: 0,
    isPublicationReady: false,
  }).returning();

  const [outline] = await db.select().from(outlinesTable).where(eq(outlinesTable.projectId, id)).limit(1);
  if (outline) {
    const outlineSections = await db.select().from(outlineSectionsTable).where(eq(outlineSectionsTable.outlineId, outline.id));
    const sorted = outlineSections.sort((a, b) => a.sortOrder - b.sortOrder);
    if (sorted.length > 0) {
      await db.insert(documentSectionsTable).values(
        sorted.map((os, i) => ({
          id: randomUUID(),
          documentId: doc.id,
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

  await db.update(projectsTable).set({ workflowStage: "drafting" }).where(eq(projectsTable.id, id));
  const result = await getDocumentWithSections(doc.id);
  res.status(201).json(result);
});

router.get("/document-sections/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  res.json(section);
});

router.patch("/document-sections/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;

  if (section.isLocked && req.body.content) {
    res.status(400).json({ error: "Section is locked. Unlock it before editing." });
    return;
  }

  const allowed = pickAllowed(req.body, SECTION_PATCH_ALLOWED);
  if ((allowed as any).__error) { res.status(400).json({ error: (allowed as any).__error }); return; }
  if (Object.keys(allowed).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

  const update: Record<string, any> = { ...allowed };
  if (typeof (allowed as any).content === "string") {
    const rawContent = (allowed as any).content;
    const fmt = (allowed as any).contentFormat ?? section.contentFormat ?? "plain";
    const textForCount = fmt === "html" ? stripHtml(rawContent) : rawContent;
    update.wordCount = textForCount.trim() ? textForCount.trim().split(/\s+/).length : 0;
  }
  const [updated] = await db.update(documentSectionsTable).set(update).where(eq(documentSectionsTable.id, id)).returning();
  res.json(updated);
});

router.post("/document-sections/:id/draft", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  try {
    const updated = await draftSection(id);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Draft failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/document-sections/:id/edit", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  const { editType, instructions } = req.body;
  if (!editType) { res.status(400).json({ error: "editType is required" }); return; }
  try {
    const updated = await editSection(id, editType, instructions);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Edit failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/document-sections/:id/lock", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  const [updated] = await db.update(documentSectionsTable).set({ isLocked: true }).where(eq(documentSectionsTable.id, id)).returning();
  res.json(updated);
});

router.post("/document-sections/:id/unlock", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  const [updated] = await db.update(documentSectionsTable).set({ isLocked: false }).where(eq(documentSectionsTable.id, id)).returning();
  res.json(updated);
});

router.post("/document-sections/:id/approve", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  const [updated] = await db.update(documentSectionsTable).set({ isApproved: true, status: "approved" }).where(eq(documentSectionsTable.id, id)).returning();
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, section.documentId)).limit(1);
  const [proj] = doc ? await db.select().from(projectsTable).where(eq(projectsTable.id, doc.projectId)).limit(1) : [];
  logActivity("content_approved", `Section "${section.title}" approved${proj ? ` in "${proj.title}"` : ""}`, {
    userId: req.session.userId!, projectId: doc?.projectId, projectTitle: proj?.title,
  }).catch(() => {});
  res.json(updated);
});

router.get("/document-sections/:id/revisions", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  const revisions = await db.select().from(sectionRevisionsTable).where(eq(sectionRevisionsTable.documentSectionId, id));
  res.json(revisions.sort((a, b) => b.revisionNumber - a.revisionNumber));
});

router.post("/document-sections/:id/restore", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;
  const { revisionId } = req.body;
  if (!revisionId) { res.status(400).json({ error: "revisionId required" }); return; }
  const [revision] = await db.select().from(sectionRevisionsTable).where(eq(sectionRevisionsTable.id, revisionId)).limit(1);
  if (!revision) { res.status(404).json({ error: "Revision not found" }); return; }
  const [updated] = await db.update(documentSectionsTable).set({
    content: revision.content,
    wordCount: revision.content.split(/\s+/).length,
    revisionCount: section.revisionCount + 1,
  }).where(eq(documentSectionsTable.id, id)).returning();
  res.json(updated);
});

export default router;
