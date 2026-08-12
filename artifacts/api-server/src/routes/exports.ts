import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { exportsTable, documentsTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { exportDocument, getExportDir } from "../lib/exporters";
import { createReadStream, existsSync } from "fs";
import { join, resolve } from "path";
import { getProjectOwned, getExportOwned } from "../middleware/ownershipHelpers";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

const EXPORT_FORMATS = new Set(["txt", "md", "markdown", "docx", "pdf", "html"]);

router.get("/projects/:id/exports", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const exports = await db.select().from(exportsTable).where(eq(exportsTable.projectId, id));
  res.json(exports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

router.post("/projects/:id/exports", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;

  const { format } = req.body;
  if (!format) { res.status(400).json({ error: "format is required" }); return; }
  if (typeof format !== "string" || !EXPORT_FORMATS.has(format.toLowerCase())) {
    res.status(400).json({ error: `Unsupported format. Allowed: ${[...EXPORT_FORMATS].join(", ")}` });
    return;
  }

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, id));
  if (!docs[0]) { res.status(400).json({ error: "No document found for this project" }); return; }

  const [exportRecord] = await db.insert(exportsTable).values({
    id: randomUUID(),
    projectId: id,
    documentId: docs[0].id,
    format,
    status: "processing",
  }).returning();

  // Detached background export job — fully guarded so no rejection escapes
  const userId = req.session.userId!;
  void (async () => {
    try {
      const result = await exportDocument(id, format);
      await db.update(exportsTable).set({
        status: "completed",
        fileUrl: result.fileUrl,
        fileSizeBytes: result.fileSizeBytes,
        validationPassed: result.validationPassed,
        validationNotes: result.validationNotes,
      }).where(eq(exportsTable.id, exportRecord.id));
      await logActivity("content_exported", `Project "${project.title}" exported as ${format.toUpperCase()}`, {
        userId, projectId: id, projectTitle: project.title,
      }).catch(() => {});
    } catch (err) {
      req.log?.error({ err, exportId: exportRecord.id }, "Export generation failed");
      await db.update(exportsTable).set({
        status: "failed",
        errorMessage: (err as Error).message,
      }).where(eq(exportsTable.id, exportRecord.id))
        .catch((e: unknown) => req.log?.error({ err: e }, "Failed to record export failure"));
    }
  })();

  res.status(201).json(exportRecord);
});

router.get("/exports/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const exp = await getExportOwned(id, req.session.userId!, res);
  if (!exp) return;
  res.json(exp);
});

/**
 * GET /api/exports/download/:filename
 *
 * Security requirements:
 * - requireAuth is already applied at the router level
 * - Validate ownership: export → project → authenticated user
 * - Prevent path traversal: reject any filename containing path separators or ".."
 * - Look up the export record by filename to verify ownership before streaming
 */
router.get("/exports/download/:filename", async (req, res): Promise<void> => {
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;

  // Reject path traversal and directory separators immediately
  if (!filename || /[/\\]/.test(filename) || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  // Strip any chars that are not alphanumeric, dash, underscore, or dot
  const safe = filename.replace(/[^a-zA-Z0-9_.\-]/g, "");
  if (!safe || safe !== filename) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  // Resolve the absolute path and confirm it stays within the export directory
  const exportDir = getExportDir();
  const filePath = resolve(join(exportDir, safe));
  if (!filePath.startsWith(resolve(exportDir) + "/") && filePath !== resolve(exportDir)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  // Look up export record by fileUrl to validate ownership
  // fileUrl format: /api/exports/download/<filename>
  const expectedUrl = `/api/exports/download/${safe}`;
  const [exp] = await db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.fileUrl, expectedUrl))
    .limit(1);

  if (!exp) { res.status(404).json({ error: "Not found" }); return; }

  // Verify ownership: export → project → authenticated user
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, exp.projectId))
    .limit(1);

  if (!project || project.userId !== req.session.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }

  const ext = safe.split(".").pop() ?? "txt";
  const mimeTypes: Record<string, string> = {
    html: "text/html",
    md: "text/markdown",
    txt: "text/plain",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
  };
  res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  createReadStream(filePath).pipe(res as any);
});

export default router;
