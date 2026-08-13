/**
 * videoValidator.ts
 *
 * Safe, allowlist-based video URL validator.
 * Only YouTube and Vimeo URLs are accepted — no arbitrary iframes.
 */

export type VideoProvider = "youtube" | "vimeo";

export interface VideoMeta {
  provider: VideoProvider;
  videoId: string;
  embedUrl: string;
}

// Approved embed base URLs (no user-supplied content is inserted into the origin)
const YOUTUBE_EMBED_BASE = "https://www.youtube-nocookie.com/embed/";
const VIMEO_EMBED_BASE = "https://player.vimeo.com/video/";

const VIDEO_ID_RE = /^[A-Za-z0-9_\-]{2,20}$/;

/**
 * Parse and validate a video URL.
 * Returns VideoMeta on success, null if the URL is not supported or malformed.
 */
export function parseVideoUrl(rawUrl: string): VideoMeta | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  // Only allow HTTPS
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  // ── YouTube ──────────────────────────────────────────────────────────────
  if (host === "youtube.com" || host === "youtu.be") {
    let videoId: string | null = null;

    if (host === "youtu.be") {
      // https://youtu.be/<id>
      videoId = url.pathname.slice(1).split("/")[0] ?? null;
    } else if (url.pathname === "/watch") {
      // https://www.youtube.com/watch?v=<id>
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/embed/")) {
      // https://www.youtube.com/embed/<id>
      videoId = url.pathname.split("/embed/")[1]?.split("/")[0] ?? null;
    } else if (url.pathname.startsWith("/shorts/")) {
      // https://www.youtube.com/shorts/<id>
      videoId = url.pathname.split("/shorts/")[1]?.split("/")[0] ?? null;
    }

    if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;
    return {
      provider: "youtube",
      videoId,
      embedUrl: `${YOUTUBE_EMBED_BASE}${videoId}`,
    };
  }

  // ── Vimeo ─────────────────────────────────────────────────────────────────
  if (host === "vimeo.com") {
    // https://vimeo.com/<numeric-id> or /channels/.../videos/<id>
    const parts = url.pathname.split("/").filter(Boolean);
    let videoId: string | null = null;

    for (const part of parts) {
      if (/^\d{5,12}$/.test(part)) {
        videoId = part;
        break;
      }
    }

    if (!videoId) return null;
    return {
      provider: "vimeo",
      videoId,
      embedUrl: `${VIMEO_EMBED_BASE}${videoId}`,
    };
  }

  return null;
}
