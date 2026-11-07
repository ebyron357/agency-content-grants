/**
 * Account security end to end, through the real router with real sessions:
 * two-factor setup and sign-in, single-use codes and recovery codes, signed-in
 * devices and sign-out everywhere, a workspace that requires two-factor, the
 * invitation path for an account with two-factor on, API keys revoked with
 * their creator, and the audit log.
 *
 * The clock is faked for Date only, so each step can use a fresh 30-second code.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { apiKeysTable, db, membersTable, pool, usersTable, workspacesTable } from "@workspace/db";
import { router } from "./index";
import { base32Decode, currentStep, totpAt } from "../lib/mfa";

const STAMP = Date.now();
const WS = `Security test ${STAMP}`;
const WS2 = `Security test second ${STAMP}`;
const email = (who: string) => `${who}-${STAMP}@security.example`;
const PASSWORD = "Two factors beat one factor 8";
let server: Server;
let base = "";
let savedKey: string | undefined;
/**
 * The sign-in rate limits are keyed by client address and stored in the shared test database. Test files run in
 * parallel, so each file signs in from its own documentation-range address (RFC 5737) instead of sharing 127.0.0.1;
 * otherwise sign-ins from other files can fill this file's counter and return 429.
 */
const CLIENT_ADDRESS = "198.51.100.11";

function person() {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130.0", "X-Forwarded-For": CLIENT_ADDRESS, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, headers: res.headers, data: (type.includes("json") ? await res.json() : await res.text()) as any };
  };
  return call;
}

/** Moves the clock to the next 30-second step and returns that step's code. */
function nextCode(secret: string): string {
  vi.setSystemTime(Date.now() + 30_000);
  return totpAt(base32Decode(secret), currentStep());
}

async function signIn(who: string, secret?: string) {
  const p = person();
  const first = await p("POST", "/auth/login", { email: email(who), password: PASSWORD });
  if (secret) {
    expect(first.data).toMatchObject({ mfaRequired: true, authenticated: false });
    expect((await p("POST", "/auth/mfa/verify", { code: nextCode(secret) })).status).toBe(200);
  } else expect(first.status).toBe(200);
  return p;
}

/** This file deliberately fails codes; clear its per-IP counter so reruns start clean. */
const clearMfaLimit = () => pool.query("DELETE FROM rate_limit WHERE prefix = 'mfa'");

