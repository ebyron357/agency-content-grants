import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
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

// ── Image upload for document content ──────────────────────────────────────
// Security: SVG is rejected (XSS vector); MIME is validated against magic bytes;
// extension is derived from validated content type, not user-supplied filename.
const ALLOWED_IMAGE_TYPES = new Map<string, { magicBytes: number[][]; ext: string }>([
  ["image/jpeg", { magicBytes: [[0xFF, 0xD8, 0xFF]], ext: "jpg" }],
  ["image/png", { magicBytes: [[0x89, 0x50, 0x4E, 0x47]], ext: "png" }],
  ["image/gif", { magicBytes: [[0x47, 0x49, 0x46, 0x38]], ext: "gif" }],
  ["image/webp", { magicBytes: [[0x52, 0x49, 0x46, 0x46]], ext: "webp" }], // RIFF header
]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

function validateImageMagicBytes(buffer: Buffer, declaredType: string): boolean {
  const spec = ALLOWED_IMAGE_TYPES.get(declaredType);
  if (!spec) return false;
  return spec.magicBytes.some(magic =>
    magic.every((byte, i) => buffer[i] === byte)
  );
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.mimetype}. Allowed: ${[...ALLOWED_IMAGE_TYPES.keys()].join(", ")}`));
    }
  },
}).single("image");

// Resolve upload directory relative to the working directory
const uploadDir = process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads", "images");

router.post("/projects/:id/images/upload", (req, res, next) => {
  imageUpload(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }

  // Validate magic bytes to prevent MIME spoofing
  if (!validateImageMagicBytes(file.buffer, file.mimetype)) {
    res.status(400).json({ error: "File content does not match declared image type" });
    return;
  }

  try {
    // Derive extension from validated content type, not user-supplied filename
    const spec = ALLOWED_IMAGE_TYPES.get(file.mimetype);
    const ext = spec?.ext ?? "bin";
    const filename = `${randomUUID()}.${ext}`;
    const projectDir = path.join(uploadDir, id);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, filename), file.buffer);

    const imageUrl = `/api/projects/${id}/images/${filename}`;
    const altText = req.body?.altText ?? file.originalname.replace(/\.[^.]+$/, "");
    const caption = req.body?.caption ?? "";

    res.status(201).json({
      url: imageUrl,
      filename,
      altText,
      caption,
      size: file.size,
      contentType: file.mimetype,
    });
  } catch (err) {
    req.log.error({ err }, "Image upload failed");
    res.status(500).json({ error: "Image upload failed" });
  }
});

// Serve uploaded images (ownership-verified)
router.get("/projects/:id/images/:filename", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;

  // Verify project ownership
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  // Validate filename to prevent path traversal
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.join(uploadDir, id, filename);
  // Set Content-Type based on extension and prevent HTML interpretation
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).json({ error: "Image not found" });
    }
  });
});

export default router;
