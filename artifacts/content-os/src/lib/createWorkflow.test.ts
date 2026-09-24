import { describe, expect, it } from "vitest";
import { stageToLabel, workflowStepIndex } from "./createWorkflow";

describe("creation workflow progress", () => {
  it.each([
    ["assignment", 0],
    ["research_plan", 1],
    ["claims", 1],
    ["outline", 2],
    ["drafting", 3],
    ["quality", 3],
  ])("maps %s to visible step %i", (stage, expected) => {
    expect(workflowStepIndex(stage)).toBe(expected);
  });

  it("reports the actual drafting stage", () => {
    expect(stageToLabel("drafting")).toBe("Drafting your content…");
  });
});
