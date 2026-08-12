/**
 * API-key-or-session auth gate for /api/automation/* routes, and the
 * per-scope authorization check. Mocks verifyApiKey (its own unit tests
 * cover hashing/lookup) so this stays focused on the middleware's control
 * flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/automation/apiKeys", () => ({ verifyApiKey: vi.fn() }));

import { verifyApiKey } from "../lib/automation/apiKeys";
import { requireApiKeyOrSession, requireScope, getAutomationUserId } from "./requireApiKeyOrSession";

function fakeReqRes(headers: Record<string, string> = {}, session: any = {}) {
  const req: any = { header: (name: string) => headers[name.toLowerCase()], session };
  const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
  const next = vi.fn();
  return { req, res, next };
}

describe("requireApiKeyOrSession", () => {
  beforeEach(() => vi.mocked(verifyApiKey).mockReset());

  it("accepts a valid session cookie with no scope restriction", async () => {
    const { req, res, next } = fakeReqRes({}, { authenticated: true, userId: "user-1" });
    await requireApiKeyOrSession(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.automationAuth).toBeUndefined();
    expect(getAutomationUserId(req)).toBe("user-1");
  });

  it("accepts a valid bearer API key and attaches its scopes to req.automationAuth, WITHOUT touching req.session", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ userId: "user-1", scopes: ["read", "projects:write"] } as any);
    const { req, res, next } = fakeReqRes({ authorization: "Bearer cmk_live_abc" }, {});
    await requireApiKeyOrSession(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.automationAuth).toEqual({ userId: "user-1", scopes: ["read", "projects:write"] });
    // The whole point of the fix: a bearer key must never be written into
    // req.session, or express-session would persist it and hand the caller
    // a real, long-lived dashboard session cookie.
    expect(req.session).toEqual({});
    expect(getAutomationUserId(req)).toBe("user-1");
  });

  it("does not let a bearer key overwrite an existing browser session's identity", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({ userId: "api-key-owner", scopes: ["read"] } as any);
    const { req, res, next } = fakeReqRes({ authorization: "Bearer cmk_live_abc" }, { authenticated: true, userId: "logged-in-human" });
    await requireApiKeyOrSession(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    // The session itself is untouched — still the human's identity.
    expect(req.session).toEqual({ authenticated: true, userId: "logged-in-human" });
    // But this specific request is authorized (and scoped) as the API key's owner, not the human.
    expect(getAutomationUserId(req)).toBe("api-key-owner");
    expect(req.automationAuth?.scopes).toEqual(["read"]);
  });

  it("rejects an invalid/revoked bearer key with 401", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue(null);
    const { req, res, next } = fakeReqRes({ authorization: "Bearer cmk_live_bad" }, {});
    await requireApiKeyOrSession(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with neither a session nor a bearer header", async () => {
    const { req, res, next } = fakeReqRes({}, {});
    await requireApiKeyOrSession(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireScope", () => {
  it("is a no-op for session auth (no automationAuth set)", () => {
    const { req, res, next } = fakeReqRes();
    requireScope("projects:write")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows an API key that has the required scope", () => {
    const { req, res, next } = fakeReqRes();
    req.automationAuth = { userId: "user-1", scopes: ["read", "projects:write"] };
    requireScope("projects:write")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 403 for an API key missing the required scope", () => {
    const { req, res, next } = fakeReqRes();
    req.automationAuth = { userId: "user-1", scopes: ["read"] };
    requireScope("publishing:write")(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
