import { describe, expect, it } from "vitest";
import { join, resolve } from "path";
import { isPathWithinDirectory } from "../lib/pathSafety";
import { rejectsSectionContentMutation } from "../lib/sectionMutation";

describe("export download path containment", () => {
  it("accepts an artifact inside the export directory on the host platform", () => {
    const directory = resolve("tmp", "exports");
    expect(
      isPathWithinDirectory(directory, join(directory, "artifact.docx")),
    ).toBe(true);
  });

  it("rejects traversal outside the export directory", () => {
    expect(isPathWithinDirectory("/exports", "/secret.txt")).toBe(false);
  });
});

describe("immutable document sections", () => {
  it.each([
    [{ isLocked: true, isApproved: false }, "locked"],
    [{ isLocked: false, isApproved: true }, "approved"],
  ])("rejects content changes when %s", (section) => {
    expect(rejectsSectionContentMutation(section, { content: "changed" })).toBe(
      true,
    );
    expect(rejectsSectionContentMutation(section, { content: "" })).toBe(true);
  });

  it("allows metadata changes and content changes on mutable sections", () => {
    expect(
      rejectsSectionContentMutation(
        { isLocked: true, isApproved: false },
        { notes: "reviewed" },
      ),
    ).toBe(false);
    expect(
      rejectsSectionContentMutation(
        { isLocked: false, isApproved: false },
        { content: "changed" },
      ),
    ).toBe(false);
  });
});
