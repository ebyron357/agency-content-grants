/**
 * Media-aware export: inline images and video embeds must never disappear
 * silently from DOCX, PDF, Markdown or TXT exports. Deterministic, no DB —
 * the exporter runs end to end against an in-memory fixture and real files
 * in a temporary upload/export directory.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = vi.hoisted(() => ({ rows: new Map<object, unknown[]>() }));

vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ __table: name, projectId: name, documentId: name, id: name });
  const tables = {
    documentsTable: table("documents"),
    documentSectionsTable: table("document_sections"),
    projectsTable: table("projects"),
    brandsTable: table("brands"),
    exportsTable: table("exports"),
    sourcesTable: table("sources"),
    claimsTable: table("claims"),
    contentImagesTable: { ...table("content_images"), documentSectionId: "content_images" },
  };
  const result = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
  const db = {
    select: () => ({
      from: (t: object) => ({ where: () => result(fixture.rows.get(t) ?? []) }),
    }),
  };
  return { db, pool: {}, ...tables };
});

vi.mock("drizzle-orm", () => ({ eq: () => ({}), inArray: () => ({}) }));

// Valid 1x1 PNG; WebP header is enough for the "cannot embed" path.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const WEBP = Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "binary");

const SECTION_HTML =
  '<p>Before the media.</p>' +
  '<img src="/api/media/images/img-png" alt="Pipeline diagram" title="Figure 1">' +
  '<img src="/api/media/images/img-webp" alt="Team photo">' +
  '<div data-video-embed="true"><iframe src="https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ" title="Product demo"></iframe></div>' +
  "<p>After the media.</p>";

let exportDocument: (projectId: string, format: string) => Promise<{
  fileUrl: string;
  validationNotes: string;
  validationPassed: boolean;
}>;
let exportDir: string;

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), "export-media-"));
  const uploadDir = join(base, "images");
  exportDir = join(base, "exports");
  mkdirSync(uploadDir, { recursive: true });
  process.env.UPLOAD_DIR = uploadDir;
  process.env.EXPORT_DIR = exportDir;
  writeFileSync(join(uploadDir, "img-png.png"), PNG);
  writeFileSync(join(uploadDir, "img-webp.webp"), WEBP);

  const db = await import("@workspace/db");
  fixture.rows.set(db.documentsTable, [{ id: "doc-1", projectId: "p-1", title: "Media Guide" }]);
  fixture.rows.set(db.documentSectionsTable, [
    { id: "s-1", documentId: "doc-1", title: "Overview", sortOrder: 0, content: SECTION_HTML, contentFormat: "html" },
  ]);
  fixture.rows.set(db.contentImagesTable, [
    { id: "img-png", documentSectionId: "s-1", storageKey: "img-png.png", mimeType: "image/png" },
    { id: "img-webp", documentSectionId: "s-1", storageKey: "img-webp.webp", mimeType: "image/webp" },
  ]);
  fixture.rows.set(db.projectsTable, [{ id: "p-1", title: "Media Guide", brandId: "b-1", contentType: "guide" }]);
  fixture.rows.set(db.brandsTable, [{ id: "b-1", name: "Fixture Brand" }]);

  ({ exportDocument } = await import("../lib/exporters"));
});

function exported(fileUrl: string): Buffer {
  return readFileSync(join(exportDir, fileUrl.split("/").pop()!));
}

describe("media-aware exports", () => {
  it("DOCX embeds supported images and links videos", async () => {
    const result = await exportDocument("p-1", "docx");
    const file = exported(result.fileUrl);
    expect(file.subarray(0, 2).toString()).toBe("PK");
    expect(file.includes(Buffer.from("word/media/"))).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(result.validationNotes).toContain("1 image(s) embedded");
    expect(result.validationNotes).toContain("1 image(s) exported as labelled placeholders");
    expect(result.validationNotes).toContain("1 video(s) exported as links");
  });

  it("PDF embeds supported images and links videos", async () => {
    const result = await exportDocument("p-1", "pdf");
    const file = exported(result.fileUrl);
    expect(file.subarray(0, 4).toString()).toBe("%PDF");
    expect(file.includes(Buffer.from("/Subtype /Image"))).toBe(true);
    expect(file.includes(Buffer.from("https://www.youtube.com/watch?v=aqz-KE-bpKQ"))).toBe(true);
    expect(result.validationNotes).toContain("1 image(s) embedded");
    expect(result.validationNotes).toContain("1 video(s) exported as links");
  });

  it("Markdown keeps media in order as labelled placeholders and links", async () => {
    const result = await exportDocument("p-1", "markdown");
    const text = exported(result.fileUrl).toString("utf8");
    const order = [
      "Before the media.",
      "*[Image: Pipeline diagram — Figure 1]*",
      "*[Image: Team photo]*",
      "[Video: Product demo](https://www.youtube.com/watch?v=aqz-KE-bpKQ)",
      "After the media.",
    ].map((needle) => text.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(result.validationNotes).toContain("2 image(s) exported as labelled placeholders");
  });

  it("TXT keeps media as labelled placeholders and links", async () => {
    const result = await exportDocument("p-1", "txt");
    const text = exported(result.fileUrl).toString("utf8");
    expect(text).toContain("[Image: Pipeline diagram — Figure 1]");
    expect(text).toContain("[Video: Product demo — https://www.youtube.com/watch?v=aqz-KE-bpKQ]");
  });

  it("HTML still embeds images as data URLs and keeps the player", async () => {
    const result = await exportDocument("p-1", "html");
    const html = exported(result.fileUrl).toString("utf8");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ");
  });
});
