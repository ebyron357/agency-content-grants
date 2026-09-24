import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sourcesTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import multer from "multer";
import { createRequire } from "module";
import {
  deleteSourcePdf,
  readSourcePdf,
  storeSourcePdf,
} from "../lib/sourceStorage";
import {
  getProjectOwned,
  getSourceOwned,
} from "../middleware/ownershipHelpers";
import { logActivity } from "../lib/activity";
import {
  assertValidWebhookUrl,
  safeHttpRequest,
  UnsafeWebhookUrlError,
} from "../lib/webhooks/urlSafety";

const _require = createRequire(import.meta.url);
const pdfParseModule = _require("pdf-parse");
const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> =
  pdfParseModule.default ?? pdfParseModule;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router: IRouter = Router();

// Allowed fields for source PATCH (must match actual schema columns)
const SOURCE_PATCH_ALLOWED = new Set([
  "title",
  "url",
  "publisher",
  "author",
  "publicationDate",
  "retrievalDate",
  "sourceType",
  "relevantExcerpts",
  "authorityScore",
  "freshnessScore",
  "isPrimarySource",
  // status intentionally excluded — use /approve and /reject
]);

function pickAllowed(body: Record<string, unknown>, allowed: Set<string>): any {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0)
    return { __error: `Unknown or forbidden field(s): ${unknown.join(", ")}` };
  return Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.has(k)),
  );
}

router.get("/projects/:id/sources", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  const sources = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.projectId, id));
  res.json(
    sources.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  );
});

router.post("/projects/:id/sources", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const project = await getProjectOwned(id, req.session.userId!, res);
  if (!project) return;
  if (!req.body.title || !req.body.sourceType) {
    res.status(400).json({ error: "title and sourceType are required" });
    return;
  }
  const sourceInput = pickAllowed(
    req.body,
    new Set([
      "title",
      "url",
      "publisher",
      "author",
      "publicationDate",
      "relevantExcerpts",
      "authorityScore",
      "freshnessScore",
      "isPrimarySource",
      "sourceType",
    ]),
  );
  if (sourceInput.__error) {
    res.status(400).json({ error: sourceInput.__error });
    return;
  }
  if (sourceInput.url) {
    try {
      await assertValidWebhookUrl(String(sourceInput.url));
    } catch (error) {
      const message =
        error instanceof UnsafeWebhookUrlError
          ? error.message
          : "Source URL could not be validated";
      res.status(400).json({ error: message });
      return;
    }
  }
  const [source] = await db
    .insert(sourcesTable)
    .values({
      id: randomUUID(),
      projectId: id,
      retrievalDate: new Date().toISOString().split("T")[0],
      ...sourceInput,
    })
    .returning();
  await logActivity(
    "source_added",
    `Source "${source.title}" added to "${project.title}"`,
    {
      userId: req.session.userId!,
      projectId: id,
      projectTitle: project.title,
    },
  ).catch(() => {});
  res.status(201).json(source);
});

router.get("/sources/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  res.json(source);
});

router.patch("/sources/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;

  const update = pickAllowed(req.body, SOURCE_PATCH_ALLOWED);
  if ((update as any).__error) {
    res.status(400).json({ error: (update as any).__error });
    return;
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }

  const [updated] = await db
    .update(sourcesTable)
    .set(update)
    .where(eq(sourcesTable.id, id))
    .returning();
  res.json(updated);
});

router.delete("/sources/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  await db.delete(sourcesTable).where(eq(sourcesTable.id, id));
  if (source.fileObjectPath) {
    await deleteSourcePdf(source.fileObjectPath).catch((error) => {
      req.log.warn({ err: error, sourceId: id }, "Source file cleanup failed");
    });
  }
  res.sendStatus(204);
});

router.post("/sources/:id/approve", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  const [updated] = await db
    .update(sourcesTable)
    .set({ status: "approved" })
    .where(eq(sourcesTable.id, id))
    .returning();
  await logActivity("source_approved", `Source "${source.title}" approved`, {
    userId: req.session.userId!,
    projectId: source.projectId,
  }).catch(() => {});
  res.json(updated);
});

router.post("/sources/:id/reject", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  const [updated] = await db
    .update(sourcesTable)
    .set({ status: "rejected" })
    .where(eq(sourcesTable.id, id))
    .returning();
  await logActivity("source_rejected", `Source "${source.title}" rejected`, {
    userId: req.session.userId!,
    projectId: source.projectId,
  }).catch(() => {});
  res.json(updated);
});

