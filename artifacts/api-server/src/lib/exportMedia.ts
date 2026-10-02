import { stripHtml } from "./richText";

/**
 * Media-aware export content. Rich sections contain inline images
 * (`<img src="/api/media/images/<id>">`) and video embeds (`<iframe>` from
 * youtube-nocookie / player.vimeo). Plain-text conversion alone would drop
 * them silently, so exporters work from ordered blocks instead: formats that
 * can embed an image do so, and every other case gets an explicit placeholder
 * or link.
 */
export type ExportBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; id: string | null; alt: string; caption: string }
  | { kind: "video"; url: string; title: string };

export type ExportImage = { id: string; mimeType: string; data: Buffer };

const MEDIA_TAG = /<img\b[^>]*>|<iframe\b[^>]*>(?:\s*<\/iframe>)?/gi;
const IMAGE_ID = /^\/api\/media\/images\/([A-Za-z0-9-]+)$/;

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

/** Public watch URL for an approved embed URL; other URLs are returned unchanged. */
export function videoWatchUrl(embedSrc: string): string {
  try {
    const url = new URL(embedSrc);
    const youtube = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
    if (url.hostname.endsWith("youtube-nocookie.com") && youtube)
      return `https://www.youtube.com/watch?v=${youtube[1]}`;
    const vimeo = url.pathname.match(/^\/video\/(\d+)/);
    if (url.hostname === "player.vimeo.com" && vimeo)
      return `https://vimeo.com/${vimeo[1]}`;
  } catch {
    // fall through
  }
  return embedSrc;
}

export function sectionBlocks(section: {
  content: string | null;
  contentFormat?: string | null;
}): ExportBlock[] {
  const raw = section.content ?? "";
  if (!raw) return [];
  if (section.contentFormat !== "html") return [{ kind: "text", text: raw }];

  const blocks: ExportBlock[] = [];
  const pushText = (html: string) => {
    const text = stripHtml(html);
    if (text) blocks.push({ kind: "text", text });
  };
  let cursor = 0;
  for (const match of raw.matchAll(MEDIA_TAG)) {
    pushText(raw.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    const tag = match[0];
    if (/^<img/i.test(tag)) {
      const src = attribute(tag, "src");
      blocks.push({
        kind: "image",
        id: src.match(IMAGE_ID)?.[1] ?? null,
        alt: attribute(tag, "alt"),
        caption: attribute(tag, "title"),
      });
    } else {
      const src = attribute(tag, "src");
      if (src)
        blocks.push({
          kind: "video",
          url: videoWatchUrl(src),
          title: attribute(tag, "title") || "Embedded video",
        });
    }
  }
  pushText(raw.slice(cursor));
  return blocks;
}

function imageLabel(block: Extract<ExportBlock, { kind: "image" }>): string {
  const alt = block.alt || "image";
  return block.caption ? `${alt} — ${block.caption}` : alt;
}

/** Text rendering for formats that cannot embed media (Markdown, TXT). */
export function blocksToText(
  blocks: ExportBlock[],
  style: "markdown" | "plain",
): string {
  return blocks
    .map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "image")
        return style === "markdown"
          ? `*[Image: ${imageLabel(block)}]*`
          : `[Image: ${imageLabel(block)}]`;
      return style === "markdown"
        ? `[Video: ${block.title}](${block.url})`
        : `[Video: ${block.title} — ${block.url}]`;
    })
    .join("\n\n");
}

export function imagePlaceholder(
  block: Extract<ExportBlock, { kind: "image" }>,
): string {
  return `[Image: ${imageLabel(block)}]`;
}

/** Pixel size of PNG, JPEG or GIF data; null for anything else or malformed data. */
export function imageDimensions(
  data: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  if (mimeType === "image/png" && data.length >= 24)
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (mimeType === "image/gif" && data.length >= 10)
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame)
        return {
          height: data.readUInt16BE(offset + 5),
          width: data.readUInt16BE(offset + 7),
        };
      offset += 2 + length;
    }
  }
  return null;
}

/** Scale to fit within maxWidth, preserving aspect ratio. */
export function fitWidth(
  size: { width: number; height: number },
  maxWidth: number,
): { width: number; height: number } {
  if (size.width <= maxWidth) return size;
  return {
    width: maxWidth,
    height: Math.round((size.height * maxWidth) / size.width),
  };
}

export type MediaSummary = {
  embedded: number;
  placeholders: number;
  videos: number;
};

export function describeMedia(summary: MediaSummary): string {
  const parts: string[] = [];
  if (summary.embedded) parts.push(`${summary.embedded} image(s) embedded`);
  if (summary.placeholders)
    parts.push(
      `${summary.placeholders} image(s) exported as labelled placeholders (format or file type cannot embed them)`,
    );
  if (summary.videos)
    parts.push(`${summary.videos} video(s) exported as links`);
  return parts.length ? `Media: ${parts.join("; ")}` : "";
}
