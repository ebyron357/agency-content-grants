/**
 * Repurposing Engine unit tests (deterministic, no DB, no AI calls) — channel
 * catalog integrity and prompt construction are pure functions over plain data.
 */
import { describe, it, expect } from "vitest";
import { REPURPOSE_CHANNELS, isValidChannel, listChannels, buildRepurposePrompt } from "./repurposing";

describe("channel catalog", () => {
  it("every channel has complete metadata", () => {
    for (const [key, meta] of Object.entries(REPURPOSE_CHANNELS)) {
      expect(meta.label, `${key}.label`).toBeTruthy();
      expect(meta.platform, `${key}.platform`).toBeTruthy();
      expect(meta.defaultLength, `${key}.defaultLength`).toBeTruthy();
      expect(meta.guidance, `${key}.guidance`).toBeTruthy();
    }
  });

  it("listChannels returns one entry per catalog key with the key embedded", () => {
    const list = listChannels();
    expect(list.length).toBe(Object.keys(REPURPOSE_CHANNELS).length);
    for (const item of list) {
      expect(item.key in REPURPOSE_CHANNELS).toBe(true);
      expect(item.label).toBe(REPURPOSE_CHANNELS[item.key].label);
    }
  });
});

describe("isValidChannel", () => {
  it("accepts known channels", () => {
    expect(isValidChannel("linkedin_post")).toBe(true);
    expect(isValidChannel("twitter_thread")).toBe(true);
  });

  it("rejects unknown channels", () => {
    expect(isValidChannel("myspace_post")).toBe(false);
    expect(isValidChannel("")).toBe(false);
  });
});

describe("buildRepurposePrompt", () => {
  const baseInput = {
    channel: "linkedin_post",
    sourceTitle: "The Future of Renewable Energy",
    sourceContent: "Solar and wind adoption is accelerating worldwide as costs fall.",
  };

  it("throws for an unknown channel", () => {
    expect(() => buildRepurposePrompt({ ...baseInput, channel: "not_a_channel" })).toThrow(/Unknown channel/);
  });

  it("includes the source title and content in the user message", () => {
    const [, user] = buildRepurposePrompt(baseInput);
    expect(user.role).toBe("user");
    expect(user.content).toContain(baseInput.sourceTitle);
    expect(user.content).toContain(baseInput.sourceContent);
  });

  it("includes channel-specific platform guidance", () => {
    const [, user] = buildRepurposePrompt(baseInput);
    expect(user.content).toContain(REPURPOSE_CHANNELS.linkedin_post.guidance);
  });

  it("system message carries brand voice, prohibited vocabulary, compliance notes, and brain block", () => {
    const [system] = buildRepurposePrompt({
      ...baseInput,
      brandName: "Acme Corp",
      brandVoice: "Bold and irreverent",
      prohibitedVocabulary: "cheap, discount",
      complianceNotes: "Always include a risk disclaimer",
      brainBlock: "BRAND FACTS: Founded in 2010",
    });
    expect(system.content).toContain("Acme Corp");
    expect(system.content).toContain("Bold and irreverent");
    expect(system.content).toContain("cheap, discount");
    expect(system.content).toContain("risk disclaimer");
    expect(system.content).toContain("Founded in 2010");
  });

  it("includes the previous version and a regeneration instruction when regenerating", () => {
    const [, user] = buildRepurposePrompt({
      ...baseInput,
      previousContent: "Old LinkedIn post content here.",
    });
    expect(user.content).toContain("Old LinkedIn post content here.");
    expect(user.content).toContain("previous version existed");
  });

  it("omits the previous-version block on first generation", () => {
    const [, user] = buildRepurposePrompt(baseInput);
    expect(user.content).not.toContain("previous version existed");
  });

  it("respects tone/audience/cta/targetLength overrides over channel defaults", () => {
    const [, user] = buildRepurposePrompt({
      ...baseInput,
      tone: "Playful",
      audience: "Solar installers",
      cta: "Book a free consult",
      targetLength: "under 100 words",
    });
    expect(user.content).toContain("Playful");
    expect(user.content).toContain("Solar installers");
    expect(user.content).toContain("Book a free consult");
    expect(user.content).toContain("under 100 words");
  });

  it("truncates very long source content to a bounded size", () => {
    const longContent = "word ".repeat(5000);
    const [, user] = buildRepurposePrompt({ ...baseInput, sourceContent: longContent });
    // Should not embed the full 25000-char string verbatim
    expect(user.content.length).toBeLessThan(longContent.length);
  });
});
