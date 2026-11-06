import { NOTIFICATION_BODY, notificationUrl } from "./webhookAuth";
import { userAgent } from "./fetcher";

/**
 * A client for a self-hosted changedetection.io instance
 * (https://github.com/dgtlmoon/changedetection.io, Apache-2.0), through its
 * REST API v1 (`x-api-key` header). No changedetection.io code is copied.
 *
 * Used when SOURCE_WATCHER_BACKEND=changedetection. Endpoints used:
 * - POST /api/v1/watch, PUT /api/v1/watch/{uuid}: create or update a watch;
 * - GET /api/v1/watch/{uuid}: last_checked, last_changed, last_error;
 * - GET /api/v1/watch/{uuid}/history/latest (and ?html=1): the latest snapshot;
 * - DELETE /api/v1/watch/{uuid}.
 * Tests inject a fake `fetch`; this build environment cannot reach a real instance.
 */

export interface ChangeDetectionConfig {
  baseUrl: string;
  apiKey: string;
  /** Where changedetection.io should POST change notifications; null in poll mode. */
  receiverUrl: string | null;
  webhookSecret: string | null;
  /** Sent on every watch's requests. */
  userAgent: string;
}

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface WatchState {
  lastChecked: Date | null;
  lastChanged: Date | null;
  lastError: string | null;
}

const toDate = (v: unknown): Date | null => (typeof v === "number" && v > 0 ? new Date(v * 1000) : null);

export class ChangeDetectionClient {
  constructor(private readonly config: ChangeDetectionConfig, private readonly fetchImpl: FetchFn = fetch as unknown as FetchFn) {}

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
    const res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
      method,
      headers: { "x-api-key": this.config.apiKey, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`changedetection.io ${method} ${path.split("/").slice(0, 3).join("/")} answered ${res.status}`);
    return { status: res.status, text };
  }

  /** The watch fields this integration manages. */
  watchBody(source: { name: string; url: string; scheduleHours: number; paused: boolean }) {
    const notify = this.config.receiverUrl && this.config.webhookSecret ? { notification_urls: [notificationUrl(this.config.receiverUrl, this.config.webhookSecret)], notification_body: NOTIFICATION_BODY, notification_format: "text" } : {};
    return {
      url: source.url,
      title: `Grant Studio: ${source.name}`.slice(0, 200),
      // The source's own schedule, not the instance default.
      time_between_check: { hours: source.scheduleHours },
      time_between_check_use_default: false,
      // The same honest User-Agent as the built-in fetcher, with no personal email.
      headers: { "User-Agent": this.config.userAgent },
      paused: source.paused,
      ...notify,
    };
  }

  /** Creates the watch, or updates it when `watchId` is set and still exists. Returns the watch UUID. */
  async upsertWatch(watchId: string | null, source: { name: string; url: string; scheduleHours: number; paused: boolean }): Promise<string> {
    const body = this.watchBody(source);
    if (watchId) {
      try {
        await this.call("PUT", `/watch/${encodeURIComponent(watchId)}`, body);
        return watchId;
      } catch (err) {
        if (!/answered 404/.test((err as Error).message)) throw err;
      }
    }
    const created = await this.call("POST", "/watch", body);
    let uuid: unknown = null;
    try {
      const parsed = JSON.parse(created.text);
      uuid = parsed?.uuid ?? null;
    } catch {
      uuid = null;
    }
    if (typeof uuid !== "string" || !uuid) {
      // Older versions answer "OK"; find the watch by its URL instead.
      const list = JSON.parse((await this.call("GET", "/watch")).text) as Record<string, { url?: string }>;
      uuid = Object.entries(list).find(([, w]) => w?.url === source.url)?.[0] ?? null;
    }
    if (typeof uuid !== "string" || !uuid) throw new Error("changedetection.io did not return the new watch's id.");
    return uuid;
  }

  async watchState(watchId: string): Promise<WatchState> {
    const w = JSON.parse((await this.call("GET", `/watch/${encodeURIComponent(watchId)}`)).text) as Record<string, unknown>;
    return { lastChecked: toDate(w.last_checked), lastChanged: toDate(w.last_changed), lastError: typeof w.last_error === "string" && w.last_error ? w.last_error.slice(0, 500) : null };
  }

  /** The latest snapshot as text, and its HTML when the instance still has it (for links). */
  async latestSnapshot(watchId: string): Promise<{ text: string; html: string | null }> {
    const text = (await this.call("GET", `/watch/${encodeURIComponent(watchId)}/history/latest`)).text;
    let html: string | null = null;
    try {
      html = (await this.call("GET", `/watch/${encodeURIComponent(watchId)}/history/latest?html=1`)).text;
    } catch {
      html = null;
    }
    return { text, html };
  }

  async deleteWatch(watchId: string): Promise<void> {
    try {
      await this.call("DELETE", `/watch/${encodeURIComponent(watchId)}`);
    } catch (err) {
      if (!/answered 404/.test((err as Error).message)) throw err;
    }
  }
}

