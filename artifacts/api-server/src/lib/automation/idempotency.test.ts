/**
 * Idempotency-key middleware — claim-first-insert-wins replay/conflict/
 * staleness logic, tested against a mocked db (no real Postgres), mirroring
 * the fake-db pattern used by publishing-workflow.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = {
    selectQueue: [] as any[][],
    insertError: null as any,
    inserts: [] as any[],
    updates: [] as any[],
    deletes: [] as any[],
  };
  return {
    fakeState: state,
    resetFakeState: () => {
      state.selectQueue = [];
      state.insertError = null;
      state.inserts = [];
      state.updates = [];
      state.deletes = [];
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
        where: () => ({
          limit: () => thenable(fakeState.selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        fakeState.inserts.push(v);
        if (fakeState.insertError) {
          const err = fakeState.insertError;
          fakeState.insertError = null;
          return { then: (_resolve: any, reject: any) => reject(err) };
        }
        return thenable(undefined);
      },
    }),
    update: () => ({
      set: (setObj: any) => ({
        where: () => {
          fakeState.updates.push(setObj);
          return { catch: () => {} };
        },
      }),
    }),
    delete: () => ({
      where: () => {
        fakeState.deletes.push(true);
        return thenable(undefined);
      },
    }),
  };
  return { db, idempotencyKeysTable: {} };
});

import { withIdempotency } from "./idempotency";

function fakeReqRes(body: unknown, headerKey: string | undefined) {
  const req = {
    header: (name: string) => (name === "Idempotency-Key" ? headerKey : undefined),
    session: { userId: "user-1" },
    body,
  } as unknown as Request;
  const res: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json: vi.fn(function (this: any, body: unknown) { this.lastJson = body; return this; }),
  };
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("withIdempotency", () => {
  beforeEach(() => resetFakeState());

  it("rejects a request with no Idempotency-Key header", async () => {
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, undefined);
    await mw(req, res as unknown as Response, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("claims a fresh key and calls next() on first use", async () => {
    fakeState.selectQueue.push([]); // loadOrReclaim: no existing row
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fakeState.inserts).toHaveLength(1);
    expect(fakeState.inserts[0]).toMatchObject({ userId: "user-1", endpoint: "automation.createProject", idempotencyKey: "key-abc", status: "in_progress" });
  });

  it("records the handler's eventual response for future replay", async () => {
    fakeState.selectQueue.push([]);
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    res.statusCode = 201;
    res.json({ id: "p1" });
    expect(fakeState.updates).toHaveLength(1);
    expect(fakeState.updates[0]).toMatchObject({ status: "completed", responseStatus: 201, responseBody: { id: "p1" } });
  });

  it("replays the original response for a retry with the identical body", async () => {
    const requestHash = require("crypto").createHash("sha256").update(JSON.stringify({ title: "x" })).digest("hex");
    fakeState.selectQueue.push([{ requestHash, status: "completed", responseStatus: 201, responseBody: { id: "p1" }, updatedAt: new Date() }]);
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.json).toHaveBeenCalledWith({ id: "p1" });
    expect(fakeState.inserts).toHaveLength(0); // no new side effect attempted
  });

  it("rejects a retry that reuses the key with a different body (422)", async () => {
    const otherHash = require("crypto").createHash("sha256").update(JSON.stringify({ title: "different" })).digest("hex");
    fakeState.selectQueue.push([{ requestHash: otherHash, status: "completed", responseStatus: 201, responseBody: { id: "p1" }, updatedAt: new Date() }]);
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    expect(res.statusCode).toBe(422);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 409 while an identical request is still in progress", async () => {
    const requestHash = require("crypto").createHash("sha256").update(JSON.stringify({ title: "x" })).digest("hex");
    fakeState.selectQueue.push([{ requestHash, status: "in_progress", updatedAt: new Date() }]);
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    expect(res.statusCode).toBe(409);
    expect(next).not.toHaveBeenCalled();
  });

  it("reclaims a stale in_progress row (abandoned by a crashed request) and lets the retry through", async () => {
    fakeState.selectQueue.push([{ requestHash: "irrelevant", status: "in_progress", updatedAt: new Date(Date.now() - 5 * 60_000) }]);
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    expect(fakeState.deletes).toHaveLength(1); // stale row cleared
    expect(next).toHaveBeenCalledTimes(1); // treated as a fresh claim
    expect(fakeState.inserts).toHaveLength(1);
  });

  it("scopes the endpoint per-resource when given a function, so the same key+body against a different resource is NOT replayed", async () => {
    // Regression test: a route like POST /automation/projects/:id/repurposing-batches
    // must not dedupe purely on the static route template, or reusing an
    // Idempotency-Key + identical body against a second project would
    // wrongly replay the first project's response instead of acting on the
    // second project.
    const endpointFn = (req: Request) => `POST /automation/projects/${(req.params as any).id}/repurposing-batches`;

    fakeState.selectQueue.push([]); // project A: no existing row
    const mwA = withIdempotency(endpointFn);
    const reqA = { params: { id: "project-a" }, header: (n: string) => (n === "Idempotency-Key" ? "shared-key" : undefined), session: { userId: "user-1" }, body: { count: 1 } } as unknown as Request;
    const resA: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json: vi.fn() };
    const nextA = vi.fn();
    await mwA(reqA, resA as unknown as Response, nextA as unknown as NextFunction);
    expect(nextA).toHaveBeenCalledTimes(1);
    expect(fakeState.inserts[0]).toMatchObject({ endpoint: "POST /automation/projects/project-a/repurposing-batches" });

    // Same key, identical body, but a DIFFERENT project — must be treated as a fresh claim, not a replay.
    fakeState.selectQueue.push([]); // project B: no existing row (proves it looked up a distinct endpoint key)
    const mwB = withIdempotency(endpointFn);
    const reqB = { params: { id: "project-b" }, header: (n: string) => (n === "Idempotency-Key" ? "shared-key" : undefined), session: { userId: "user-1" }, body: { count: 1 } } as unknown as Request;
    const resB: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json: vi.fn() };
    const nextB = vi.fn();
    await mwB(reqB, resB as unknown as Response, nextB as unknown as NextFunction);
    expect(nextB).toHaveBeenCalledTimes(1); // NOT a 200 replay of project A's response
    expect(fakeState.inserts[1]).toMatchObject({ endpoint: "POST /automation/projects/project-b/repurposing-batches" });
  });

  it("handles a concurrent duplicate insert (unique violation) by replaying the winner's response", async () => {
    fakeState.selectQueue.push([]); // first loadOrReclaim: nothing yet
    const requestHash = require("crypto").createHash("sha256").update(JSON.stringify({ title: "x" })).digest("hex");
    fakeState.selectQueue.push([{ requestHash, status: "completed", responseStatus: 201, responseBody: { id: "won-the-race" }, updatedAt: new Date() }]);
    fakeState.insertError = Object.assign(new Error("duplicate key"), { code: "23505" });
    const mw = withIdempotency("automation.createProject");
    const { req, res, next } = fakeReqRes({ title: "x" }, "key-abc");
    await mw(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: "won-the-race" });
  });
});
