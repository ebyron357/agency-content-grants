/**
 * Per-role permissions end to end, through the real router with real
 * sessions: each role is invited into a client workspace and calls routes on
 * both sides of its permissions. Requests the role may make reach the handler
 * (404 for an id that does not exist); requests it may not make stop at 403
 * before the handler runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, membersTable, usersTable, workspacesTable } from "@workspace/db";
import { router } from "./index";

const WS_NAME = "Permissions test workspace";
const STAMP = Date.now();
const email = (role: string) => `${role}-${STAMP}@perm.example`;
const PASSWORD = "Separation of duties matters 9";
let server: Server;
let base = "";

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
    return { status: res.status, data: (type.includes("json") ? await res.json() : await res.text()) as any };
  };
}

type Person = ReturnType<typeof person>;
const people: Record<string, Person> = {};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "permissions-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const operator = person();
  await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
  await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
  const created = await operator("POST", "/workspaces", { name: WS_NAME, ownerEmail: email("owner") });
  const owner = person();
  await owner("POST", `/auth/invites/${created.data.invitePath.replace("/invite/", "")}/accept`, { name: "Olive Owner", password: PASSWORD });
  people.owner = owner;
  for (const role of ["writer", "reviewer", "representative", "finance", "viewer"]) {
    const invite = await owner("POST", "/workspace/invites", { email: email(role), role });
    const p = person();
    const joined = await p("POST", `/auth/invites/${invite.data.invitePath.replace("/invite/", "")}/accept`, { name: `Test ${role}`, password: PASSWORD });
    expect(joined.status).toBe(201);
    people[role] = p;
  }
}, 60_000);

afterAll(async () => {
  server?.close();
  const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, WS_NAME));
  await db.delete(membersTable).where(like(membersTable.email, `%-${STAMP}@perm.example`));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

describe("per-role permissions", () => {
  it("tells each person what their role allows", async () => {
    const me = (await people.reviewer("GET", "/auth/me")).data;
    expect(me.role).toBe("reviewer");
    expect(me.permissions).toEqual(["workspace.read", "grants.review"]);
    expect((await people.owner("GET", "/auth/me")).data.permissions).toContain("members.manage");
  });

  it("lets a viewer read and nothing else", async () => {
    const viewer = people.viewer;
    expect((await viewer("GET", "/brands")).status).toBe(200);
    expect((await viewer("GET", "/grants/applicants")).status).toBe(200);
    expect((await viewer("GET", "/workspace")).status).toBe(200);
    const denied = await viewer("POST", "/brands", { name: "Nope", industry: "None" });
    expect(denied.status).toBe(403);
    expect(denied.data).toMatchObject({ code: "forbidden_by_role", needs: "content.write" });
    expect(denied.data.error).toMatch(/Viewer/);
    expect((await viewer("GET", "/api-keys")).status).toBe(403);
    expect((await viewer("POST", "/grants/applicants", { name: "X", applicantType: "nonprofit_501c3" })).status).toBe(403);
    // The automation API checks the same permissions for a session caller.
    expect((await viewer("POST", "/automation/projects", {})).status).toBe(403);
  });

  it("lets a writer write but not approve", async () => {
    const writer = people.writer;
    expect((await writer("POST", "/brands", { name: "Writer brand", industry: "Literacy" })).status).toBe(201);
    expect((await writer("POST", "/grants/applicants", { name: "Writer org", applicantType: "nonprofit_501c3" })).status).toBe(201);
    expect((await writer("PATCH", "/grants/budget-lines/missing", { amount: 1 })).status).toBe(404);
    expect((await writer("POST", "/grants/sections/missing/approve", {})).status).toBe(403);
    expect((await writer("POST", "/grants/applications/missing/approve-package", { confirmAuthorized: true })).status).toBe(403);
    expect((await writer("POST", "/workspace/invites", { email: "x@perm.example", role: "viewer" })).status).toBe(403);
  });

  it("lets a reviewer approve sections without editing them", async () => {
    expect((await people.reviewer("POST", "/grants/sections/missing/approve", {})).status).toBe(404);
    expect((await people.reviewer("POST", "/grants/sections/missing/reopen", {})).status).toBe(404);
    expect((await people.reviewer("PATCH", "/grants/sections/missing", { body: "edit" })).status).toBe(403);
    expect((await people.reviewer("POST", "/grants/applications/missing/approve-package", { confirmAuthorized: true })).status).toBe(403);
  });

  it("reserves the package approval and outcomes for the representative", async () => {
    const rep = people.representative;
    expect((await rep("POST", "/grants/applications/missing/approve-package", { confirmAuthorized: true })).status).toBe(404);
    expect((await rep("POST", "/grants/applications/missing/outcome", { outcome: "submitted" })).status).toBe(404);
    expect((await rep("PATCH", "/grants/applications/missing", { title: "x" })).status).toBe(403);
  });

  it("lets finance edit budgets and award amounts only", async () => {
    const finance = people.finance;
    expect((await finance("PATCH", "/grants/budget-lines/missing", { amount: 1 })).status).toBe(404);
    expect((await finance("POST", "/grants/applications/missing/outcome", { outcome: "awarded" })).status).toBe(404);
    expect((await finance("POST", "/grants/applications/missing/approve-package", { confirmAuthorized: true })).status).toBe(403);
    expect((await finance("PATCH", "/grants/applications/missing", { title: "x" })).status).toBe(403);
  });

  it("applies a role change on the next request", async () => {
    const team = (await people.owner("GET", "/workspace")).data;
    const viewerId = team.members.find((m: any) => m.email === email("viewer")).id;
    expect((await people.owner("PATCH", `/workspace/members/${viewerId}`, { role: "writer" })).status).toBe(200);
    expect((await people.viewer("POST", "/brands", { name: "Promoted brand", industry: "Literacy" })).status).toBe(201);
    expect((await people.viewer("GET", "/auth/me")).data.role).toBe("writer");
  });
});
