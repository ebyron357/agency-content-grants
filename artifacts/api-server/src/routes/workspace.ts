import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { db, invitesTable, membersTable, membershipsTable, workspacesTable } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { invalidateMembershipCache } from "../middleware/requireAuth";
import {
  INVITE_TTL_DAYS,
  ROLES,
  canAssignRole,
  canManageMembers,
  createWorkspace,
  isRole,
  memberView,
  newInviteToken,
  normalizeEmail,
  upgradeLegacySession,
  type Role,
} from "../lib/workspaces";

/**
 * Workspace administration (docs/SECURITY_AND_ACCESS_HANDOFF.md): members, roles and
 * invitations for the signed-in workspace, and creating client workspaces.
 * Mounted behind requireAuth.
 */

const router: IRouter = Router();

router.use(["/workspace", "/workspaces"], (req, _res, next) => {
  upgradeLegacySession(req.session).then(() => next(), next);
});

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function requireManager(req: Request, res: Response): boolean {
  if (!req.session.workspaceId) {
    fail(res, 400, "No workspace is selected.");
    return false;
  }
  if (!canManageMembers(req.session.role)) {
    fail(res, 403, "Only owners and admins can manage members.");
    return false;
  }
  return true;
}

function actor(req: Request): string {
  return req.session.actorName ?? "operator";
}

async function ownerCount(workspaceId: string): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(membershipsTable).where(and(eq(membershipsTable.workspaceId, workspaceId), eq(membershipsTable.role, "owner")));
  return Number(n);
}

router.get("/workspace", async (req, res): Promise<void> => {
  if (!req.session.workspaceId) return fail(res, 400, "No workspace is selected.");
  const [workspace] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, req.session.workspaceId)).limit(1);
  if (!workspace) return fail(res, 404, "Workspace not found");
  const members = await db
    .select({ member: membersTable, role: membershipsTable.role, since: membershipsTable.createdAt })
    .from(membershipsTable)
    .innerJoin(membersTable, eq(membershipsTable.memberId, membersTable.id))
    .where(eq(membershipsTable.workspaceId, workspace.id))
    .orderBy(asc(membershipsTable.createdAt));
  const manager = canManageMembers(req.session.role);
  const invites = manager
    ? await db.select().from(invitesTable).where(and(eq(invitesTable.workspaceId, workspace.id), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt))).orderBy(desc(invitesTable.createdAt))
    : [];
  res.json({
    workspace: { id: workspace.id, name: workspace.name, kind: workspace.kind, createdAt: workspace.createdAt },
    role: req.session.role ?? null,
    canManage: manager,
    roles: Object.entries(ROLES).map(([key, r]) => ({ key, ...r })),
    members: members.map((m) => ({ ...memberView(m.member), role: m.role, since: m.since, isYou: m.member.id === req.session.memberId })),
    invites: invites
      .filter((i) => i.expiresAt.getTime() > Date.now())
      .map((i) => ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invitedBy, expiresAt: i.expiresAt, createdAt: i.createdAt })),
  });
});

router.patch("/workspace", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
  if (!name) return fail(res, 400, "Enter a workspace name.");
  const [row] = await db.update(workspacesTable).set({ name }).where(eq(workspacesTable.id, req.session.workspaceId!)).returning();
  res.json({ id: row.id, name: row.name });
});

/** Creates an invitation and returns its link once. Only a hash of the token is kept. */
router.post("/workspace/invites", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const email = normalizeEmail(req.body?.email);
  if (!email) return fail(res, 400, "Enter a valid email address.");
  const role = req.body?.role;
  if (!isRole(role)) return fail(res, 400, `role must be one of: ${Object.keys(ROLES).join(", ")}`);
  if (!canAssignRole(req.session.role, role)) return fail(res, 403, "Only an owner can invite another owner.");
  const [already] = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .innerJoin(membersTable, eq(membershipsTable.memberId, membersTable.id))
    .where(and(eq(membershipsTable.workspaceId, req.session.workspaceId!), eq(membersTable.email, email)))
    .limit(1);
  if (already) return fail(res, 409, "That person is already a member.");
  // A new invitation for the same email replaces any open one.
  await db.update(invitesTable).set({ revokedAt: new Date() }).where(and(eq(invitesTable.workspaceId, req.session.workspaceId!), eq(invitesTable.email, email), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt)));
  const { token, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  const [invite] = await db.insert(invitesTable).values({ id: randomUUID(), workspaceId: req.session.workspaceId!, email, role, tokenHash: hash, invitedBy: actor(req), expiresAt }).returning();
  await logActivity("member_invited", `${email} invited as ${role}`, { userId: req.session.userId }).catch(() => {});
  res.status(201).json({ id: invite.id, email, role, expiresAt, invitePath: `/invite/${token}` });
});

