import { createHash, timingSafeEqual } from "crypto";

/**
 * Verifies change notifications from changedetection.io (docs/SOURCE_REGISTRY.md).
 *
 * changedetection.io sends notifications through Apprise, which cannot sign a
 * body, so the shared secret travels as a request header that the watch's
 * notification URL sets (`posts://host/path?+x-watcher-secret=SECRET`). The
 * receiver compares it in constant time. The notification only says which
 * watch changed: the page text is then read from changedetection.io's API
 * with its API key, so a forged body cannot inject page content.
 *
 * Pure module: no database import.
 */

export const SECRET_HEADER = "x-watcher-secret";
/** The shortest secret accepted; shorter ones are treated as not configured. */
export const MIN_SECRET_LENGTH = 24;

export function webhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.CHANGEDETECTION_WEBHOOK_SECRET?.trim();
  return s && s.length >= MIN_SECRET_LENGTH ? s : null;
}

/** Constant-time comparison of the presented secret with the configured one (both hashed, so lengths never leak). */
export function verifyWebhookSecret(presented: string | string[] | undefined, expected: string | null): boolean {
  if (!expected || typeof presented !== "string" || !presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface ChangeNotification {
  watchId: string;
  watchUrl: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The watch the notification names; null when the body is not one this integration sends. */
export function parseChangeNotification(body: unknown): ChangeNotification | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const watchId = typeof b.watch_uuid === "string" ? b.watch_uuid.trim() : typeof b.watchId === "string" ? b.watchId.trim() : "";
  if (!UUID.test(watchId)) return null;
  const watchUrl = typeof b.watch_url === "string" ? b.watch_url.slice(0, 2000) : null;
  return { watchId: watchId.toLowerCase(), watchUrl };
}

/**
 * The notification body each watch is created with. Jinja's `tojson` keeps
 * the values JSON-safe; Apprise adds the JSON content type when the body is JSON.
 */
export const NOTIFICATION_BODY = '{"event": "watch.changed", "watch_uuid": {{ watch_uuid|tojson }}, "watch_url": {{ watch_url|tojson }}}';

/** An Apprise `posts://` URL for our receiver, with the secret as a header (Apprise's `+header=value` syntax). */
export function notificationUrl(receiverUrl: string, secret: string): string {
  const url = new URL(receiverUrl);
  const path = `${url.host}${url.pathname}`;
  const scheme = url.protocol === "https:" ? "posts" : "post";
  return `${scheme}://${path}?+${SECRET_HEADER}=${encodeURIComponent(secret)}`;
}
