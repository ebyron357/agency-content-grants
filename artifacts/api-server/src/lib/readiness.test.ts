import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
import { checkReadiness } from "./readiness";

describe("readiness", () => {
  it("passes only when every dependency is ready", async () => {
    const result = await checkReadiness({
      database: vi.fn().mockResolvedValue(undefined),
      storage: vi.fn().mockResolvedValue(undefined),
      configuration: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toEqual({
      ready: true,
      checks: { database: "ok", storage: "ok", configuration: "ok" },
    });
  });

  it("fails closed without leaking dependency error details", async () => {
    const result = await checkReadiness({
      database: vi.fn().mockRejectedValue(new Error("postgres secret")),
      storage: vi.fn().mockResolvedValue(undefined),
      configuration: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.ready).toBe(false);
    expect(result.checks.database).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  describe("storage probe", () => {
    const saved = { UPLOAD_DIR: process.env.UPLOAD_DIR, SOURCE_UPLOAD_DIR: process.env.SOURCE_UPLOAD_DIR, EXPORT_DIR: process.env.EXPORT_DIR };
    let root = "";

    afterEach(async () => {
      vi.restoreAllMocks();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (root) await rm(root, { recursive: true, force: true });
    });

    // Render can send two health checks in the same millisecond. The probe
    // file name must not depend on the clock alone, or the second check finds
    // the first one's file and reports storage as failed (seen in production
    // on 4-5 November 2026 as isolated 503s from /api/readyz).
    it("passes for concurrent checks in the same millisecond and leaves no probe files", async () => {
      root = await mkdtemp(join(tmpdir(), "readiness-"));
      process.env.UPLOAD_DIR = join(root, "images");
      process.env.SOURCE_UPLOAD_DIR = join(root, "sources");
      process.env.EXPORT_DIR = join(root, "exports");
      vi.spyOn(Date, "now").mockReturnValue(1_793_834_394_823);

      const results = await Promise.all(Array.from({ length: 8 }, () => checkReadiness()));

      expect(results.map((r) => r.checks.storage)).toEqual(Array(8).fill("ok"));
      for (const dir of ["images", "sources", "exports"]) {
        expect(await readdir(join(root, dir))).toEqual([]);
      }
    });
  });
});
