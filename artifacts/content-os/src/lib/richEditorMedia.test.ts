import { describe, expect, it } from "vitest";
import { hasRequiredAltText, parsePersistedVideoCaption, parsePersistedVideoSrc } from "./richEditorMedia";

describe("rich editor persisted media", () => {
  it("parses the nested iframe and caption emitted by the serializer", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/abc" title="Demo"></iframe><p data-video-caption="true">Demo caption</p>';
    expect(parsePersistedVideoSrc(wrapper)).toBe("https://www.youtube-nocookie.com/embed/abc");
    expect(parsePersistedVideoCaption(wrapper)).toBe("Demo caption");
  });

  it("rejects empty or whitespace-only accessibility text", () => {
    expect(hasRequiredAltText("")).toBe(false);
    expect(hasRequiredAltText("   ")).toBe(false);
    expect(hasRequiredAltText("A chart of grant awards")).toBe(true);
  });
});
