/**
 * Block parsing and helpers behind media-aware exports. Deterministic, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  blocksToText,
  describeMedia,
  fitWidth,
  imageDimensions,
  sectionBlocks,
  videoWatchUrl,
} from "../lib/exportMedia";

describe("sectionBlocks", () => {
  it("returns plain sections unchanged", () => {
    expect(sectionBlocks({ content: "Plain body", contentFormat: "plain" })).toEqual([
      { kind: "text", text: "Plain body" },
    ]);
  });

  it("splits rich HTML into ordered text, image and video blocks", () => {
    const blocks = sectionBlocks({
      contentFormat: "html",
      content:
        '<h2>Intro</h2><p>One &amp; two</p><p><img src="/api/media/images/abc-123" alt="A &quot;quoted&quot; chart" title="Q3"></p>' +
        '<div data-video-embed="true"><iframe src="https://player.vimeo.com/video/76979871" title="Walkthrough"></iframe></div><p>End</p>',
    });
    expect(blocks).toEqual([
      { kind: "text", text: "Intro\n\nOne & two" },
      { kind: "image", id: "abc-123", alt: 'A "quoted" chart', caption: "Q3" },
      { kind: "video", url: "https://vimeo.com/76979871", title: "Walkthrough" },
      { kind: "text", text: "End" },
    ]);
  });

  it("keeps images that are not stored media as placeholders without an id", () => {
    const [block] = sectionBlocks({ contentFormat: "html", content: '<img src="https://example.com/x.png" alt="External">' });
    expect(block).toEqual({ kind: "image", id: null, alt: "External", caption: "" });
  });
});

describe("helpers", () => {
  it("maps embed URLs to public watch URLs", () => {
    expect(videoWatchUrl("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ")).toBe("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    expect(videoWatchUrl("https://player.vimeo.com/video/123")).toBe("https://vimeo.com/123");
    expect(videoWatchUrl("not a url")).toBe("not a url");
  });

  it("renders placeholders for text formats", () => {
    const blocks = sectionBlocks({
      contentFormat: "html",
      content: '<img src="/api/media/images/i1" alt="Diagram"><iframe src="https://www.youtube-nocookie.com/embed/abcdefg" title="Demo"></iframe>',
    });
    expect(blocksToText(blocks, "markdown")).toBe("*[Image: Diagram]*\n\n[Video: Demo](https://www.youtube.com/watch?v=abcdefg)");
    expect(blocksToText(blocks, "plain")).toBe("[Image: Diagram]\n\n[Video: Demo — https://www.youtube.com/watch?v=abcdefg]");
  });

  it("reads PNG, GIF and JPEG dimensions and rejects others", () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageDimensions(png, "image/png")).toEqual({ width: 640, height: 480 });

    const gif = Buffer.from("GIF89a \u0003X\u0002", "binary");
    expect(imageDimensions(gif, "image/gif")).toEqual({ width: 800, height: 600 });

    // SOI, APP0 (length 4), SOF0 with height 300, width 400
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
    expect(imageDimensions(jpeg, "image/jpeg")).toEqual({ width: 400, height: 300 });

    expect(imageDimensions(Buffer.from("RIFF0000WEBP"), "image/webp")).toBeNull();
  });

  it("scales to a maximum width preserving aspect ratio", () => {
    expect(fitWidth({ width: 1200, height: 800 }, 600)).toEqual({ width: 600, height: 400 });
    expect(fitWidth({ width: 300, height: 200 }, 600)).toEqual({ width: 300, height: 200 });
  });

  it("summarises media handling for validation notes", () => {
    expect(describeMedia({ embedded: 0, placeholders: 0, videos: 0 })).toBe("");
    expect(describeMedia({ embedded: 2, placeholders: 1, videos: 1 })).toBe(
      "Media: 2 image(s) embedded; 1 image(s) exported as labelled placeholders (format or file type cannot embed them); 1 video(s) exported as links",
    );
  });
});
