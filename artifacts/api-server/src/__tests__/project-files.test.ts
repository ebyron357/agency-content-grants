/**
 * Project deletion removes the project's files from durable storage, but only
 * paths that resolve inside their storage roots. Deterministic, no DB.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));

let projectFilePaths: typeof import("../lib/projectFiles").projectFilePaths;

beforeAll(async () => {
  process.env.UPLOAD_DIR = "/data/uploads/images";
  process.env.SOURCE_UPLOAD_DIR = "/data/uploads/sources";
  process.env.EXPORT_DIR = "/data/exports";
  ({ projectFilePaths } = await import("../lib/projectFiles"));
});

describe("projectFilePaths", () => {
  it("collects images, source PDFs and export files inside their roots", () => {
    expect(
      projectFilePaths({
        imageKeys: ["a.png"],
        sourceKeys: ["b.pdf", null],
        exportUrls: ["/api/exports/download/guide_1.docx", null],
      }),
    ).toEqual([
      "/data/uploads/images/a.png",
      "/data/uploads/sources/b.pdf",
      "/data/exports/guide_1.docx",
    ]);
  });

  it("never returns paths that escape a storage root or are not export downloads", () => {
    expect(
      projectFilePaths({
        imageKeys: ["../../etc/passwd", "/etc/shadow"],
        sourceKeys: ["../secrets.pdf", "/objects/legacy-replit-key"],
        exportUrls: ["https://example.com/x.pdf", "/api/media/images/1", "/api/exports/download/.."],
      }),
    ).toEqual([]);
  });
});
