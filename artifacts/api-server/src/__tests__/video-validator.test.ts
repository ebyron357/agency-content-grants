/**
 * video-validator.test.ts — Unit tests for the video URL allowlist validator
 *
 * Covers:
 * - YouTube variants (watch, shorts, youtu.be, embed)
 * - Vimeo standard URLs
 * - Rejection of non-HTTPS, unsupported hosts, empty IDs, path traversal
 */

import { describe, it, expect } from "vitest";
import { parseVideoUrl } from "../lib/videoValidator";

describe("parseVideoUrl — YouTube", () => {
  it("parses a standard watch URL", () => {
    const result = parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("youtube");
    expect(result!.videoId).toBe("dQw4w9WgXcQ");
    expect(result!.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("parses a youtu.be short URL", () => {
    const result = parseVideoUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(result).not.toBeNull();
    expect(result!.videoId).toBe("dQw4w9WgXcQ");
  });

  it("parses a Shorts URL", () => {
    const result = parseVideoUrl("https://www.youtube.com/shorts/abc123XY");
    expect(result).not.toBeNull();
    expect(result!.videoId).toBe("abc123XY");
  });

  it("parses an embed URL", () => {
    const result = parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(result).not.toBeNull();
    expect(result!.videoId).toBe("dQw4w9WgXcQ");
  });

  it("rejects an HTTP YouTube URL", () => {
    expect(parseVideoUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("rejects a URL with no video ID", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch")).toBeNull();
  });

  it("rejects a URL with too-short video ID", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=a")).toBeNull();
  });
});

describe("parseVideoUrl — Vimeo", () => {
  it("parses a standard Vimeo URL", () => {
    const result = parseVideoUrl("https://vimeo.com/123456789");
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("vimeo");
    expect(result!.videoId).toBe("123456789");
    expect(result!.embedUrl).toBe("https://player.vimeo.com/video/123456789");
  });

  it("parses a Vimeo channel URL", () => {
    const result = parseVideoUrl("https://vimeo.com/channels/mychannel/123456789");
    expect(result).not.toBeNull();
    expect(result!.videoId).toBe("123456789");
  });

  it("rejects an HTTP Vimeo URL", () => {
    expect(parseVideoUrl("http://vimeo.com/123456789")).toBeNull();
  });
});

describe("parseVideoUrl — Rejections", () => {
  it("rejects an empty string", () => {
    expect(parseVideoUrl("")).toBeNull();
  });

  it("rejects a plain string", () => {
    expect(parseVideoUrl("not-a-url")).toBeNull();
  });

  it("rejects an arbitrary HTTPS URL", () => {
    expect(parseVideoUrl("https://example.com/video/123")).toBeNull();
  });

  it("rejects a data: URI", () => {
    expect(parseVideoUrl("data:text/html,<h1>hack</h1>")).toBeNull();
  });

  it("rejects a javascript: URI", () => {
    expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects a Dailymotion URL (not in allowlist)", () => {
    expect(parseVideoUrl("https://www.dailymotion.com/video/x7tgad0")).toBeNull();
  });

  it("rejects a URL that looks like YouTube but is a different host", () => {
    expect(parseVideoUrl("https://fake-youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});
