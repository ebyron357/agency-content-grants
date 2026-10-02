/**
 * Deployment parity: /api/healthz reports the commit of the running build.
 * Deterministic, no database.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/readiness", () => ({ checkReadiness: vi.fn() }));

const { runningCommit } = await import("../routes/health");

describe("runningCommit", () => {
  it("prefers RENDER_GIT_COMMIT and normalises case", () => {
    expect(
      runningCommit({
        RENDER_GIT_COMMIT: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
        GIT_COMMIT: "1111111",
      } as NodeJS.ProcessEnv),
    ).toBe("abcdef1234567890abcdef1234567890abcdef12");
  });

  it("falls back to GIT_COMMIT", () => {
    expect(runningCommit({ GIT_COMMIT: "fac3cb9" } as NodeJS.ProcessEnv)).toBe(
      "fac3cb9",
    );
  });

  it("returns null when unset or not a commit SHA", () => {
    expect(runningCommit({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      runningCommit({ GIT_COMMIT: "main; rm -rf /" } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
