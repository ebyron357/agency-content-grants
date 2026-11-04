/**
 * Workspaces and members end to end against the real test database, through
 * the real router (auth, requireAuth and the application routes) with a real
 * express-session: the operator creates a client workspace, its owner accepts
 * the invitation, invites a writer, and neither workspace can see the other's
 * data. Removing a member ends their access on the next request.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { brandsTable, db, invitesTable, membersTable, usersTable, workspacesTable } from "@workspace/db";
import { router } from "./index";
import { invalidateMembershipCache } from "../middleware/requireAuth";

let server: Server;
let base = "";
const PASSWORD = "Correct horse battery staple 42";
const OWNER_EMAIL = `owner-${Date.now()}@client-a.example`;
const WRITER_EMAIL = `writer-${Date.now()}@client-a.example`;
/** Brands this file creates for the shared agency principal, removed afterwards so later suites (and /api/seed) see the database as they left it. */
const agencyBrandIds: string[] = [];

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "workspace-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  return app;
}

/** A cookie jar per person, following session regeneration. */
function person() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data: data as any };
  };
}

beforeAll(() => {
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, "Client A (test)"));
  await db.delete(membersTable).where(inArray(membersTable.email, [OWNER_EMAIL, WRITER_EMAIL]));
  if (agencyBrandIds.length) await db.delete(brandsTable).where(inArray(brandsTable.id, agencyBrandIds));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    // The client workspace's principal owns its data; deleting it removes that data too.
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

