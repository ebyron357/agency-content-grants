import { describe, expect, it } from "vitest";
import { PermanentJobError, afterFailure, errorText, exponentialBackoff, isPermanent } from "./types";

describe("job retry rules", () => {
  it("backs off exponentially with jitter, up to a cap", () => {
    const low = exponentialBackoff(1000, 10_000, () => 0);
    const high = exponentialBackoff(1000, 10_000, () => 1);
    expect([1, 2, 3, 4, 5].map(low)).toEqual([500, 1000, 2000, 4000, 5000]);
    expect([1, 2, 3, 4, 5].map(high)).toEqual([1000, 2000, 4000, 8000, 10_000]);
  });

  it("retries until the attempts are used, and never retries a permanent error", () => {
    const now = Date.UTC(2026, 10, 4);
    expect(afterFailure(1, 3, new Error("timeout"), () => 60_000, now)).toEqual({ status: "queued", runAt: new Date(now + 60_000) });
    expect(afterFailure(3, 3, new Error("timeout"), () => 60_000, now)).toEqual({ status: "failed" });
    expect(afterFailure(1, 3, new PermanentJobError("bad input"), () => 60_000, now)).toEqual({ status: "failed" });
    expect(isPermanent(new Error("x"))).toBe(false);
  });

  it("keeps error text short and readable", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("x".repeat(5000))).toHaveLength(2000);
    expect(errorText("")).toBe("Unknown error");
  });
});
