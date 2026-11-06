import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import net from "node:net";
import { isPublicAddress } from "../../webhooks/urlSafety";

/**
 * The built-in page fetcher (docs/SOURCE_REGISTRY.md): a plain HTTPS GET, so
 * page watching works without changedetection.io.
 *
 * It is a respectful reader:
 * - an honest User-Agent that names the product and links to its page, with
 *   no personal email (`SOURCE_FETCH_USER_AGENT` overrides it);
 * - at most one request per host every `SOURCE_FETCH_MIN_INTERVAL_MS` (default 10 s);
 * - pages are checked no more often than their schedule (6 hours at least);
 * - a 20-second timeout and a 2 MB limit.
 * It only connects to public addresses (the same check as webhook delivery),
 * follows at most 3 redirects, each re-checked, and only over https.
 */

export const DEFAULT_USER_AGENT = "GrantStudioSourceWatcher/1.0 (+https://github.com/ebyron357/agency-content-grants/blob/main/docs/SOURCE_REGISTRY.md)";
export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string | null;
  body: string;
}

/** Fetch one URL; tests inject a fake. */
export type PageFetchLike = (url: string, opts: { userAgent: string; signal?: AbortSignal }) => Promise<FetchedPage>;

export function userAgent(env: Record<string, string | undefined> = process.env): string {
  const ua = env.SOURCE_FETCH_USER_AGENT?.trim();
  // Never send a personal email address in the User-Agent.
  return ua && !/@/.test(ua) ? ua.slice(0, 200) : DEFAULT_USER_AGENT;
}

export function minIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SOURCE_FETCH_MIN_INTERVAL_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 10_000;
}

/** One request per host per interval, across every source in this process. */
export class HostRateLimiter {
  private next = new Map<string, number>();
  constructor(private readonly intervalMs: number, private readonly now: () => number = Date.now, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  /** Waits until this host may be requested again, then reserves the slot. Returns the wait in ms. */
  async wait(host: string): Promise<number> {
    const t = this.now();
    const at = Math.max(t, this.next.get(host) ?? 0);
    this.next.set(host, at + this.intervalMs);
    const delay = at - t;
    if (delay > 0) await this.sleep(delay);
    return delay;
  }
}

const limiter = new HostRateLimiter(minIntervalMs());

function safeLookup(hostname: string, options: any, callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void): void {
  const all = typeof options === "object" && options?.all === true;
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const safe = (addresses ?? []).filter((a) => isPublicAddress(a.address));
    if (!safe.length) return callback(new Error(`${hostname} has no public address`));
    if (all) return callback(null, safe);
    callback(null, safe[0].address, safe[0].family);
  });
}

function getOnce(url: URL, ua: string, signal?: AbortSignal): Promise<{ status: number; location: string | null; contentType: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== "https:") return reject(new Error("Only https pages are read."));
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) return reject(new Error("Pages must use a host name, not an IP address."));
    const req = httpsRequest(url, { method: "GET", lookup: safeLookup as any, headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "Accept-Encoding": "identity" }, timeout: TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, location: res.headers.location ?? null, contentType: null, body: "" });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error(`The page is larger than ${MAX_BYTES / 1024 / 1024} MB.`));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status, location: null, contentType: String(res.headers["content-type"] ?? "") || null, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`No answer within ${TIMEOUT_MS / 1000} s.`)));
    req.on("error", reject);
    if (signal) {
      const onAbort = () => req.destroy(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }
    req.end();
  });
}

/** The real fetcher: rate limited per host, https only, public addresses only. */
export const builtinFetch: PageFetchLike = async (rawUrl, opts) => {
  let url = new URL(rawUrl);
  for (let hop = 0; ; hop++) {
    await limiter.wait(url.hostname);
    const res = await getOnce(url, opts.userAgent, opts.signal);
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
      url = new URL(res.location, url);
      continue;
    }
    return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body };
  }
};
