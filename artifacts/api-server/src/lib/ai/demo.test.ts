import { describe, expect, it } from "vitest";
import { DemoProvider } from "./demo";

describe("DemoProvider stage classification", () => {
  const provider = new DemoProvider();

  it("returns outline sections when the prompt also mentions questions", async () => {
    const result = await provider.generate([
      {
        role: "user",
        content:
          'Create an outline with "questionsAnswered" for every section.',
      },
    ]);

    const parsed = JSON.parse(result.content);
    expect(parsed.sections).toHaveLength(6);
  });

  it("returns a quality report when the prompt also mentions sections", async () => {
    const result = await provider.generate([
      { role: "user", content: "Evaluate the quality of these sections." },
    ]);

    const parsed = JSON.parse(result.content);
    expect(parsed.accuracyScore).toBeTypeOf("number");
  });

  it("returns claim verification when the prompt also mentions writing", async () => {
    const result = await provider.generate([
      { role: "user", content: "Verify this claim from the written section." },
    ]);

    const parsed = JSON.parse(result.content);
    expect(parsed.verificationStatus).toBeDefined();
  });
});
