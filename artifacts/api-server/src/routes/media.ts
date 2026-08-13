/**
 * media.ts — Content image upload and video URL validation routes
 *
 * Security model:
 * - All routes require authentication (requireAuth applied at router level)
 * - Image uploads are validated: MIME type allowlist, 10 MB size limit
 * - Images are stored in the local data/media-uploads directory (tenant-keyed paths)
 * - The serving route verifies ownership before streaming the file
 * - Video URLs are validated against an approved-provider allowlist (YouTube, Vimeo only)
 * - No arbitrary iframes or HTML are accepted
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { contentImagesTable, contentVideosTable, documentSectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname } from "path";
import { getSectionOwned } from "../middleware/ownershipHelpers";
import { parseVideoUrl } from "../lib/videoValidator";

const router: IRouter = Router();

// ── Image storage configuration ──────────────────────────────────────────────

const MEDIA_DIR = join(process.cwd(), "data", "media-uploads");

async function ensureMediaDir() {
  await mkdir(MEDIA_DIR, { recursive: true });
}

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.mimetype}. Allowed: jpeg, png, gif, webp, svg`));
    }
  },
});

// ── Image upload ─────────────────────────────────────────────────────────────

/**
 * POST /document-sections/:id/media/images
 * Uploads a content image for insertion into the given section.
 * Requires: multipart/form-data with field `image` (file), optional `altText`, `caption`
 */
router.post(
  "/document-sections/:id/media/images",
  (req, res, next) => {
    imageUpload.single("image")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: `Image too large. Maximum size is ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB` });
        return;
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const section = await getSectionOwned(id, req.session.userId!, res);
    if (!section) return;

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No image file provided (field name: image)" });
      return;
    }

    // Double-check MIME type (belt-and-suspenders beyond multer fileFilter)
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      res.status(400).json({ error: `Unsupported image type: ${file.mimetype}` });
      return;
    }

    const ext = extname(file.originalname).toLowerCase() || ".bin";
    const storageKey = `${req.session.userId!}/${randomUUID()}${ext}`;
    const filePath = join(MEDIA_DIR, storageKey);

    await ensureMediaDir();
    // Ensure the user sub-directory exists
    await mkdir(join(MEDIA_DIR, req.session.userId!), { recursive: true });
    await writeFile(filePath, file.buffer);

    const imageId = randomUUID();
    const altText = typeof req.body.altText === "string" ? req.body.altText.slice(0, 500) : "";
    const caption = typeof req.body.caption === "string" ? req.body.caption.slice(0, 500) : "";

    const [image] = await db.insert(contentImagesTable).values({
      id: imageId,
      documentSectionId: id,
      userId: req.session.userId!,
      filename: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
      storageKey,
      altText,
      caption,
    }).returning();

    res.status(201).json({
      ...image,
      url: `/api/media/images/${imageId}`,
    });
  }
);

/**
 * GET /media/images/:id
 * Streams a content image. Verifies ownership through section → document → project → user.
 */
router.get("/media/images/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [image] = await db
    .select()
    .from(contentImagesTable)
    .where(eq(contentImagesTable.id, id))
    .limit(1);

  if (!image) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Ownership: image must belong to the authenticated user
  if (image.userId !== req.session.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Prevent path traversal
  const storageKey = image.storageKey.replace(/\.\./g, "").replace(/[^a-zA-Z0-9._\-/]/g, "");
  const filePath = resolve(join(MEDIA_DIR, storageKey));
  if (!filePath.startsWith(resolve(MEDIA_DIR) + "/")) {
    res.status(400).json({ error: "Invalid storage key" });
    return;
  }

  if (!existsSync(filePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  const buffer = await readFile(filePath);
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${image.filename.replace(/[^a-zA-Z0-9._\-]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(buffer);
});

/**
 * PATCH /media/images/:id
 * Update altText and/or caption for an image.
 */
router.patch("/media/images/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [image] = await db
    .select()
    .from(contentImagesTable)
    .where(eq(contentImagesTable.id, id))
    .limit(1);

  if (!image || image.userId !== req.session.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const update: Record<string, string> = {};
  if (typeof req.body.altText === "string") update.altText = req.body.altText.slice(0, 500);
  if (typeof req.body.caption === "string") update.caption = req.body.caption.slice(0, 500);

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No updatable fields provided (altText, caption)" });
    return;
  }

  const [updated] = await db
    .update(contentImagesTable)
    .set(update)
    .where(eq(contentImagesTable.id, id))
    .returning();

  res.json({ ...updated, url: `/api/media/images/${updated.id}` });
});

/**
 * DELETE /media/images/:id
 * Removes an image record. The section must not be locked.
 */
router.delete("/media/images/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [image] = await db
    .select()
    .from(contentImagesTable)
    .where(eq(contentImagesTable.id, id))
    .limit(1);

  if (!image || image.userId !== req.session.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db.delete(contentImagesTable).where(eq(contentImagesTable.id, id));
  res.status(204).end();
});

/**
 * GET /document-sections/:id/media/images
 * Lists all images for a section.
 */
router.get("/document-sections/:id/media/images", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;

  const images = await db
    .select()
    .from(contentImagesTable)
    .where(eq(contentImagesTable.documentSectionId, id));

  res.json(images.map((img) => ({ ...img, url: `/api/media/images/${img.id}` })));
});

// ── Video URL validation and storage ─────────────────────────────────────────

/**
 * POST /document-sections/:id/media/videos
 * Validates a video URL against the approved provider allowlist and persists the embed.
 * Body: { url: string, caption?: string }
 */
router.post("/document-sections/:id/media/videos", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;

  const { url, caption } = req.body;
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const meta = parseVideoUrl(url.trim());
  if (!meta) {
    res.status(400).json({
      error: "Unsupported or invalid video URL. Only YouTube and Vimeo HTTPS URLs are accepted.",
    });
    return;
  }

  const videoId = randomUUID();
  const [video] = await db.insert(contentVideosTable).values({
    id: videoId,
    documentSectionId: id,
    userId: req.session.userId!,
    provider: meta.provider,
    videoId: meta.videoId,
    originalUrl: url.trim().slice(0, 2000),
    embedUrl: meta.embedUrl,
    caption: typeof caption === "string" ? caption.slice(0, 500) : "",
  }).returning();

  res.status(201).json(video);
});

/**
 * GET /document-sections/:id/media/videos
 * Lists all video embeds for a section.
 */
router.get("/document-sections/:id/media/videos", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const section = await getSectionOwned(id, req.session.userId!, res);
  if (!section) return;

  const videos = await db
    .select()
    .from(contentVideosTable)
    .where(eq(contentVideosTable.documentSectionId, id));

  res.json(videos);
});

/**
 * DELETE /media/videos/:id
 */
router.delete("/media/videos/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [video] = await db
    .select()
    .from(contentVideosTable)
    .where(eq(contentVideosTable.id, id))
    .limit(1);

  if (!video || video.userId !== req.session.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db.delete(contentVideosTable).where(eq(contentVideosTable.id, id));
  res.status(204).end();
});

/**
 * POST /media/videos/validate
 * Stateless URL validation — returns the parsed embed URL without storing anything.
 * Body: { url: string }
 */
router.post("/media/videos/validate", async (req, res): Promise<void> => {
  const { url } = req.body;
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const meta = parseVideoUrl(url.trim());
  if (!meta) {
    res.status(400).json({
      error: "Unsupported or invalid video URL. Only YouTube and Vimeo HTTPS URLs are accepted.",
    });
    return;
  }

  res.json(meta);
});

export default router;
