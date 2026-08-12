/**
 * Auth unit tests — deterministic, no database, no real AI.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../lib/password";

describe("password utilities", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("securepassword123");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    const valid = await verifyPassword("securepassword123", hash);
    expect(valid).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correctPassword");
    const valid = await verifyPassword("wrongPassword", hash);
    expect(valid).toBe(false);
  });

  it("produces a different hash for the same password (unique salt)", async () => {
    const hash1 = await hashPassword("samepassword");
    const hash2 = await hashPassword("samepassword");
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword("samepassword", hash1)).toBe(true);
    expect(await verifyPassword("samepassword", hash2)).toBe(true);
  });

  it("returns false for a malformed hash", async () => {
    const valid = await verifyPassword("any", "not-a-valid-hash");
    expect(valid).toBe(false);
  });
});

describe("requireAuth middleware", () => {
  it("calls next() when session.authenticated is true", async () => {
    const { requireAuth } = await import("../middleware/requireAuth");
    const req: any = { session: { authenticated: true, userId: "user-123" } };
    const res: any = { status: () => res, json: () => res };
    let called = false;
    requireAuth(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it("returns 401 when session has no authenticated flag", async () => {
    const { requireAuth } = await import("../middleware/requireAuth");
    const req: any = { session: {} };
    let statusCode = 0;
    let body: any = null;
    const res: any = {
      status(code: number) { statusCode = code; return this; },
      json(b: any) { body = b; return this; },
    };
    requireAuth(req, res, () => { throw new Error("should not be called"); });
    expect(statusCode).toBe(401);
    expect(body.error).toBeDefined();
  });

  it("returns 401 when session is absent", async () => {
    const { requireAuth } = await import("../middleware/requireAuth");
    const req: any = { session: null };
    let statusCode = 0;
    const res: any = {
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    };
    requireAuth(req, res, () => {});
    expect(statusCode).toBe(401);
  });
});
