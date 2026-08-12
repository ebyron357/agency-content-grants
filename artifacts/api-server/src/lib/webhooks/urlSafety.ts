/**
 * Outbound SSRF protection for webhook subscription URLs.
 *
 * A webhook subscription URL is attacker-influenced input (any authenticated
 * user can register one) that this server itself later dials out to on a
 * timer. Without protection, a user could point a subscription at
 * `http://169.254.169.254/` (cloud metadata), `http://localhost:<port>/...`,
 * or any other RFC1918/loopback/link-local address reachable from this
 * process, turning the delivery scheduler into a generic internal-network
 * request proxy.
 *
 * Two layers, both required:
 *  1. `assertValidWebhookUrl` — a friendly, fail-fast check at subscription
 *     create/update time (rejects the obvious case immediately, with a
 *     helpful error).
 *  2. `safeHttpRequest` — the actual delivery-time dispatch. This is what
 *     really matters: a subscription's DNS can change between registration
 *     and delivery (DNS rebinding), so layer 1 alone is not a real defense.
 *     `safeHttpRequest` resolves the hostname *itself*, validates every
 *     resulting address, and then connects directly to the one address it
 *     already validated (via Node's `lookup` request option) — there is no
 *     separate "validate" step followed by a second, independent DNS
 *     resolution at connect time for an attacker to race.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import net, { BlockList } from "node:net";

export class UnsafeWebhookUrlError extends Error {}

const PRIVATE_BLOCKLIST = new BlockList();
// IPv4: loopback, RFC1918 private ranges, link-local (includes the
// 169.254.169.254 cloud-metadata address), CGNAT, "this network", TEST-NET
// documentation ranges, benchmarking, multicast, reserved, broadcast.
const IPV4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];
for (const [address, prefix] of IPV4_BLOCKED) PRIVATE_BLOCKLIST.addSubnet(address, prefix, "ipv4");

// IPv6: unspecified, loopback, unique-local, link-local, multicast, and the
// NAT64 well-known prefix (which embeds and can reach IPv4 addresses).
const IPV6_BLOCKED: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96],
];
for (const [address, prefix] of IPV6_BLOCKED) PRIVATE_BLOCKLIST.addSubnet(address, prefix, "ipv6");

/** True if `address` is a public, non-reserved IPv4/IPv6 literal. */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return !PRIVATE_BLOCKLIST.check(address, "ipv4");
  if (net.isIPv6(address)) {
    // Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d) and check the embedded address too.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped && !isPublicAddress(mapped[1])) return false;
    return !PRIVATE_BLOCKLIST.check(address, "ipv6");
  }
  return false; // not a literal IP — caller must resolve it first
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, ""); // strip IPv6 URL brackets, e.g. "[::1]" -> "::1"
}

/** Registration-time check: parse the URL, resolve its hostname, and reject if any resolved address is private/reserved. */
export async function assertValidWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError("must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeWebhookUrlError("must not contain embedded credentials");
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new UnsafeWebhookUrlError(`refuses to deliver to private/internal address ${hostname}`);
    }
    return;
  }
  const addresses = await resolveAllOrThrow(hostname);
  const unsafe = addresses.filter((a) => !isPublicAddress(a.address));
  if (unsafe.length > 0) {
    throw new UnsafeWebhookUrlError(`${hostname} resolves to a private/internal address (${unsafe.map((a) => a.address).join(", ")}) and cannot be used as a webhook destination`);
  }
}

function resolveAllOrThrow(hostname: string): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) { reject(new UnsafeWebhookUrlError(`could not resolve hostname ${hostname}`)); return; }
      if (!addresses || addresses.length === 0) { reject(new UnsafeWebhookUrlError(`could not resolve hostname ${hostname}`)); return; }
      resolve(addresses);
    });
  });
}

/**
 * A `lookup` implementation (same signature as `dns.lookup`) that only ever
 * hands back a public address, passed as Node's `http(s).request({ lookup })`
 * option so the *actual* socket connects to an address this function itself
 * validated — no separate resolve-then-connect gap for DNS rebinding to
 * exploit. Literal IP hostnames (e.g. a webhook URL pointing straight at
 * `169.254.169.254`) go through this same path and are rejected the same way.
 */
function safeLookup(hostname: string, options: any, callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void): void {
  const wantsAll = typeof options === "object" && options?.all === true;
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      callback(new UnsafeWebhookUrlError(`refusing to connect to private/internal address ${hostname}`));
      return;
    }
    const family = net.isIPv6(hostname) ? 6 : 4;
    callback(null, wantsAll ? [{ address: hostname, family }] : hostname, family);
    return;
  }
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) { callback(err); return; }
    const safe = (addresses ?? []).filter((a) => isPublicAddress(a.address));
    if (safe.length === 0) {
      callback(new UnsafeWebhookUrlError(`${hostname} has no public/resolvable address to deliver to`));
      return;
    }
    if (wantsAll) { callback(null, safe); return; }
    callback(null, safe[0].address, safe[0].family);
  });
}

export interface SafeHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/**
 * Deliver one webhook POST, pinned to a validated address (see `safeLookup`
 * above) and never following redirects (an unvalidated redirect target would
 * reopen the exact SSRF hole this module exists to close — a subscriber that
 * needs to move should update their registered URL instead).
 */
export function safeHttpRequest(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<SafeHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new UnsafeWebhookUrlError("must be a valid URL"));
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      reject(new UnsafeWebhookUrlError("must use http or https"));
      return;
    }
    // Node's `lookup` request option is only invoked when the host needs
    // DNS resolution — for a literal IP address (e.g. a webhook URL that is
    // itself "http://169.254.169.254/...") Node connects directly and never
    // calls `lookup` at all, so that case needs its own explicit check here
    // rather than relying on safeLookup below.
    const literalHost = normalizeHostname(parsed.hostname);
    if (net.isIP(literalHost) && !isPublicAddress(literalHost)) {
      reject(new UnsafeWebhookUrlError(`refusing to connect to private/internal address ${literalHost}`));
      return;
    }
    const transport = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(
      parsed,
      { method: init.method, headers: init.headers, lookup: safeLookup as any },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    const onAbort = () => req.destroy(new Error("aborted"));
    init.signal.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => init.signal.removeEventListener("abort", onAbort));
    req.write(init.body);
    req.end();
  });
}
