/**
 * Security headers on real HTTP responses (deterministic, no DB). Uses the
 * same applySecurityHeaders() call as app.ts on a minimal Express app.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  CONTENT_SECURITY_POLICY,
  STRICT_TRANSPORT_SECURITY,
} from "../middleware/securityHeaders";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>(
    (resolve) => server?.close(() => resolve()) ?? resolve(),
  );
  server = undefined;
});

async function start(env: NodeJS.ProcessEnv): Promise<string> {
  const app = express();
  applySecurityHeaders(app, env);
  app.get("/api/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/media/images/1/file", (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.send("img");
  });
  server = app.listen(0);
  await new Promise<void>((resolve) =>
    server!.once("listening", () => resolve()),
  );
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("security headers", () => {
  it("sets the baseline headers and hides x-powered-by", async () => {
    const base = await start({ NODE_ENV: "development" });
    const res = await fetch(`${base}/api/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("does not restrict the sources the editor needs", () => {
    // Images, YouTube/Vimeo iframes, scripts, styles and fonts stay unrestricted.
    for (const directive of [
      "default-src",
      "img-src",
      "frame-src",
      "script-src",
      "style-src",
      "font-src",
      "connect-src",
    ]) {
      expect(CONTENT_SECURITY_POLICY).not.toContain(directive);
    }
  });

  it("applies to unmatched routes (404) too", async () => {
    const base = await start({ NODE_ENV: "development" });
    const res = await fetch(`${base}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("omits HSTS outside production", async () => {
    const base = await start({ NODE_ENV: "development" });
    const res = await fetch(`${base}/api/healthz`);
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("sends HSTS in production", async () => {
    const base = await start({ NODE_ENV: "production" });
    const res = await fetch(`${base}/api/healthz`);
    expect(res.headers.get("strict-transport-security")).toBe(
      STRICT_TRANSPORT_SECURITY,
    );
  });

  it("lets a route set a stricter CSP for its own response", async () => {
    const base = await start({ NODE_ENV: "production" });
    const res = await fetch(`${base}/api/media/images/1/file`);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});
