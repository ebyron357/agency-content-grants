import { describe, expect, it } from "vitest";
import { sanitizeRichHtml, sectionText, stripHtml } from "../lib/richText";
import { embedImagesForExport } from "../lib/exportHtml";
import { resolveMediaPath } from "../lib/mediaStorage";

describe("rich HTML handling", () => {
  it("removes executable markup and unsafe URLs", () => {
    const result = sanitizeRichHtml(
      '<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    );
    expect(result).toBe('<p>Safe</p><a rel="noopener noreferrer">bad</a>');
  });

  it("preserves approved rich media with an accessible iframe name", () => {
    const result = sanitizeRichHtml(
      '<div data-video-embed="true"><iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe></div>',
    );
    expect(result).toContain(
      'src="https://www.youtube-nocookie.com/embed/abc"',
    );
    expect(result).toContain('title="Embedded video"');
  });

  it("strips markup through the production helper", () => {
    expect(stripHtml("<h2>Title</h2><p>Body &amp; detail</p>")).toBe(
      "Title\n\nBody & detail",
    );
    expect(
      sectionText({ content: "<strong>Bold</strong>", contentFormat: "html" }),
    ).toBe("Bold");
  });
});

describe("HTML export media", () => {
  it("embeds authenticated media as a portable data URL", () => {
    const result = embedImagesForExport(
      '<img src="/api/media/images/image-1" alt="Chart">',
      [{ id: "image-1", mimeType: "image/png", data: Buffer.from("png") }],
    );
    expect(result).toContain('src="data:image/png;base64,cG5n"');
  });
});

describe("media storage boundary", () => {
  it("rejects storage keys that escape the configured upload directory", () => {
    expect(() => resolveMediaPath("../outside.png")).toThrow("Invalid media storage key");
  });
});
