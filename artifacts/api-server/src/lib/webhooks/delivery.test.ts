/**
 * Webhook delivery retry/backoff/claim logic, tested against a mocked db and
 * a mocked safeHttpRequest (no real Postgres or network) — mirrors the
 * fake-db pattern used by publishing-workflow.test.ts for the Content
 * Distribution Engine, which this delivery logic intentionally copies.
 * safeHttpRequest itself (the SSRF-blocking address resolution/pinning) has
 * its own dedicated tests in urlSafety.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./urlSafety", () => ({ safeHttpRequest: vi.fn() }));
import { safeHttpRequest } from "./urlSafety";

function fakeResponse(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = {
    selectQueue: [] as any[][],
    returningQueue: [] as any[][],
    updates: [] as any[],
    inserts: [] as any[],
  };
  return {
    fakeState: state,
    resetFakeState: () => {
      state.selectQueue = [];
      state.returningQueue = [];
      state.updates = [];
      state.inserts = [];
    },
  };
});

vi.mock("@workspace/db", () => {
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value) };
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const result = fakeState.selectQueue.shift() ?? [];
          return Object.assign(thenable(result), { limit: (n: number) => thenable(result.slice(0, n)) });
        },
      }),
    }),
    update: () => ({
      set: (setObj: any) => ({
        where: () => {
          fakeState.updates.push(setObj);
          return Object.assign(thenable(undefined), { returning: () => thenable(fakeState.returningQueue.shift() ?? []) });
        },
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.inserts.push(v);
        return thenable(undefined);
      },
    }),
  };
  return { db, webhookDeliveriesTable: {}, webhookSubscriptionsTable: {}, webhookDeliveryAttemptsTable: {} };
});

import { attemptDelivery, reclaimStaleDeliveryClaims, backoffForAttempt, MAX_ATTEMPTS, RETRY_BACKOFF_MS } from "./delivery";

function baseDelivery(overrides: Partial<any> = {}) {
  return {
    id: "whd_1", subscriptionId: "sub_1", eventId: "evt_1", eventType: "project.created",
    payload: { id: "evt_1", type: "project.created", data: {} },
    status: "pending", attemptCount: 0, nextAttemptAt: new Date(), lastAttemptAt: null,
    lastError: null, lastResponseStatus: null, claimedAt: null, claimToken: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function baseSubscription(overrides: Partial<any> = {}) {
  return { id: "sub_1", userId: "user-1", url: "https://example.com/hook", secret: "whsec_" + Buffer.from("s").toString("base64"), eventTypes: ["*"], isActive: true, ...overrides };
}

describe("backoffForAttempt", () => {
  it("returns increasing backoff for later attempts, capped at the last entry", () => {
    expect(backoffForAttempt(1)).toBe(RETRY_BACKOFF_MS[0]);
    expect(backoffForAttempt(MAX_ATTEMPTS)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    expect(backoffForAttempt(MAX_ATTEMPTS + 10)).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
  });
});

describe("attemptDelivery", () => {
  beforeEach(() => {
    resetFakeState();
    vi.restoreAllMocks();
    vi.mocked(safeHttpRequest).mockReset();
  });

  it("does nothing if it loses the claim race (delivery no longer pending)", async () => {
    fakeState.returningQueue.push([]); // claim update matches zero rows
    await attemptDelivery(baseDelivery());
    expect(safeHttpRequest).not.toHaveBeenCalled();
  });

  it("marks delivered and records a success attempt on HTTP 2xx", async () => {
    const claimed = baseDelivery({ claimToken: "tok1", attemptCount: 0 });
    fakeState.returningQueue.push([claimed]); // claim succeeds
    fakeState.selectQueue.push([baseSubscription()]);
    fakeState.returningQueue.push([{ ...claimed, status: "delivered" }]); // finalize succeeds
    vi.mocked(safeHttpRequest).mockResolvedValue(fakeResponse(200, "ok"));

    await attemptDelivery(claimed);

    const finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate).toMatchObject({ status: "delivered", attemptCount: 1, lastResponseStatus: 200 });
    expect(fakeState.inserts).toHaveLength(1);
    expect(fakeState.inserts[0]).toMatchObject({ outcome: "success", httpStatus: 200 });
  });

  it("signs the outgoing request with Standard Webhooks headers", async () => {
    const claimed = baseDelivery({ claimToken: "tok1" });
    const subscription = baseSubscription();
    fakeState.returningQueue.push([claimed]);
    fakeState.selectQueue.push([subscription]);
    fakeState.returningQueue.push([claimed]);
    vi.mocked(safeHttpRequest).mockResolvedValue(fakeResponse(200, "ok"));

    await attemptDelivery(claimed);

    expect(safeHttpRequest).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(safeHttpRequest).mock.calls[0];
    expect(url).toBe(subscription.url);
    const headers = init!.headers as Record<string, string>;
    expect(headers["webhook-id"]).toBe(claimed.id);
    expect(headers["webhook-signature"]).toMatch(/^v1,/);
  });

  it("schedules a backoff retry (stays pending) on a non-2xx response before exhausting attempts", async () => {
    const claimed = baseDelivery({ claimToken: "tok1", attemptCount: 0 });
    fakeState.returningQueue.push([claimed]);
    fakeState.selectQueue.push([baseSubscription()]);
    fakeState.returningQueue.push([{ ...claimed, status: "pending" }]);
    vi.mocked(safeHttpRequest).mockResolvedValue(fakeResponse(500, "nope"));

    await attemptDelivery(claimed);

    const finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate.status).toBe("pending");
    expect(finalizeUpdate.attemptCount).toBe(1);
    expect(finalizeUpdate.nextAttemptAt).toBeInstanceOf(Date);
    expect(fakeState.inserts[0]).toMatchObject({ outcome: "failure", httpStatus: 500 });
  });

  it("marks failed (terminal) once MAX_ATTEMPTS is reached", async () => {
    const claimed = baseDelivery({ claimToken: "tok1", attemptCount: MAX_ATTEMPTS - 1 });
    fakeState.returningQueue.push([claimed]);
    fakeState.selectQueue.push([baseSubscription()]);
    fakeState.returningQueue.push([{ ...claimed, status: "failed" }]);
    vi.mocked(safeHttpRequest).mockResolvedValue(fakeResponse(500, "nope"));

    await attemptDelivery(claimed);

    const finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate.status).toBe("failed");
    expect(finalizeUpdate.attemptCount).toBe(MAX_ATTEMPTS);
  });

  it("treats a network error the same as a failed HTTP response (retryable, no duplicate side effect)", async () => {
    const claimed = baseDelivery({ claimToken: "tok1", attemptCount: 0 });
    fakeState.returningQueue.push([claimed]);
    fakeState.selectQueue.push([baseSubscription()]);
    fakeState.returningQueue.push([{ ...claimed, status: "pending" }]);
    vi.mocked(safeHttpRequest).mockRejectedValue(new Error("ECONNREFUSED"));

    await attemptDelivery(claimed);

    expect(fakeState.inserts[0]).toMatchObject({ outcome: "failure", errorMessage: "ECONNREFUSED" });
  });

  it("treats an SSRF-blocked destination (private/internal address) as a delivery failure, not a crash", async () => {
    const claimed = baseDelivery({ claimToken: "tok1", attemptCount: 0 });
    fakeState.returningQueue.push([claimed]);
    fakeState.selectQueue.push([baseSubscription({ url: "http://169.254.169.254/steal-creds" })]);
    fakeState.returningQueue.push([{ ...claimed, status: "pending" }]);
    vi.mocked(safeHttpRequest).mockRejectedValue(new Error("refusing to connect to private/internal address 169.254.169.254"));

    await attemptDelivery(claimed);

    expect(fakeState.inserts[0]).toMatchObject({ outcome: "failure" });
    expect(fakeState.inserts[0].errorMessage).toMatch(/private\/internal address/);
  });

  it("fails closed (does not call the subscriber) if the subscription was deleted/deactivated mid-flight", async () => {
    const claimed = baseDelivery({ claimToken: "tok1" });
    fakeState.returningQueue.push([claimed]); // claim succeeds
    fakeState.selectQueue.push([]); // subscription gone
    fakeState.returningQueue.push([{ ...claimed, status: "failed" }]);

    await attemptDelivery(claimed);

    expect(safeHttpRequest).not.toHaveBeenCalled();
    const finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate.status).toBe("failed");
  });
});

describe("reclaimStaleDeliveryClaims", () => {
  beforeEach(() => resetFakeState());

  it("puts abandoned 'delivering' claims back to pending so they retry", async () => {
    const stale = baseDelivery({ status: "delivering", claimToken: "tok-abandoned", claimedAt: new Date(Date.now() - 10 * 60_000) });
    fakeState.selectQueue.push([stale]);
    await reclaimStaleDeliveryClaims(new Date());
    expect(fakeState.updates).toHaveLength(1);
    expect(fakeState.updates[0]).toMatchObject({ status: "pending", claimToken: null });
  });
});