router.post("/sources/:id/fetch", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  if (!source.url) {
    res.status(400).json({ error: "Source has no URL to fetch" });
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await safeHttpRequest(source.url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ContentOS/1.0)" },
      body: "",
      signal: controller.signal,
    });
    if (!response.ok) {
      res.status(400).json({ error: `Fetch failed: ${response.status}` });
      return;
    }
    const text = await response.text();
    const cleaned = text
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 10000);
    const [updated] = await db
      .update(sourcesTable)
      .set({ extractedText: cleaned, status: "fetched" })
      .where(eq(sourcesTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    const status = err instanceof UnsafeWebhookUrlError ? 400 : 500;
    res.status(status).json({ error: (err as Error).message });
  } finally {
    clearTimeout(timeout);
  }
});

// Accept the PDF under either field name ("pdf" or "file") for client compatibility
const pdfUpload = upload.fields([
  { name: "pdf", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);

router.post(
  "/projects/:id/sources/upload-pdf",
  pdfUpload,
  async (req, res): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const project = await getProjectOwned(id, req.session.userId!, res);
    if (!project) return;

    const files = req.files as
      Record<string, Express.Multer.File[]> | undefined;
    const file = files?.pdf?.[0] ?? files?.file?.[0];
    if (!file) {
      res.status(400).json({ error: "PDF file required" });
      return;
    }

    let text = "";
    try {
      const parsed = await pdfParse(file.buffer);
      text = parsed.text.slice(0, 10000);
    } catch {
      res.status(400).json({ error: "Failed to parse PDF" });
      return;
    }

    let fileObjectPath: string | undefined;
    try {
      fileObjectPath = await storeSourcePdf(file.buffer);
    } catch (err) {
      req.log?.error({ err }, "PDF storage upload failed");
      res.status(503).json({ error: "Persistent PDF storage is unavailable" });
      return;
    }

    // Optional metadata from the multipart form
    const meta = req.body ?? {};
    const str = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;

    try {
      const [source] = await db
        .insert(sourcesTable)
        .values({
          id: randomUUID(),
          projectId: id,
          title: str(meta.title) ?? file.originalname ?? "Uploaded PDF",
          author: str(meta.author),
          publisher: str(meta.publisher),
          publicationDate: str(meta.publicationDate),
          sourceType: "pdf",
          retrievalDate: new Date().toISOString().split("T")[0],
          extractedText: text,
          status: "pending",
          ...(fileObjectPath ? { fileObjectPath } : {}),
        })
        .returning();

      await logActivity(
        "source_uploaded",
        `PDF "${source.title}" uploaded to "${project.title}"`,
        {
          userId: req.session.userId!,
          projectId: id,
          projectTitle: project.title,
        },
      ).catch(() => {});
      res.status(201).json(source);
    } catch (err) {
      // The DB insert failed after a successful storage upload — clean up the
      // orphaned object so storage doesn't accumulate unreferenced files.
      if (fileObjectPath) {
        try {
          await deleteSourcePdf(fileObjectPath);
        } catch (cleanupErr) {
          req.log?.error(
            { err: cleanupErr, fileObjectPath },
            "Failed to clean up orphaned storage object",
          );
        }
      }
      req.log?.error({ err }, "PDF source insert failed");
      res.status(500).json({ error: "Failed to save the uploaded PDF source" });
    }
  },
);

/**
 * GET /sources/:id/pdf
 * Stream the original stored PDF back to the owner (view/download).
 */
router.get("/sources/:id/pdf", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  if (!source.fileObjectPath) {
    res.status(404).json({ error: "This source has no stored PDF" });
    return;
  }

  try {
    const buffer = await readSourcePdf(source.fileObjectPath);
    const safeName = `${(source.title ?? "source").replace(/[^\w.\- ]+/g, "_").slice(0, 100)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.end(buffer);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "Stored PDF not found" });
      return;
    }
    req.log?.error({ err }, "Failed to stream stored PDF");
    res.status(500).json({ error: "Failed to retrieve the stored PDF" });
  }
});

/**
 * POST /sources/:id/reextract
 * Re-run text extraction on the stored PDF and update the source.
 */
router.post("/sources/:id/reextract", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const source = await getSourceOwned(id, req.session.userId!, res);
  if (!source) return;
  if (!source.fileObjectPath) {
    res
      .status(400)
      .json({ error: "This source has no stored PDF to re-extract" });
    return;
  }

  try {
    const buffer = await readSourcePdf(source.fileObjectPath);
    const parsed = await pdfParse(buffer);
    const [updated] = await db
      .update(sourcesTable)
      .set({ extractedText: parsed.text.slice(0, 10000) })
      .where(eq(sourcesTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "Stored PDF not found" });
      return;
    }
    req.log?.error({ err }, "PDF re-extraction failed");
    res
      .status(500)
      .json({ error: "Failed to re-extract text from the stored PDF" });
  }
});

export default router;
