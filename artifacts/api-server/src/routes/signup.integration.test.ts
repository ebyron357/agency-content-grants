/**
 * Self-serve sign-up end to end against the real test database and router:
 * closed by default, then (with SELF_SERVE_SIGNUP=on) a person creates an
 * account and an organization, lands signed in as its owner, and cannot see
 * another workspace's data. Duplicate emails and weak passwords are refused.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, membersTable, usersTable, workspacesTable } from "@workspace/db";
import { router } from "./index";

let server: Server;
let base = "";
const STAMP = Date.now();
const PASSWORD = "Correct horse battery staple 42";
const EMAIL = `founder-${STAMP}@signup.example`;
const ORG = `Riverside Literacy ${STAMP} (test)`;
/** Each test file signs up from its own documentation-range address (RFC 5737) so the shared rate-limit store does not collide. */
const CLIENT_ADDRESS = "198.51.100.47";

function buildApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "signup-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  return app;
}

function person() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "X-Forwarded-For": CLIENT_ADDRESS, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data: data as any };
  };
}

const previous = process.env.SELF_SERVE_SIGNUP;

beforeAll(() => {
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  if (previous === undefined) delete process.env.SELF_SERVE_SIGNUP;
  else process.env.SELF_SERVE_SIGNUP = previous;
});

afterAll(async () => {
  server?.close();
  const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, ORG));
  await db.delete(membersTable).where(eq(membersTable.email, EMAIL));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

describe("self-serve sign-up", () => {
  it("is closed unless the owner turns it on", async () => {
    delete process.env.SELF_SERVE_SIGNUP;
    const visitor = person();
    expect((await visitor("GET", "/auth/me")).data.signupOpen).toBe(false);
    const res = await visitor("POST", "/auth/signup", { name: "Ada", email: EMAIL, password: PASSWORD, organization: ORG });
    expect(res.status).toBe(404);
    const [member] = await db.select().from(membersTable).where(eq(membersTable.email, EMAIL));
    expect(member).toBeUndefined();
  });

  it("refuses missing details and weak passwords without creating anything", async () => {
    process.env.SELF_SERVE_SIGNUP = "on";
    const visitor = person();
    expect((await visitor("POST", "/auth/signup", { email: EMAIL, password: PASSWORD, organization: ORG })).status).toBe(400);
    expect((await visitor("POST", "/auth/signup", { name: "Ada", email: "not-an-email", password: PASSWORD, organization: ORG })).status).toBe(400);
    expect((await visitor("POST", "/auth/signup", { name: "Ada", email: EMAIL, password: PASSWORD })).status).toBe(400);
    const weak = await visitor("POST", "/auth/signup", { name: "Ada", email: EMAIL, password: "short", organization: ORG });
    expect(weak.status).toBe(400);
    expect(weak.data.error).toMatch(/12 characters/);
    const [member] = await db.select().from(membersTable).where(eq(membersTable.email, EMAIL));
    expect(member).toBeUndefined();
  });

  it("creates the account and organization and signs the person in as its owner", async () => {
    process.env.SELF_SERVE_SIGNUP = "on";
    const founder = person();
    expect((await founder("GET", "/auth/me")).data.signupOpen).toBe(true);
    const res = await founder("POST", "/auth/signup", { name: "Ada Founder", email: EMAIL.toUpperCase(), password: PASSWORD, organization: ORG });
    expect(res.status).toBe(201);
    expect(res.data.role).toBe("owner");
    const me = (await founder("GET", "/auth/me")).data;
    expect(me.authenticated).toBe(true);
    expect(me.isAdmin).toBe(false);
    expect(me.member.email).toBe(EMAIL);
    expect(me.workspace.name).toBe(ORG);
    expect(me.workspace.kind).toBe("client");
    expect(me.role).toBe("owner");
    // The new workspace starts empty: none of the agency's or other clients' data.
    const brands = await founder("GET", "/brands");
    expect(brands.status).toBe(200);
    expect(brands.data).toEqual([]);
    // Signing out and back in works with the new email and password.
    await founder("POST", "/auth/logout");
    expect((await founder("POST", "/auth/login", { email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it("refuses a second account for the same email", async () => {
    process.env.SELF_SERVE_SIGNUP = "on";
    const res = await person()("POST", "/auth/signup", { name: "Someone Else", email: EMAIL, password: PASSWORD, organization: "Another org (test)" });
    expect(res.status).toBe(409);
    expect(res.data.error).toMatch(/already exists/);
    const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, "Another org (test)"));
    expect(ws).toHaveLength(0);
  });
});
