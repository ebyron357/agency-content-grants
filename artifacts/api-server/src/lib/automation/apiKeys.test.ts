/**
 * API key generation/hashing/verification — pure crypto plus a mocked db
 * lookup (no real Postgres).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fakeState, resetFakeState } = vi.hoisted(() => {
  const state = { selectQueue: [] as any[][], updates: [] as any[] };
  return {
    fakeState: state,
    resetFakeState: () => { state.selectQueue = []; state.updates = []; },
  };
});

vi.mock("@workspace/db", () => {
  function thenable(value: any) {
    return { then: (resolve: any) => resolve(value) };
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => thenable(fakeState.selectQueue.shift() ?? []) }),
      }),
    }),
    update: () => ({
      set: (setObj: any) => ({
        where: () => { fakeState.updates.push(setObj); return { catch: () => {} }; },
      }),
    }),
  };
  return { db, apiKeysTable: {} };
});

import { generateApiKey, hashApiKey, verifyApiKey } from "./apiKeys";

describe("generateApiKey", () => {
  it("produces a cmk_live_-prefixed raw key distinct from its hash", () => {
    const { raw, hash, displayPrefix } = generateApiKey();
    expect(raw).toMatch(/^cmk_live_/);
    expect(hash).not.toEqual(raw);
    expect(raw.startsWith(displayPrefix)).toBe(true);
  });

  it("generates unique keys each call", () => {
    expect(generateApiKey().raw).not.toEqual(generateApiKey().raw);
  });

  it("hashApiKey is deterministic", () => {
    const { raw } = generateApiKey();
    expect(hashApiKey(raw)).toBe(hashApiKey(raw));
  });
});

describe("verifyApiKey", () => {
  beforeEach(() => resetFakeState());

  it("rejects a key without the expected prefix without touching the db", async () => {
    const result = await verifyApiKey("not-a-real-key");
    expect(result).toBeNull();
    expect(fakeState.selectQueue).toHaveLength(0);
  });

  it("returns null when no matching non-revoked row exists", async () => {
    fakeState.selectQueue.push([]);
    const { raw } = generateApiKey();
    expect(await verifyApiKey(raw)).toBeNull();
  });

  it("returns the row and stamps lastUsedAt on a valid key", async () => {
    const { raw, hash } = generateApiKey();
    fakeState.selectQueue.push([{ id: "key1", keyHash: hash, scopes: ["read"] }]);
    const result = await verifyApiKey(raw);
    expect(result).toMatchObject({ id: "key1" });
    expect(fakeState.updates).toHaveLength(1);
    expect(fakeState.updates[0]).toHaveProperty("lastUsedAt");
  });
});
