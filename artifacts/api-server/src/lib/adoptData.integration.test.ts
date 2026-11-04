/**
 * The shared admin row is created on first use. Concurrent first requests
 * (a fresh deploy, or parallel test files) must all get the same row instead
 * of one failing on the unique username.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { ensureNamedUser } from "./adoptData";

const USERNAME = `race-test-${Date.now()}`;

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.username, USERNAME));
});

describe("ensureNamedUser", () => {
  it("creates one row when called ten times at once", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => ensureNamedUser(USERNAME)));
    expect(new Set(ids).size).toBe(1);
    expect(await db.select().from(usersTable).where(eq(usersTable.username, USERNAME))).toHaveLength(1);
    expect(await ensureNamedUser(USERNAME)).toBe(ids[0]);
  });
});
