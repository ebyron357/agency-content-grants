/**
 * Outbound SSRF protection for webhook subscription URLs — both the
 * registration-time check (assertValidWebhookUrl) and the delivery-time
 * pinned-connect path (safeHttpRequest / its safeLookup). No mocking of
 * `dns`/`net` here: these are real DNS lookups and real (loopback) sockets,
 * which is the only way to actually prove the pinning behavior end to end.
 */
import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isPublicAddress, assertValidWebhookUrl, safeHttpRequest, UnsafeWebhookUrlError } from "./urlSafety";

describe("isPublicAddress", () => {
  it("rejects loopback, RFC1918 private ranges, and the cloud metadata link-local address", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.5.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "255.255.255.255"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it("rejects IPv6 loopback, unique-local, and link-local addresses, including IPv4-mapped private addresses", () => {
    for (const ip of ["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it("accepts ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isPublicAddress(ip)).toBe(true);
    }
  });
});

describe("assertValidWebhookUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertValidWebhookUrl("ftp://example.com/hook")).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertValidWebhookUrl("not a url")).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it("rejects embedded credentials", async () => {
    await expect(assertValidWebhookUrl("https://user:pass@example.com/hook")).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it("rejects a literal private/loopback IP", async () => {
    await expect(assertValidWebhookUrl("http://127.0.0.1:9999/hook")).rejects.toThrow(/private\/internal address/);
    await expect(assertValidWebhookUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private\/internal address/);
  });

  it("rejects a hostname that resolves only to loopback (e.g. 'localhost')", async () => {
    await expect(assertValidWebhookUrl("http://localhost:9999/hook")).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it("accepts a literal public IP", async () => {
    await expect(assertValidWebhookUrl("https://8.8.8.8/hook")).resolves.toBeUndefined();
  });
});

describe("safeHttpRequest", () => {
  it("refuses to connect to a literal private address without ever opening a socket", async () => {
    // No server is listening on this port — if safeHttpRequest actually
    // tried to connect, it would get ECONNREFUSED, not our SSRF error. Getting
    // our specific error proves the request was blocked before dialing out.
    await expect(
      safeHttpRequest("http://127.0.0.1:1/hook", { method: "POST", headers: {}, body: "{}", signal: new AbortController().signal }),
    ).rejects.toThrow(/private\/internal address/);
  });

  it("refuses to connect to a hostname that only resolves to loopback", async () => {
    await expect(
      safeHttpRequest("http://localhost:1/hook", { method: "POST", headers: {}, body: "{}", signal: new AbortController().signal }),
    ).rejects.toThrow(Error);
  });

  it("blocks a real, actually-listening loopback server too — reachability doesn't grant a bypass", async () => {
    // The point being proven here: it's not that 127.0.0.1:1 above happened
    // to have nothing listening — even a server that is genuinely up and
    // would happily respond gets rejected before a socket is ever opened to
    // it, because the address itself is private. The happy-path proof (a
    // real signed delivery reaching a real receiver) lives in
    // webhook-delivery-e2e.test.ts, which mocks *only* this SSRF gate so that
    // its receiver's necessarily-loopback address is treated as if it were
    // the subscriber's real public endpoint.
    let server: Server | undefined;
    try {
      server = createServer((req, res) => { res.writeHead(200); res.end("ok"); });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      await expect(
        safeHttpRequest(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: {}, body: "{}", signal: new AbortController().signal }),
      ).rejects.toThrow(/private\/internal address/);
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    }
  });
});
