/**
 * Admin access control tests (deterministic, no DB).
 * Covers the requireAdmin middleware that gates mutations of global/shared
 * resources (blueprints, dependency registry, provider tests, model config).
 */
import { describe, it, expect } from "vitest";
import { requireAdmin } from "../middleware/requireAdmin";

function mockRes() {
  const state = { status: 0, body: undefined as unknown };
  const res: any = {
    status(c: number) { state.status = c; return this; },
    json(b: unknown) { state.body = b; return this; },
  };
  return { res, state };
}

describe("requireAdmin middleware", () => {
  it("returns 401 when unauthenticated", () => {
    for (const session of [null, {}, { userId: "" }, { userId: undefined }]) {
      const { res, state } = mockRes();
      requireAdmin({ session } as any, res, () => { state.status = 200; });
      expect(state.status).toBe(401);
    }
  });

  it("returns 403 when authenticated but not admin", () => {
    for (const session of [{ userId: "u1" }, { userId: "u1", isAdmin: false }]) {
      const { res, state } = mockRes();
      requireAdmin({ session } as any, res, () => { state.status = 200; });
      expect(state.status).toBe(403);
      expect((state.body as any).error).toMatch(/admin/i);
    }
  });

  it("passes through when the session is admin", () => {
    const { res, state } = mockRes();
    let called = false;
    requireAdmin({ session: { userId: "u1", isAdmin: true } } as any, res, () => { called = true; });
    expect(called).toBe(true);
    expect(state.status).toBe(0);
  });
});
