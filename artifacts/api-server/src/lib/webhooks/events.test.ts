/**
 * Event emission — journals every event regardless of subscribers, then fans
 * out a pending delivery to each active, matching subscription. Tested
 * against a mocked db (no real Postgres).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = { selectQueue: [] as any[][], inserts: [] as any[] };
  return {
    fakeState: state,
    resetFakeState: () => { state.selectQueue = []; state.inserts = []; },
  };
});

vi.mock("@workspace/db", () => {
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value) };
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => thenable(fakeState.selectQueue.shift() ?? []),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.inserts.push(v);
        return thenable(undefined);
      },
    }),
  };
  return { db, webhookEventsTable: {}, webhookSubscriptionsTable: {}, webhookDeliveriesTable: {} };
});

import { emitEvent, isValidEventType, EVENT_TYPES } from "./events";

function sub(overrides: Partial<any> = {}) {
  return { id: "sub_1", userId: "user-1", brandId: null, isActive: true, eventTypes: ["*"], ...overrides };
}

describe("isValidEventType", () => {
  it("accepts every catalogued type and rejects unknown strings", () => {
    for (const t of EVENT_TYPES) expect(isValidEventType(t)).toBe(true);
    expect(isValidEventType("not.a.real.event")).toBe(false);
    expect(isValidEventType(123)).toBe(false);
  });
});

describe("emitEvent", () => {
  beforeEach(() => resetFakeState());

  it("journals the event even when there are no subscriptions", async () => {
    fakeState.selectQueue.push([]); // no subscriptions
    await emitEvent({ type: "project.created", userId: "user-1", brandId: "b1", projectId: "p1", data: { projectId: "p1" } });
    expect(fakeState.inserts).toHaveLength(1); // journal only, no deliveries table insert
    expect(fakeState.inserts[0]).toMatchObject({ type: "project.created", userId: "user-1" });
  });

  it("fans out a pending delivery to every active subscription matching the event type", async () => {
    fakeState.selectQueue.push([sub({ id: "sub_1", eventTypes: ["project.created"] }), sub({ id: "sub_2", eventTypes: ["publication.published"] })]);
    await emitEvent({ type: "project.created", userId: "user-1", data: { projectId: "p1" } });
    expect(fakeState.inserts).toHaveLength(2); // journal + deliveries batch
    const deliveries = fakeState.inserts[1];
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ subscriptionId: "sub_1", eventType: "project.created", status: "pending", attemptCount: 0 });
  });

  it("matches a wildcard ('*') subscription against any event type", async () => {
    fakeState.selectQueue.push([sub({ eventTypes: ["*"] })]);
    await emitEvent({ type: "publication.failed", userId: "user-1", data: {} });
    expect(fakeState.inserts[1]).toHaveLength(1);
  });

  it("never emits a secret/credential field into the delivery payload", async () => {
    fakeState.selectQueue.push([sub()]);
    await emitEvent({
      type: "publication.scheduled", userId: "user-1",
      data: { publicationId: "pub1", destinationId: "dest1" },
    });
    const deliveryPayload = JSON.stringify(fakeState.inserts[1][0].payload);
    expect(deliveryPayload).not.toMatch(/secret|apiKey|password|token/i);
  });

  it("never throws even if the db insert fails (best-effort, mirrors logActivity)", async () => {
    fakeState.selectQueue.push([]);
    const badDb = await import("@workspace/db");
    const spy = vi.spyOn(badDb.db, "insert").mockImplementationOnce(() => { throw new Error("db down"); });
    await expect(emitEvent({ type: "project.created", userId: "user-1", data: {} })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
