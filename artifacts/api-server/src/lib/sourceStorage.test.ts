import { afterEach, describe, expect, it } from "vitest";
import { getSourceRoot, resolveSourcePath } from "./sourceStorage";

describe("source storage path safety", () => {
  const previous = process.env.SOURCE_UPLOAD_DIR;

  afterEach(() => {
    if (previous === undefined) delete process.env.SOURCE_UPLOAD_DIR;
    else process.env.SOURCE_UPLOAD_DIR = previous;
  });

  it("resolves ordinary keys inside the configured root", () => {
    process.env.SOURCE_UPLOAD_DIR = "source-storage-test";
    expect(resolveSourcePath("source.pdf")).toBe(
      `${getSourceRoot()}${process.platform === "win32" ? "\\" : "/"}source.pdf`,
    );
  });

  it("rejects traversal and root keys", () => {
    expect(() => resolveSourcePath("../outside.pdf")).toThrow(
      "Invalid source storage key",
    );
    expect(() => resolveSourcePath(".")).toThrow("Invalid source storage key");
  });
});
