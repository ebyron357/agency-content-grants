/**
 * Integration test for the exact vulnerability class a code review caught:
 * `requireApiKeyOrSession` must authorize a Bearer-key request WITHOUT ever
 * writing to `req.session` — otherwise express-session persists it and mints
 * a real, long-lived `sid` cookie for a bearer caller (surviving key
 * revocation), and a Bearer header could silently hijack an existing human
 * session's identity.
 *
 * This spins up a real Express app (real `express-session` with an in-memory
 * store, real cookie parsing) and makes real HTTP requests to it — only the
 * database and API-key verification are faked, matching the "real end to
 * end" style of webhook-delivery-e2e.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = { inserts: [] as any[] };
  return { fakeState: state, resetFakeState: () => { state.inserts = []; } };
});

vi.mock("@workspace/db", () => {
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value) };
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => Object.assign(thenable([]), { limit: () => thenable([]) }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.inserts.push(v);
        return Object.assign(thenable(undefined), { returning: () => thenable([{ id: "proj-1", ...v }]) });
      },
    }),
    update: () => ({ set: () => ({ where: () => Object.assign(thenable(undefined), { returning: () => thenable([]), catch: () => {} }) }) }),
  };
  return {
    db, brandsTable: {}, projectsTable: {}, documentsTable: {}, documentSectionsTable: {},
    repurposingBatchesTable: {}, repurposedAssetsTable: {}, publishingDestinationsTable: {},
    scheduledPublicationsTable: {}, idempotencyKeysTable: {},
  };
});

vi.mock("../lib/automation/apiKeys", () => ({ verifyApiKey: vi.fn() }));
vi.mock("../lib/webhooks/events", () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/activity", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../middleware/ownershipHelpers", () => ({
  getBrandOwned: vi.fn(async (brandId: string, userId: string) => ({ id: brandId, userId, name: "Test Brand" })),
}));

import { verifyApiKey } from "../lib/automation/apiKeys";
import automationRouter from "./automation";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, name: "sid", cookie: { httpOnly: true } }));
  // Test-only stand-in for the real login route, so this test doesn't depend on ADMIN_PASSWORD/auth.ts.
  app.post("/test/login-as", (req, res) => {
    req.session.userId = (req.body as any).userId;
    req.session.authenticated = true;
    res.json({ ok: true });
  });
  app.post("/test/whoami", (req, res) => {
    res.json({ userId: req.session.userId ?? null, authenticated: req.session.authenticated ?? false });
  });
  app.use("/api", automationRouter);
  return app;
}

function extractCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  return raw ? raw.split(";")[0] : null;
}

// withIdempotency also inserts its own claim row before the handler runs, so
// `fakeState.inserts` interleaves idempotency-claim rows with the actual
// project-insert row — find the project one by shape instead of assuming an index.
function lastProjectInsert() {
  return [...fakeState.inserts].reverse().find((v) => "title" in v);
}

describe("Bearer API-key auth never touches the session (regression for a code-review-caught vuln)", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    resetFakeState();
    vi.mocked(verifyApiKey).mockReset();
    const app = buildApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does not set a session cookie on a Bearer-authenticated response", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ userId: "api-user-1", scopes: ["projects:write"] } as any);

    const res = await fetch(`${baseUrl}/api/automation/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer cmk_live_valid", "idempotency-key": "key-1" },
      body: JSON.stringify({ brandId: "brand-1", title: "Post", contentType: "article" }),
    });

    expect(res.status).toBe(201);
    // The core assertion: no Set-Cookie header at all. saveUninitialized:false
    // means express-session only emits a cookie if something wrote to
    // req.session — a Bearer request must never do that.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(lastProjectInsert()).toMatchObject({ userId: "api-user-1" });
  });

  it("blocks a request immediately once verifyApiKey reports the key as revoked (no residual access)", async () => {
    vi.mocked(verifyApiKey).mockResolvedValueOnce({ userId: "api-user-1", scopes: ["projects:write"] } as any);
    const first = await fetch(`${baseUrl}/api/automation/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer cmk_live_valid", "idempotency-key": "key-2" },
      body: JSON.stringify({ brandId: "brand-1", title: "Post", contentType: "article" }),
    });
    expect(first.status).toBe(201);
    expect(first.headers.get("set-cookie")).toBeNull(); // confirms no session was minted the first request could later replay

    // Key is now revoked — verifyApiKey (a real DB lookup filtered on revokedAt IS NULL in production) starts returning null.
    vi.mocked(verifyApiKey).mockResolvedValue(null);
    const second = await fetch(`${baseUrl}/api/automation/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer cmk_live_valid", "idempotency-key": "key-3" },
      body: JSON.stringify({ brandId: "brand-1", title: "Post 2", contentType: "article" }),
    });
    expect(second.status).toBe(401);
  });

  it("does not let a Bearer header hijack or alter an existing human session's identity", async () => {
    // Establish a real human session first.
    const loginRes = await fetch(`${baseUrl}/test/login-as`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "logged-in-human" }),
    });
    const sessionCookie = extractCookie(loginRes as unknown as Response);
    expect(sessionCookie).toBeTruthy();

    // Send that human's session cookie ALONGSIDE a Bearer header for a different user.
    vi.mocked(verifyApiKey).mockResolvedValue({ userId: "api-key-owner", scopes: ["projects:write"] } as any);
    const actionRes = await fetch(`${baseUrl}/api/automation/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie!,
        authorization: "Bearer cmk_live_other",
        "idempotency-key": "key-4",
      },
      body: JSON.stringify({ brandId: "brand-1", title: "Post", contentType: "article" }),
    });
    expect(actionRes.status).toBe(201);
    // This request was authorized as the API key's owner, per requireApiKeyOrSession's precedence rule...
    expect(lastProjectInsert()).toMatchObject({ userId: "api-key-owner" });

    // ...but the human's own session must be completely unaffected: presenting
    // the SAME original cookie afterward (no Authorization header this time)
    // must still resolve to the original human, not the API key's user.
    const whoami = await fetch(`${baseUrl}/test/whoami`, { method: "POST", headers: { cookie: sessionCookie! } });
    const body = await whoami.json();
    expect(body).toEqual({ userId: "logged-in-human", authenticated: true });
  });
});