router.delete("/workspace/invites/:id", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const rows = await db
    .update(invitesTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitesTable.id, String(req.params.id)), eq(invitesTable.workspaceId, req.session.workspaceId!), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt)))
    .returning({ id: invitesTable.id });
  if (rows.length === 0) return fail(res, 404, "Invitation not found");
  res.status(204).end();
});

async function targetMembership(req: Request, res: Response) {
  const [row] = await db
    .select({ membership: membershipsTable, member: membersTable })
    .from(membershipsTable)
    .innerJoin(membersTable, eq(membershipsTable.memberId, membersTable.id))
    .where(and(eq(membershipsTable.workspaceId, req.session.workspaceId!), eq(membershipsTable.memberId, String(req.params.memberId))))
    .limit(1);
  if (!row) fail(res, 404, "Member not found");
  return row ?? null;
}

router.patch("/workspace/members/:memberId", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const target = await targetMembership(req, res);
  if (!target) return;
  const role = req.body?.role;
  if (!isRole(role)) return fail(res, 400, `role must be one of: ${Object.keys(ROLES).join(", ")}`);
  if (!canAssignRole(req.session.role, role) || (target.membership.role === "owner" && req.session.role !== "owner")) return fail(res, 403, "Only an owner can change an owner's role or make someone an owner.");
  if (target.membership.role === "owner" && role !== "owner" && (await ownerCount(req.session.workspaceId!)) <= 1) return fail(res, 409, "A workspace needs at least one owner.");
  await db.update(membershipsTable).set({ role }).where(eq(membershipsTable.id, target.membership.id));
  invalidateMembershipCache(target.member.id);
  await logActivity("member_role_changed", `${target.member.email} is now ${role}`, { userId: req.session.userId }).catch(() => {});
  res.json({ ...memberView(target.member), role });
});

router.delete("/workspace/members/:memberId", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const target = await targetMembership(req, res);
  if (!target) return;
  if (target.membership.role === "owner" && req.session.role !== "owner") return fail(res, 403, "Only an owner can remove an owner.");
  if (target.membership.role === "owner" && (await ownerCount(req.session.workspaceId!)) <= 1) return fail(res, 409, "A workspace needs at least one owner.");
  await db.delete(membershipsTable).where(eq(membershipsTable.id, target.membership.id));
  invalidateMembershipCache(target.member.id);
  await logActivity("member_removed", `${target.member.email} removed`, { userId: req.session.userId }).catch(() => {});
  res.status(204).end();
});

/**
 * POST /workspaces { name, ownerEmail }: the operator (admin-unlocked) creates a client
 * workspace and gets a one-time invitation link for its first owner.
 */
router.post("/workspaces", async (req, res): Promise<void> => {
  if (req.session.isAdmin !== true) return fail(res, 403, "Unlock admin access to create workspaces.");
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
  if (!name) return fail(res, 400, "Enter a workspace name.");
  const ownerEmail = normalizeEmail(req.body?.ownerEmail);
  if (!ownerEmail) return fail(res, 400, "Enter the first owner's email.");
  const workspace = await createWorkspace(name);
  const { token, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await db.insert(invitesTable).values({ id: randomUUID(), workspaceId: workspace.id, email: ownerEmail, role: "owner" satisfies Role, tokenHash: hash, invitedBy: actor(req), expiresAt });
  await logActivity("workspace_created", `Workspace "${name}" created for ${ownerEmail}`, { userId: req.session.userId }).catch(() => {});
  res.status(201).json({ workspace: { id: workspace.id, name: workspace.name, kind: workspace.kind }, ownerEmail, expiresAt, invitePath: `/invite/${token}` });
});

/** GET /workspaces: the operator's list of client workspaces with their member counts. */
router.get("/workspaces", async (req, res): Promise<void> => {
  if (req.session.isAdmin !== true) return fail(res, 403, "Unlock admin access to list workspaces.");
  const rows = await db.select().from(workspacesTable).orderBy(asc(workspacesTable.createdAt));
  const counts = await db.select({ workspaceId: membershipsTable.workspaceId, n: count() }).from(membershipsTable).groupBy(membershipsTable.workspaceId);
  const byId = new Map(counts.map((c) => [c.workspaceId, Number(c.n)]));
  res.json(rows.map((w) => ({ id: w.id, name: w.name, kind: w.kind, members: byId.get(w.id) ?? 0, createdAt: w.createdAt })));
});

export default router;
