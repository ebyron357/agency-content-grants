import { request as httpsRequest } from "node:https";
import net from "node:net";
import { isPublicAddress, safeLookup, UnsafeWebhookUrlError } from "../webhooks/urlSafety";
import { NoticeFileError } from "./noticePdf";

/**
 * Fetches a notice PDF from a link (an opportunity's official page or a link a
 * person pastes). The same outbound protection as webhook delivery
 * (lib/webhooks/urlSafety.ts): https only, no embedded credentials, every
 * address the host resolves to must be public and the socket connects to the
 * address that was checked. Redirects are followed at most 3 times, each
 * target checked the same way. The body is read with a byte cap and refused
 * as soon as it passes it.
 */

export interface FetchedNotice {
  buffer: Buffer;
  finalUrl: string;
  contentType: string | null;
  fileName: string | null;
}

export type NoticeFetcher = (url: string, opts: { maxBytes: number; signal?: AbortSignal; timeoutMs?: number }) => Promise<FetchedNotice>;

const MAX_REDIRECTS = 3;

export function checkNoticeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NoticeFileError("The link is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new NoticeFileError("The link must use https.");
  if (url.username || url.password) throw new NoticeFileError("The link must not contain a user name or password.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) throw new NoticeFileError("The link points to a private or internal address.");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new NoticeFileError("The link points to a private or internal address.");
  return url;
}

function fileNameFrom(disposition: string | undefined, url: URL): string | null {
  const m = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  const last = url.pathname.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : null;
}

function getOnce(url: URL, maxBytes: number, signal: AbortSignal): Promise<{ status: number; location?: string; buffer?: Buffer; contentType: string | null; disposition?: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: "GET", headers: { accept: "application/pdf,*/*;q=0.5", "user-agent": "GrantStudio-NoticeFetch/1.0" }, lookup: safeLookup as never }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = (res.headers["content-type"] as string | undefined) ?? null;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ status, location: res.headers.location, contentType });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        resolve({ status, contentType });
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        reject(new NoticeFileError(`The notice is ${(declared / 1024 / 1024).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy(new NoticeFileError(`The notice is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, buffer: Buffer.concat(chunks), contentType, disposition: res.headers["content-disposition"] as string | undefined }));
      res.on("error", reject);
    });
    req.on("error", (err) => reject(err instanceof UnsafeWebhookUrlError ? new NoticeFileError("The link points to a private or internal address.") : err));
    const onAbort = () => req.destroy(new Error("The download took too long."));
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal.removeEventListener("abort", onAbort));
    req.end();
  });
}

/** The default fetcher: https only, public addresses only, capped size, at most 3 redirects. */
export const fetchNoticePdf: NoticeFetcher = async (raw, opts) => {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let url = checkNoticeUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await getOnce(url, opts.maxBytes, signal);
    if (res.location) {
      if (hop === MAX_REDIRECTS) throw new NoticeFileError("The link redirected too many times.");
      url = checkNoticeUrl(new URL(res.location, url).toString());
      continue;
    }
    if (!res.buffer) throw new NoticeFileError(`The link answered ${res.status}.`);
    return { buffer: res.buffer, finalUrl: url.toString(), contentType: res.contentType, fileName: fileNameFrom(res.disposition, url) };
  }
  throw new NoticeFileError("The link redirected too many times.");
};

let override: NoticeFetcher | null = null;

/** Tests replace the network fetch with a fake. */
export function setNoticeFetcherForTests(fetcher: NoticeFetcher | null): void {
  override = fetcher;
}

export function noticeFetcher(): NoticeFetcher {
  return override ?? fetchNoticePdf;
}