beforeAll(async () => {
  await clearMfaLimit();
  savedKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = "security-test-encryption-key-not-for-production";
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use(session({ secret: "security-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.useRealTimers();
  await clearMfaLimit();
  if (savedKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
  else process.env.MFA_ENCRYPTION_KEY = savedKey;
  server?.close();
  const ws = await db.select().from(workspacesTable).where(inArray(workspacesTable.name, [WS, WS2]));
  await db.delete(membersTable).where(like(membersTable.email, `%-${STAMP}@security.example`));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

describe("account security", () => {
  it("turns on two-factor, requires it at sign-in, and refuses reused codes", async () => {
    const operator = person();
    await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
    const created = await operator("POST", "/workspaces", { name: WS, ownerEmail: email("owner") });
    const owner = person();
    expect((await owner("POST", `/auth/invites/${created.data.invitePath.replace("/invite/", "")}/accept`, { name: "Sam Owner", password: PASSWORD })).status).toBe(201);

    expect((await owner("GET", "/account/security")).data).toMatchObject({ mfaEnabled: false, recoveryCodesRemaining: 0, requiredByWorkspace: false, secretsEncrypted: true });
    // The team password has no personal account to secure.
    expect((await operator("GET", "/account/security")).status).toBe(400);
    // Requiring two-factor needs it on your own account first.
    expect((await owner("PATCH", "/workspace", { requireMfa: true })).status).toBe(409);

    const setup = (await owner("POST", "/account/mfa/setup")).data;
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/GrantCrest%3A/);
    const secret = setup.secret.replace(/\s/g, "");
    expect((await owner("POST", "/account/mfa/enable", { code: "000000" })).status).toBe(400);
    const enabled = await owner("POST", "/account/mfa/enable", { code: totpAt(base32Decode(secret), currentStep()) });
    expect(enabled.status).toBe(200);
    const recoveryCodes: string[] = enabled.data.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    const [stored] = await db.select().from(membersTable).where(eq(membersTable.email, email("owner")));
    expect(stored.totpSecret!.startsWith("v1:")).toBe(true);
    expect(stored.totpSecret).not.toContain(secret);

    // Password alone no longer signs in.
    const p = person();
    expect((await p("POST", "/auth/login", { email: email("owner"), password: PASSWORD })).data).toMatchObject({ mfaRequired: true, authenticated: false });
    expect((await p("GET", "/brands")).status).toBe(401);
    expect((await p("GET", "/auth/me")).data).toMatchObject({ authenticated: false, mfaPending: true });
    expect((await p("POST", "/auth/mfa/verify", { code: "123456" })).status).toBe(401);
    const code = nextCode(secret);
    expect((await p("POST", "/auth/mfa/verify", { code })).status).toBe(200);
    expect((await p("GET", "/auth/me")).data).toMatchObject({ authenticated: true, member: { mfaEnabled: true } });
    // The same code cannot sign in a second browser.
    const replay = person();
    await replay("POST", "/auth/login", { email: email("owner"), password: PASSWORD });
    expect((await replay("POST", "/auth/mfa/verify", { code })).status).toBe(401);

    // A recovery code works once.
    const rec = person();
    await rec("POST", "/auth/login", { email: email("owner"), password: PASSWORD });
    expect((await rec("POST", "/auth/mfa/verify", { recoveryCode: recoveryCodes[0].toLowerCase() })).status).toBe(200);
    const again = person();
    await again("POST", "/auth/login", { email: email("owner"), password: PASSWORD });
    expect((await again("POST", "/auth/mfa/verify", { recoveryCode: recoveryCodes[0] })).status).toBe(401);
    expect((await rec("GET", "/account/security")).data.recoveryCodesRemaining).toBe(9);

    // Five wrong codes end the pending sign-in.
    const guesser = person();
    await guesser("POST", "/auth/login", { email: email("owner"), password: PASSWORD });
    for (let i = 0; i < 4; i++) await guesser("POST", "/auth/mfa/verify", { code: "000000" });
    // The per-IP limit (5 failures) applies as well; either way the right code no longer completes this sign-in.
    const late = await guesser("POST", "/auth/mfa/verify", { code: nextCode(secret) });
    expect(late.status).not.toBe(200);
  }, 60_000);

  it("lists signed-in browsers and signs out everywhere else", async () => {
    const [stored] = await db.select().from(membersTable).where(eq(membersTable.email, email("owner")));
    // Turn two-factor off directly for this part, so the sign-ins below need no codes.
    await db.update(membersTable).set({ totpEnabledAt: null, totpSecret: null }).where(eq(membersTable.id, stored.id));
    const laptop = await signIn("owner");
    const phone = await signIn("owner");
    const sessions = (await laptop("GET", "/account/sessions")).data as any[];
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions[0]).toMatchObject({ current: true, device: "Chrome on macOS", workspace: WS });
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const phoneId = (await phone("GET", "/account/sessions")).data.find((s: any) => s.current).id;

    // End one browser, then all the others.
    expect((await laptop("DELETE", `/account/sessions/${phoneId}`)).status).toBe(204);
    expect((await phone("GET", "/brands")).status).toBe(401);
    const tablet = await signIn("owner");
    const ended = await laptop("POST", "/account/sessions/revoke-others");
    expect(ended.data.ended).toBeGreaterThanOrEqual(1);
    expect((await tablet("GET", "/brands")).status).toBe(401);
    expect((await tablet("GET", "/auth/me")).data.authenticated).toBe(false);
    expect((await laptop("GET", "/brands")).status).toBe(200);
    expect((await laptop("GET", "/account/sessions")).data).toHaveLength(1);

    // A password change also ends the other sign-ins.
    const other = await signIn("owner");
    const changed = await laptop("POST", "/auth/password", { currentPassword: PASSWORD, newPassword: "Two factors beat one factor 9" });
    expect(changed.data.otherSessionsEnded).toBe(1);
    expect((await other("GET", "/brands")).status).toBe(401);
    await laptop("POST", "/auth/password", { currentPassword: "Two factors beat one factor 9", newPassword: PASSWORD });
  }, 60_000);

  it("requires two-factor for the whole workspace once an owner turns it on", async () => {
    const owner = await signIn("owner");
    const setup = (await owner("POST", "/account/mfa/setup")).data;
    const ownerSecret = setup.secret.replace(/\s/g, "");
    expect((await owner("POST", "/account/mfa/enable", { code: totpAt(base32Decode(ownerSecret), currentStep()) })).status).toBe(200);
    const invite = await owner("POST", "/workspace/invites", { email: email("writer"), role: "admin" });
    const writer = person();
    expect((await writer("POST", `/auth/invites/${invite.data.invitePath.replace("/invite/", "")}/accept`, { name: "Wren Writer", password: PASSWORD })).status).toBe(201);
    expect((await writer("GET", "/brands")).status).toBe(200);

    expect((await owner("PATCH", "/workspace", { requireMfa: true })).data.requireMfa).toBe(true);
    const blocked = await writer("GET", "/brands");
    expect(blocked.status).toBe(403);
    expect(blocked.data.code).toBe("mfa_enrollment_required");
    expect((await writer("GET", "/auth/me")).data.mfa).toEqual({ required: true, enrollmentRequired: true });
    expect((await writer("GET", "/account/security")).data.requiredByWorkspace).toBe(true);
    const wSetup = (await writer("POST", "/account/mfa/setup")).data;
    const writerSecret = wSetup.secret.replace(/\s/g, "");
    expect((await writer("POST", "/account/mfa/enable", { code: totpAt(base32Decode(writerSecret), currentStep()) })).status).toBe(200);
    expect((await writer("GET", "/brands")).status).toBe(200);
    // It cannot be turned off while the workspace requires it.
    expect((await writer("POST", "/account/mfa/disable", { password: PASSWORD, code: nextCode(writerSecret) })).status).toBe(409);
    const team = (await owner("GET", "/workspace")).data;
    expect(team.members.every((m: any) => m.mfaEnabled)).toBe(true);

    // The writer (an admin) creates an API key; removing them revokes it.
    const key = await writer("POST", "/api-keys", { name: "Writer's n8n", scopes: ["read"] });
    expect(key.status).toBe(201);
    const writerId = team.members.find((m: any) => m.email === email("writer")).id;
    expect((await owner("DELETE", `/workspace/members/${writerId}`)).status).toBe(204);
    const [revoked] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, key.data.id));
    expect(revoked.revokedAt).not.toBeNull();
    expect((await writer("GET", "/brands")).status).toBe(401);

    // An invitation is not a way around two-factor for an existing account.
    const operator = person();
    await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
    const second = await operator("POST", "/workspaces", { name: WS2, ownerEmail: email("owner") });
    const token = second.data.invitePath.replace("/invite/", "");
    expect((await person()("GET", `/auth/invites/${token}`)).data).toMatchObject({ hasAccount: true, needsCode: true });
    const joining = person();
    const noCode = await joining("POST", `/auth/invites/${token}/accept`, { password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.data.code).toBe("mfa_required");
    expect((await joining("POST", `/auth/invites/${token}/accept`, { password: PASSWORD, code: nextCode(ownerSecret) })).status).toBe(201);

    // The audit log records who did what, filters by category, and exports CSV.
    const audit = (await owner("GET", "/workspace/audit?category=access")).data;
    expect(audit.categories.map((c: any) => c.key)).toContain("access");
    const types = audit.entries.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["member_mfa_enabled", "workspace_mfa_required", "member_signed_out_everywhere"]));
    expect(types).not.toContain("member_removed");
    expect(audit.entries.find((e: any) => e.type === "member_mfa_enabled").actor).toBeTruthy();
    // Entries written by any route name the person, without the route passing it.
    const all = (await owner("GET", "/workspace/audit")).data.entries;
    expect(all.filter((e: any) => e.type === "member_joined").map((e: any) => e.actor)).toEqual(expect.arrayContaining(["Sam Owner", "Wren Writer"]));
    expect(all.find((e: any) => e.type === "api_key_created").actor).toBe("Wren Writer");
    const removal = (await owner("GET", "/workspace/audit?q=revoked")).data.entries;
    expect(removal[0].description).toMatch(/1 API key they created revoked/);
    const csv = await owner("GET", "/workspace/audit.csv?category=members");
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.headers.get("content-disposition")).toMatch(/attachment; filename="audit-log-/);
    expect(String(csv.data).split("\r\n")[0]).toBe("Time (UTC),Who,Event,Description");
    expect(String(csv.data)).toContain("member_removed");
  }, 60_000);
});
