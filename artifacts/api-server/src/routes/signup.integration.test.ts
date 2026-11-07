/**
 * Self sign-up against the real test database, through the real router and a
 * real express-session (docs/SELF_SIGNUP.md). Emails are captured by a test
 * transport instead of being sent; every name and address is synthetic.
 *
 * - Off (the default): every sign-up route is a 404 and nothing is written.
 * - On: a sign-up becomes a member, an isolated client workspace with that
 *   member as owner, and a session, only after the emailed link is opened.
 * - The answer never shows whether an email already has an account.
 * - Per-address and per-email limits, the honeypot, single-use and expiring links.
 * - With billing on, the new workspace starts the free trial.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { activityLogTable, brandsTable, db, membersTable, pendingSignupsTable, usersTable, workspaceSubscriptionsTable, workspacesTable } from "@workspace/db";
import { router } from "./index";
import { setEmailTransportForTests, type EmailMessage } from "../lib/email/transport";
import { hashPassword } from "../lib/password";

let server: Server;
let base = "";
const PASSWORD = "Correct horse battery staple 42";
const STAMP = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DOMAIN = `signup-${STAMP}.example`;
const outbox: EmailMessage[] = [];
const ENV_KEYS = ["SELF_SIGNUP_ENABLED", "APP_BASE_URL", "EMAIL_PROVIDER", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "BILLING_DISABLED", "SELF_SIGNUP_TRIAL_PLAN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

/**
 * Rate-limit counters live in the shared test database and outlast a run, so each
 * person here signs up from a fresh address in the RFC 2544 benchmarking range.
 */
