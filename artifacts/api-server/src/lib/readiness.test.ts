import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
import { checkReadiness } from "./readiness";

describe("readiness", () => {
  it("passes only when every dependency is ready", async () => {
    const result = await checkReadiness({
      database: vi.fn().mockResolvedValue(undefined),
      storage: vi.fn().mockResolvedValue(undefined),
      configuration: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toEqual({
      ready: true,
      checks: { database: "ok", storage: "ok", configuration: "ok" },
    });
  });

  it("fails closed without leaking dependency error details", async () => {
    const result = await checkReadiness({
      database: vi.fn().mockRejectedValue(new Error("postgres secret")),
      storage: vi.fn().mockResolvedValue(undefined),
      configuration: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.ready).toBe(false);
    expect(result.checks.database).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
