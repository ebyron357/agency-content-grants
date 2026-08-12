/**
 * Real end-to-end webhook delivery test: a genuine local HTTP server acts as
 * the subscriber ("test receiver"), and attemptDelivery() makes a real
 * network POST to it and the receiver verifies the Standard Webhooks
 * signature itself, exactly as a real n8n workflow would. Only the
 * persistence layer is faked (no live Postgres needed for a fast/hermetic
 * test run), matching every other "integration test" in this suite —
 * see publishing-workflow.test.ts's file-level comment for the same rationale.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = { selectQueue: [] as any[][], returningQueue: [] as any[][], updates: [] as any[], inserts: [] as any[] };
  return {
    fakeState: state,
    resetFakeState: () => { state.selectQueue = []; state.returningQueue = []; state.updates = []; state.inserts = []; },
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
      values: (v: any) => { fakeState.inserts.push(v); return thenable(undefined); },
    }),
  };
  return { db, webhookDeliveriesTable: {}, webhookSubscriptionsTable: {}, webhookDeliveryAttemptsTable: {} };
});

// This test's whole point is a real HTTP round trip to a real local receiver
// — but that receiver, being a Node test server, can only ever bind to a
// loopback address, and urlSafety.ts's SSRF protection correctly refuses to
// dial any loopback/private address (proven separately in
// urlSafety.test.ts). So here we swap in a bare, unprotected HTTP client
// that does no address validation, standing in for "the destination is some
// real, validated public subscriber URL" — everything else (signing, retry
// bookkeeping, response handling) is the exact same delivery.ts code path.
vi.mock("../lib/webhooks/urlSafety", () => ({
  safeHttpRequest: (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
    new Promise((resolve, reject) => {
      const req = require("node:http").request(url, { method: init.method, headers: init.headers }, (res: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ ok: (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, text: async () => Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.write(init.body);
      req.end();
    }),
}));

import { attemptDelivery } from "../lib/webhooks/delivery";
import { generateWebhookSecret, verifyWebhookSignature } from "../lib/webhooks/signing";

describe("real end-to-end webhook delivery to a test HTTP receiver", () => {
  let server: Server;
  let receiverUrl: string;
  let received: { headers: Record<string, string | undefined>; rawBody: string }[] = [];
  let respondWith = 200;

  beforeEach(async () => {
    resetFakeState();
    received = [];
    respondWith = 200;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers as any, rawBody: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(respondWith, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: respondWith < 300 }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    receiverUrl = `http://127.0.0.1:${port}/n8n-webhook`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers a real signed HTTP POST that the receiver can independently verify, and marks it delivered", async () => {
    const secret = generateWebhookSecret();
    const delivery = {
      id: "whd_e2e_1", subscriptionId: "sub_1", eventId: "evt_e2e_1", eventType: "project.created",
      payload: { id: "evt_e2e_1", type: "project.created", createdAt: new Date().toISOString(), data: { projectId: "p1", projectTitle: "Demo project" } },
      status: "pending", attemptCount: 0, nextAttemptAt: new Date(), lastAttemptAt: null,
      lastError: null, lastResponseStatus: null, claimedAt: null, claimToken: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    fakeState.returningQueue.push([delivery]); // claim succeeds
    fakeState.selectQueue.push([{ id: "sub_1", userId: "user-1", url: receiverUrl, secret, eventTypes: ["*"], isActive: true }]);
    fakeState.returningQueue.push([{ ...delivery, status: "delivered" }]); // finalize succeeds

    await attemptDelivery(delivery as any);

    // The receiver actually got one real HTTP POST over the network.
    expect(received).toHaveLength(1);
    const { headers, rawBody } = received[0];
    expect(JSON.parse(rawBody)).toEqual(delivery.payload);

    // The receiver independently verifies the signature exactly as a real
    // n8n/external subscriber would, per docs/automation-api.md.
    const id = headers["webhook-id"] as string;
    const timestamp = Number(headers["webhook-timestamp"]);
    const signature = headers["webhook-signature"] as string;
    expect(id).toBe(delivery.id);
    expect(verifyWebhookSignature(secret, id, timestamp, rawBody, signature)).toBe(true);
    // A subscriber using the wrong secret must reject it.
    expect(verifyWebhookSignature(generateWebhookSecret(), id, timestamp, rawBody, signature)).toBe(false);

    // And our own side recorded the delivery as successfully delivered.
    const finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate).toMatchObject({ status: "delivered", attemptCount: 1, lastResponseStatus: 200 });
    expect(fakeState.inserts[0]).toMatchObject({ outcome: "success", httpStatus: 200 });
  });

  it("retries safely (no duplicate delivery) when the receiver is unreachable, then succeeds once it's back", async () => {
    const secret = generateWebhookSecret();
    await new Promise<void>((resolve) => server.close(() => resolve())); // simulate receiver being down
    const delivery = {
      id: "whd_e2e_2", subscriptionId: "sub_1", eventId: "evt_e2e_2", eventType: "project.created",
      payload: { id: "evt_e2e_2", type: "project.created", data: {} },
      status: "pending", attemptCount: 0, nextAttemptAt: new Date(), lastAttemptAt: null,
      lastError: null, lastResponseStatus: null, claimedAt: null, claimToken: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    fakeState.returningQueue.push([delivery]);
    fakeState.selectQueue.push([{ id: "sub_1", userId: "user-1", url: receiverUrl, secret, eventTypes: ["*"], isActive: true }]);
    fakeState.returningQueue.push([{ ...delivery, status: "pending" }]);

    await attemptDelivery(delivery as any);
    let finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate.status).toBe("pending"); // scheduled for retry, not lost
    expect(finalizeUpdate.attemptCount).toBe(1);

    // Bring the receiver back and simulate the scheduled retry.
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => { received.push({ headers: req.headers as any, rawBody: Buffer.concat(chunks).toString("utf8") }); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    receiverUrl = `http://127.0.0.1:${port}/n8n-webhook`;

    const retried = { ...delivery, attemptCount: 1, status: "pending" };
    fakeState.returningQueue.push([retried]);
    fakeState.selectQueue.push([{ id: "sub_1", userId: "user-1", url: receiverUrl, secret, eventTypes: ["*"], isActive: true }]);
    fakeState.returningQueue.push([{ ...retried, status: "delivered" }]);

    await attemptDelivery(retried as any);
    finalizeUpdate = fakeState.updates[fakeState.updates.length - 1];
    expect(finalizeUpdate.status).toBe("delivered");
    expect(finalizeUpdate.attemptCount).toBe(2);
    // Exactly one successful delivery attempt was recorded for the retry (no duplicate side effect beyond the single retried send).
    expect(received).toHaveLength(1);
  });
});