const freshAddress = () => `198.18.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;

function buildApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "signup-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  return app;
}

function person(address = freshAddress()) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "X-Forwarded-For": address, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data: data as any };
  };
}

function turnOn() {
  process.env.SELF_SIGNUP_ENABLED = "true";
  process.env.APP_BASE_URL = "https://grantcrest.test";
  setEmailTransportForTests({ name: "test", send: async (m) => void outbox.push(m) });
}

function turnOff() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  delete process.env.SELF_SIGNUP_ENABLED;
  setEmailTransportForTests(null);
}

const tokenFrom = (m: EmailMessage) => /#token=([A-Za-z0-9_-]+)/.exec(m.text)?.[1] ?? "";
const lastTo = (email: string) => [...outbox].reverse().find((m) => m.to === email);
const signupBody = (email: string, extra: Record<string, unknown> = {}) => ({ name: "Sam Synthetic", organizationName: `Synthetic Org ${STAMP}`, email, password: PASSWORD, ...extra });

beforeAll(() => {
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => turnOff());

afterAll(async () => {
  turnOff();
  server?.close();
  const members = await db.select().from(membersTable).where(like(membersTable.email, `%@${DOMAIN}`));
  const ws = await db.select().from(workspacesTable).where(like(workspacesTable.name, `%${STAMP}%`));
  await db.delete(pendingSignupsTable).where(like(pendingSignupsTable.email, `%@${DOMAIN}`));
  if (members.length) await db.delete(membersTable).where(inArray(membersTable.id, members.map((m) => m.id)));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

describe("self sign-up switched off (the default)", () => {
  it("changes nothing: no sign-up offered, every route a 404, nothing written", async () => {
    const visitor = person();
    const before = (await db.select({ id: workspacesTable.id }).from(workspacesTable)).length;
    expect((await visitor("GET", "/auth/signup/status")).data).toEqual({ enabled: false });
    const attempt = await visitor("POST", "/auth/signup", signupBody(`off@${DOMAIN}`));
    expect(attempt.status).toBe(404);
    expect((await visitor("POST", "/auth/signup/verify", { token: "x".repeat(43) })).status).toBe(404);
    expect(await db.select().from(pendingSignupsTable).where(eq(pendingSignupsTable.email, `off@${DOMAIN}`))).toEqual([]);
    expect((await db.select({ id: workspacesTable.id }).from(workspacesTable)).length).toBe(before);
    expect(outbox).toHaveLength(0);
    // Signed-out identity is exactly as before.
    expect((await visitor("GET", "/auth/me")).data).toEqual({ authenticated: false, isAdmin: false, mfaPending: false });
  });

  it("stays off with the flag on but no email provider", async () => {
    process.env.SELF_SIGNUP_ENABLED = "true";
    process.env.APP_BASE_URL = "https://grantcrest.test";
    delete process.env.EMAIL_PROVIDER;
    const visitor = person();
    expect((await visitor("GET", "/auth/signup/status")).data).toEqual({ enabled: false });
    expect((await visitor("POST", "/auth/signup", signupBody(`noemail@${DOMAIN}`))).status).toBe(404);
  });
});

describe("self sign-up switched on", () => {
  it("creates an isolated workspace with the person as owner, only after the email link", async () => {
    turnOn();
    const email = `owner@${DOMAIN}`;
    const visitor = person();
    expect((await visitor("GET", "/auth/signup/status")).data).toEqual({ enabled: true });
    const sent = await visitor("POST", "/auth/signup", signupBody(email));
    expect(sent.status).toBe(202);
    expect(sent.data.status).toBe("check_email");
    // Nothing exists until the link is opened.
    expect(await db.select().from(membersTable).where(eq(membersTable.email, email))).toEqual([]);
    const [pending] = await db.select().from(pendingSignupsTable).where(eq(pendingSignupsTable.email, email));
    expect(pending.passwordHash).not.toContain(PASSWORD);
    const message = lastTo(email)!;
    expect(message.tag).toBe("signup_verify");
    expect(message.text).toContain("https://grantcrest.test/signup/verify#token=");
    const token = tokenFrom(message);
    expect(pending.tokenHash).not.toBe(token);

    const done = await visitor("POST", "/auth/signup/verify", { token });
    expect(done.status).toBe(201);
    expect(done.data).toMatchObject({ authenticated: true, role: "owner" });
    const me = (await visitor("GET", "/auth/me")).data;
    expect(me.member).toMatchObject({ email, name: "Sam Synthetic", mfaEnabled: false });
    expect(me.role).toBe("owner");
    expect(me.workspace).toMatchObject({ name: `Synthetic Org ${STAMP}`, kind: "client", firstRun: true });
    expect(me.permissions).toContain("billing.manage");
    const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, me.workspace.id));
    expect(ws.createdVia).toBe("self_signup");

    // The link works once.
    expect((await person()("POST", "/auth/signup/verify", { token })).status).toBe(404);

    // Audit log: who created what, in the new workspace's own log.
    const audit = (await visitor("GET", "/workspace/audit?category=members")).data.entries.map((e: any) => e.type);
    expect(audit).toEqual(expect.arrayContaining(["workspace_created", "member_joined"]));

    // Isolation: the operator's data is not visible, and the new workspace's data is not visible to the operator.
    const operator = person();
    expect((await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD })).status).toBe(200);
    const brand = (await operator("POST", "/brands", { name: `Operator brand ${STAMP}`, industry: "Isolation fixture" })).data;
    try {
      expect((await visitor("GET", "/brands")).data.map((b: any) => b.id)).not.toContain(brand.id);
      expect((await visitor("GET", `/brands/${brand.id}`)).status).toBe(404);
      const org = (await visitor("POST", "/grants/applicants", { name: `Isolated Org ${STAMP}`, applicantType: "nonprofit_501c3" })).data;
      expect((await operator("GET", `/grants/applicants/${org.id}`)).status).toBe(404);
      expect((await operator("GET", "/grants/applicants")).data.map((a: any) => a.id)).not.toContain(org.id);
    } finally {
      await db.delete(brandsTable).where(eq(brandsTable.id, brand.id));
    }

    // The new owner signs in again with email and password.
    const again = person();
    expect((await again("POST", "/auth/login", { email, password: PASSWORD })).status).toBe(200);
  });

  it("gives the same answer for an email that already has an account, and creates nothing", async () => {
    turnOn();
    const email = `existing@${DOMAIN}`;
    await db.insert(membersTable).values({ id: randomUUID(), email, name: "Already Here", passwordHash: await hashPassword(PASSWORD) });
    const fresh = await person()("POST", "/auth/signup", signupBody(`brand-new@${DOMAIN}`));
    const taken = await person()("POST", "/auth/signup", signupBody(email));
    expect(taken.status).toBe(fresh.status);
    expect(taken.data).toEqual(fresh.data);
    expect(lastTo(email)?.tag).toBe("signup_existing_account");
    expect(lastTo(email)?.text).not.toContain("#token=");
    expect(await db.select().from(pendingSignupsTable).where(eq(pendingSignupsTable.email, email))).toEqual([]);
  });

  it("refuses an account that appeared after sign-up, without creating a workspace", async () => {
    turnOn();
    const email = `race@${DOMAIN}`;
    const visitor = person();
    expect((await visitor("POST", "/auth/signup", signupBody(email))).status).toBe(202);
    const token = tokenFrom(lastTo(email)!);
    await db.insert(membersTable).values({ id: randomUUID(), email, name: "Joined Meanwhile", passwordHash: await hashPassword(PASSWORD) });
    const before = (await db.select({ id: workspacesTable.id }).from(workspacesTable)).length;
    const res = await visitor("POST", "/auth/signup/verify", { token });
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("account_exists");
    expect((await db.select({ id: workspacesTable.id }).from(workspacesTable)).length).toBe(before);
  });

  it("checks the form, and expired or made-up links do not work", async () => {
    turnOn();
    const visitor = person();
    expect((await visitor("POST", "/auth/signup", signupBody(`short@${DOMAIN}`, { password: "short" }))).status).toBe(400);
    expect((await visitor("POST", "/auth/signup", signupBody("not-an-email"))).status).toBe(400);
    expect((await visitor("POST", "/auth/signup", signupBody(`noorg@${DOMAIN}`, { organizationName: " " }))).status).toBe(400);
    const email = `expired@${DOMAIN}`;
    expect((await visitor("POST", "/auth/signup", signupBody(email))).status).toBe(202);
    await db.update(pendingSignupsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pendingSignupsTable.email, email));
    expect((await visitor("POST", "/auth/signup/verify", { token: tokenFrom(lastTo(email)!) })).status).toBe(404);
    expect((await visitor("POST", "/auth/signup/verify", { token: "a".repeat(43) })).data.code).toBe("signup_link_invalid");
    expect((await visitor("POST", "/auth/signup/verify", {})).status).toBe(404);
  });

  it("answers a bot that fills the hidden field like a person, and does nothing", async () => {
    turnOn();
    const email = `bot@${DOMAIN}`;
    const res = await person()("POST", "/auth/signup", signupBody(email, { website: "https://spam.example" }));
    expect(res.status).toBe(202);
    expect(res.data.status).toBe("check_email");
    expect(lastTo(email)).toBeUndefined();
    expect(await db.select().from(pendingSignupsTable).where(eq(pendingSignupsTable.email, email))).toEqual([]);
  });

  it("limits sign-ups per email (3 an hour, from any address) and per address (10 an hour)", async () => {
    turnOn();
    const email = `limited@${DOMAIN}`;
    for (let i = 0; i < 3; i++) expect((await person()("POST", "/auth/signup", signupBody(email))).status).toBe(202);
    const fourth = await person()("POST", "/auth/signup", signupBody(email));
    expect(fourth.status).toBe(429);
    expect(fourth.data.error).toMatch(/Too many sign-up attempts/);
    // Only the newest link for an email is live.
    expect(await db.select().from(pendingSignupsTable).where(eq(pendingSignupsTable.email, email))).toHaveLength(1);

    const oneAddress = person();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await oneAddress("POST", "/auth/signup", signupBody(`ip-${i}@${DOMAIN}`))).status);
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("starts the 14-day free trial when billing is on", async () => {
    turnOn();
    process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_not_a_key";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic";
    delete process.env.BILLING_DISABLED;
    const email = `trial@${DOMAIN}`;
    const visitor = person();
    expect((await visitor("POST", "/auth/signup", signupBody(email))).status).toBe(202);
    const done = await visitor("POST", "/auth/signup/verify", { token: tokenFrom(lastTo(email)!) });
    expect(done.status).toBe(201);
    const [sub] = await db.select().from(workspaceSubscriptionsTable).where(eq(workspaceSubscriptionsTable.workspaceId, done.data.workspace.id));
    expect(sub).toMatchObject({ planKey: "starter", status: "trialing" });
    const days = (sub.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, done.data.workspace.id));
    const trialLog = await db.select().from(activityLogTable).where(eq(activityLogTable.userId, ws.principalUserId));
    expect(trialLog.map((r) => r.type)).toContain("billing_trial_started");
  });

  it("starts no trial and sets no limits when billing is off", async () => {
    turnOn();
    delete process.env.STRIPE_SECRET_KEY;
    const email = `nobilling@${DOMAIN}`;
    const visitor = person();
    expect((await visitor("POST", "/auth/signup", signupBody(email))).status).toBe(202);
    const done = await visitor("POST", "/auth/signup/verify", { token: tokenFrom(lastTo(email)!) });
    expect(done.status).toBe(201);
    expect(await db.select().from(workspaceSubscriptionsTable).where(eq(workspaceSubscriptionsTable.workspaceId, done.data.workspace.id))).toEqual([]);
    // No plan limit: a second organization is allowed.
    for (const n of [1, 2]) expect((await visitor("POST", "/grants/applicants", { name: `No-limit Org ${n} ${STAMP}`, applicantType: "small_business" })).status).toBe(201);
  });
});