describe("workspaces and members", () => {
  it("keeps the operator password sign-in as the agency workspace owner", async () => {
    const operator = person();
    expect((await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD })).status).toBe(200);
    const me = (await operator("GET", "/auth/me")).data;
    expect(me).toMatchObject({ authenticated: true, role: "owner", member: null, workspace: { kind: "agency" } });
  });

  it("attaches a session from before workspaces existed to the agency workspace", async () => {
    // A pre-upgrade session: authenticated as the agency principal, with no workspace.
    const legacy = express();
    legacy.use(express.json());
    legacy.use(session({ secret: "workspace-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
    const { ensureAdminUser } = await import("../lib/adoptData");
    const principal = await ensureAdminUser();
    legacy.post("/seed", (req, res) => {
      req.session.authenticated = true;
      req.session.userId = principal;
      res.json({ ok: true });
    });
    legacy.use("/api", router);
    const srv = legacy.listen(0);
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const seeded = await fetch(`${url}/seed`, { method: "POST" });
    const cookie = seeded.headers.get("set-cookie")!.split(";")[0];
    const team = await fetch(`${url}/api/workspace`, { headers: { Cookie: cookie } });
    expect(team.status).toBe(200);
    expect(((await team.json()) as any).workspace.kind).toBe("agency");
    srv.close();
  });

  it("creates a client workspace, onboards its people by invitation, and isolates its data", async () => {
    const operator = person();
    await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    expect((await operator("POST", "/workspaces", { name: "Client A (test)", ownerEmail: OWNER_EMAIL })).status).toBe(403);
    await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
    const created = await operator("POST", "/workspaces", { name: "Client A (test)", ownerEmail: OWNER_EMAIL });
    expect(created.status).toBe(201);
    const ownerToken = created.data.invitePath.replace("/invite/", "");
    const [stored] = await db.select().from(invitesTable).where(eq(invitesTable.email, OWNER_EMAIL));
    expect(stored.tokenHash).not.toContain(ownerToken);

    // The owner accepts: weak password refused, then joined and signed in.
    const owner = person();
    expect((await owner("GET", `/auth/invites/${ownerToken}`)).data).toMatchObject({ email: OWNER_EMAIL, role: "owner", hasAccount: false, workspace: { name: "Client A (test)" } });
    expect((await owner("POST", `/auth/invites/${ownerToken}/accept`, { name: "Alice Owner", password: "short" })).status).toBe(400);
    const accepted = await owner("POST", `/auth/invites/${ownerToken}/accept`, { name: "Alice Owner", password: PASSWORD });
    expect(accepted.status).toBe(201);
    expect((await owner("GET", "/auth/me")).data).toMatchObject({ role: "owner", member: { email: OWNER_EMAIL, name: "Alice Owner" }, workspace: { name: "Client A (test)" } });
    // An invitation works once.
    expect((await person()("POST", `/auth/invites/${ownerToken}/accept`, { name: "Mallory", password: PASSWORD })).status).toBe(404);

    // Data created in Client A is invisible to the agency workspace, and the reverse.
    const brand = await owner("POST", "/brands", { name: "Client A brand", industry: "Literacy" });
    expect(brand.status).toBe(201);
    const agencyBrand = await operator("POST", "/brands", { name: "Agency brand", industry: "Agency" });
    agencyBrandIds.push(agencyBrand.data.id);
    expect((await operator("GET", `/brands/${brand.data.id}`)).status).toBe(404);
    expect((await owner("GET", `/brands/${agencyBrand.data.id}`)).status).toBe(404);
    expect(((await operator("GET", "/brands")).data as any[]).map((b) => b.id)).not.toContain(brand.data.id);
    expect(((await owner("GET", "/brands")).data as any[]).map((b) => b.id)).toEqual([brand.data.id]);
    // Grant Studio records the person, not the shared account, on confirmations.
    const org = (await owner("POST", "/grants/applicants", { name: "Client A org", applicantType: "nonprofit_501c3" })).data;
    const fact = await owner("POST", `/grants/applicants/${org.id}/facts`, { category: "history", label: "Founded", body: "Founded in 2009.", confirmed: true });
    expect(fact.data.confirmedBy).toBe("Alice Owner");
    expect((await operator("GET", `/grants/applicants/${org.id}`)).status).toBe(404);

    // The owner invites a writer, who cannot manage members.
    const invite = await owner("POST", "/workspace/invites", { email: WRITER_EMAIL, role: "writer" });
    expect(invite.status).toBe(201);
    const writer = person();
    expect((await writer("POST", `/auth/invites/${invite.data.invitePath.replace("/invite/", "")}/accept`, { name: "Wes Writer", password: PASSWORD })).status).toBe(201);
    expect(((await writer("GET", "/brands")).data as any[]).map((b) => b.id)).toEqual([brand.data.id]);
    expect((await writer("POST", "/workspace/invites", { email: "x@example.com", role: "viewer" })).status).toBe(403);
    const team = (await owner("GET", "/workspace")).data;
    expect(team.members.map((m: any) => [m.email, m.role])).toEqual([[OWNER_EMAIL, "owner"], [WRITER_EMAIL, "writer"]]);
    const writerId = team.members.find((m: any) => m.email === WRITER_EMAIL).id;
    const ownerId = team.members.find((m: any) => m.email === OWNER_EMAIL).id;

    // The last owner cannot be demoted or removed; an admin cannot touch owners.
    expect((await owner("PATCH", `/workspace/members/${ownerId}`, { role: "writer" })).status).toBe(409);
    expect((await owner("DELETE", `/workspace/members/${ownerId}`)).status).toBe(409);
    expect((await owner("PATCH", `/workspace/members/${writerId}`, { role: "admin" })).status).toBe(200);
    invalidateMembershipCache();
    expect((await writer("PATCH", `/workspace/members/${ownerId}`, { role: "viewer" })).status).toBe(403);
    expect((await writer("POST", "/workspace/invites", { email: "boss@example.com", role: "owner" })).status).toBe(403);

    // Members sign in with email and password; failures say the same thing.
    const again = person();
    const wrong = await again("POST", "/auth/login", { email: WRITER_EMAIL, password: "Not the right password 1" });
    const unknown = await again("POST", "/auth/login", { email: "nobody@example.com", password: PASSWORD });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.data.error).toBe(unknown.data.error);
    expect((await again("POST", "/auth/login", { email: WRITER_EMAIL.toUpperCase(), password: PASSWORD })).status).toBe(200);
    // A member cannot switch into a workspace they do not belong to.
    const agencyId = (await operator("GET", "/auth/me")).data.workspace.id;
    expect((await again("POST", "/auth/switch-workspace", { workspaceId: agencyId })).status).toBe(404);

    // Removing the writer ends both of their sessions on the next request.
    expect((await owner("DELETE", `/workspace/members/${writerId}`)).status).toBe(204);
    expect((await writer("GET", "/brands")).status).toBe(401);
    expect((await again("GET", "/brands")).status).toBe(401);

    // Password change needs the current password and a strong new one.
    expect((await owner("POST", "/auth/password", { currentPassword: "wrong", newPassword: "Another strong passphrase 7" })).status).toBe(401);
    expect((await owner("POST", "/auth/password", { currentPassword: PASSWORD, newPassword: "aaaaaaaaaaaaa" })).status).toBe(400);
    expect((await owner("POST", "/auth/password", { currentPassword: PASSWORD, newPassword: "Another strong passphrase 7" })).status).toBe(200);

    // Revoked and expired invitations do not open.
    const late = await owner("POST", "/workspace/invites", { email: "late@client-a.example", role: "viewer" });
    expect((await owner("DELETE", `/workspace/invites/${late.data.id}`)).status).toBe(204);
    expect((await person()("GET", `/auth/invites/${late.data.invitePath.replace("/invite/", "")}`)).status).toBe(404);
    const stale = await owner("POST", "/workspace/invites", { email: "stale@client-a.example", role: "viewer" });
    await db.update(invitesTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitesTable.id, stale.data.id));
    expect((await person()("GET", `/auth/invites/${stale.data.invitePath.replace("/invite/", "")}`)).status).toBe(404);
  }, 60_000);
});