export type WatcherBackend = "builtin" | "changedetection";
export type ChangeDetectionMode = "webhook" | "poll";

export interface WatcherSettings {
  backend: WatcherBackend;
  mode: ChangeDetectionMode;
  changeDetection: ChangeDetectionConfig | null;
  /** Why the changedetection backend is not usable, when it was asked for. */
  problem: string | null;
}

/**
 * The page watcher backend, from the environment:
 * SOURCE_WATCHER_BACKEND = builtin (default) | changedetection;
 * CHANGEDETECTION_URL, CHANGEDETECTION_API_KEY;
 * CHANGEDETECTION_MODE = webhook (default when a receiver URL and secret are set) | poll;
 * CHANGEDETECTION_RECEIVER_URL (this API's /api/sources/watch-events as changedetection.io reaches it);
 * CHANGEDETECTION_WEBHOOK_SECRET (24 characters or more).
 * A changedetection backend that is not fully configured falls back to builtin, and says why.
 */
export function watcherSettings(env: Record<string, string | undefined> = process.env, secret: string | null = null): WatcherSettings {
  const wanted = env.SOURCE_WATCHER_BACKEND?.trim().toLowerCase();
  if (wanted !== "changedetection") return { backend: "builtin", mode: "poll", changeDetection: null, problem: null };
  const baseUrl = env.CHANGEDETECTION_URL?.trim();
  const apiKey = env.CHANGEDETECTION_API_KEY?.trim();
  if (!baseUrl || !apiKey) return { backend: "builtin", mode: "poll", changeDetection: null, problem: "SOURCE_WATCHER_BACKEND is changedetection, but CHANGEDETECTION_URL or CHANGEDETECTION_API_KEY is not set; using the built-in fetcher." };
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad scheme");
  } catch {
    return { backend: "builtin", mode: "poll", changeDetection: null, problem: "CHANGEDETECTION_URL is not a valid URL; using the built-in fetcher." };
  }
  const receiverUrl = env.CHANGEDETECTION_RECEIVER_URL?.trim() || null;
  const modeWanted = env.CHANGEDETECTION_MODE?.trim().toLowerCase();
  const canWebhook = !!receiverUrl && !!secret;
  const mode: ChangeDetectionMode = modeWanted === "poll" ? "poll" : canWebhook ? "webhook" : "poll";
  const problem = modeWanted === "webhook" && !canWebhook ? "CHANGEDETECTION_MODE is webhook, but CHANGEDETECTION_RECEIVER_URL or a CHANGEDETECTION_WEBHOOK_SECRET of 24+ characters is missing; polling instead." : null;
  return { backend: "changedetection", mode, changeDetection: { baseUrl, apiKey, receiverUrl: mode === "webhook" ? receiverUrl : null, webhookSecret: mode === "webhook" ? secret : null, userAgent: userAgent(env) }, problem };
}
