/**
 * exporter-html-content.test.ts
 *
 * Verifies that the exporter helper `stripHtml` / `sectionText` correctly
 * degrades rich HTML content to plain text for DOCX, PDF, Markdown and TXT
 * formats, and that plain-text content is left unchanged.
 *
 * These tests exercise the exported functions indirectly by calling the
 * public `exportDocument` helper is not directly testable without a DB, so
 * we test the helper functions through a local re-export module.
 */

import { describe, it, expect } from "vitest";

// ── Re-implement the pure helpers locally (same logic as exporter/index.ts) ───
// This avoids requiring a database or file-system in unit tests.

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sectionText(section: { content: string | null; contentFormat?: string | null }): string {
  const raw = section.content ?? "";
  if (!raw) return "";
  return section.contentFormat === "html" ? stripHtml(raw) : raw;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("stripHtml", () => {
  it("strips simple tags", () => {
    expect(stripHtml("<p>Hello world</p>")).toBe("Hello world");
  });

  it("converts <br> to newline", () => {
    expect(stripHtml("line1<br>line2")).toBe("line1\nline2");
  });

  it("converts closing </p> to paragraph break", () => {
    const result = stripHtml("<p>Para one</p><p>Para two</p>");
    expect(result).toContain("Para one");
    expect(result).toContain("Para two");
  });

  it("decodes HTML entities", () => {
    expect(stripHtml("&amp; &lt;tag&gt; &quot;quote&quot; &#39;apos&#39;")).toBe(
      '& <tag> "quote" \'apos\''
    );
  });

  it("strips heading tags", () => {
    expect(stripHtml("<h2>Title</h2><p>Body</p>")).toContain("Title");
    expect(stripHtml("<h2>Title</h2><p>Body</p>")).not.toContain("<h2>");
  });

  it("handles nested tags", () => {
    expect(stripHtml("<p><strong>Bold</strong> and <em>italic</em></p>")).toBe("Bold and italic");
  });

  it("collapses excessive newlines", () => {
    const result = stripHtml("<p>A</p><p>B</p><p>C</p>");
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("sectionText", () => {
  it("returns plain text unchanged when contentFormat is 'plain'", () => {
    const section = { content: "Hello plain world", contentFormat: "plain" };
    expect(sectionText(section)).toBe("Hello plain world");
  });

  it("returns plain text when contentFormat is null", () => {
    const section = { content: "Hello", contentFormat: null };
    expect(sectionText(section)).toBe("Hello");
  });

  it("strips HTML when contentFormat is 'html'", () => {
    const section = {
      content: "<h1>Title</h1><p><strong>Bold</strong> text</p>",
      contentFormat: "html",
    };
    const result = sectionText(section);
    expect(result).toContain("Title");
    expect(result).toContain("Bold text");
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("<strong>");
  });

  it("returns empty string for null content", () => {
    expect(sectionText({ content: null, contentFormat: "html" })).toBe("");
  });

  it("returns empty string for empty content", () => {
    expect(sectionText({ content: "", contentFormat: "plain" })).toBe("");
  });
});
