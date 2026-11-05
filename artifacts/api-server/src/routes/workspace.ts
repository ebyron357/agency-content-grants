import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { activityLogTable, apiKeysTable, db, invitesTable, membersTable, membershipsTable, workspacesTable } from "@workspace/db";
import { revokeMemberSessions } from "../lib/memberSessions";
import { logActivity } from "../lib/activity";
import { checkInvite, limitResponse } from "../lib/billing/service";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../lib/permissions";
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
    workspace: { id: workspace.id, name: workspace.name, kind: workspace.kind, requireMfa: workspace.requireMfa, createdAt: workspace.createdAt },
    role: req.session.role ?? null,
    canManage: manager,
    roles: Object.entries(ROLES).map(([key, r]) => ({ key, ...r, permissions: ROLE_PERMISSIONS[key as Role] })),
    permissions: Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })),
    members: members.map((m) => ({ ...memberView(m.member), role: m.role, since: m.since, mfaEnabled: !!m.member.totpEnabledAt, isYou: m.member.id === req.session.memberId })),
    invites: invites
      .filter((i) => i.expiresAt.getTime() > Date.now())
      .map((i) => ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invitedBy, expiresAt: i.expiresAt, createdAt: i.createdAt })),
  });
});

/** PATCH /workspace { name?, requireMfa? }: rename the workspace, or require two-factor sign-in for every member. */
router.patch("/workspace", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const values: { name?: string; requireMfa?: boolean } = {};
  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    if (!name) return fail(res, 400, "Enter a workspace name.");
    values.name = name;
  }
  if (req.body?.requireMfa !== undefined) {
    if (typeof req.body.requireMfa !== "boolean") return fail(res, 400, "requireMfa must be true or false");
    if (req.body.requireMfa && req.session.memberId) {
      // Whoever turns the requirement on must already meet it, so they cannot lock themselves out.
      const [self] = await db.select({ on: membersTable.totpEnabledAt }).from(membersTable).where(eq(membersTable.id, req.session.memberId)).limit(1);
      if (!self?.on) return fail(res, 409, "Turn on two-factor sign-in for your own account first.");
    }
    values.requireMfa = req.body.requireMfa;
  }
  if (!Object.keys(values).length) return fail(res, 400, "Nothing to change.");
  const [row] = await db.update(workspacesTable).set(values).where(eq(workspacesTable.id, req.session.workspaceId!)).returning();
  invalidateMembershipCache();
  if (values.requireMfa !== undefined) {
    await logActivity(values.requireMfa ? "workspace_mfa_required" : "workspace_mfa_optional", values.requireMfa ? "Two-factor sign-in is now required" : "Two-factor sign-in is now optional", { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  }
  res.json({ id: row.id, name: row.name, requireMfa: row.requireMfa });
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
  // Plan limit on users (members plus open invitations); allowed whenever billing is off.
  const allowed = await checkInvite(req.session, email);
  if (!allowed.allowed) {
    res.status(402).json(limitResponse(allowed));
    return;
  }
  // A new invitation for the same email replaces any open one.
  await db.update(invitesTable).set({ revokedAt: new Date() }).where(and(eq(invitesTable.workspaceId, req.session.workspaceId!), eq(invitesTable.email, email), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt)));
  const { token, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  const [invite] = await db.insert(invitesTable).values({ id: randomUUID(), workspaceId: req.session.workspaceId!, email, role, tokenHash: hash, invitedBy: actor(req), expiresAt }).returning();
  await logActivity("member_invited", `${email} invited as ${role}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
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
  await logActivity("member_role_changed", `${target.member.email} is now ${role}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.json({ ...memberView(target.member), role });
});

router.delete("/workspace/members/:memberId", async (req, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const target = await targetMembership(req, res);
  if (!target) return;
  if (target.membership.role === "owner" && req.session.role !== "owner") return fail(res, 403, "Only an owner can remove an owner.");
  if (target.membership.role === "owner" && (await ownerCount(req.session.workspaceId!)) <= 1) return fail(res, 409, "A workspace needs at least one owner.");
  await db.delete(membershipsTable).where(eq(membershipsTable.id, target.membership.id));
  // Their sign-ins to this workspace and the API keys they created here stop working too.
  await revokeMemberSessions(target.member.id, { workspaceId: req.session.workspaceId! });
  const keys = await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeysTable.userId, req.session.userId!), eq(apiKeysTable.createdByMemberId, target.member.id), isNull(apiKeysTable.revokedAt)))
    .returning({ id: apiKeysTable.id });
  invalidateMembershipCache(target.member.id);
  await logActivity("member_removed", `${target.member.email} removed${keys.length ? `; ${keys.length} API key${keys.length === 1 ? "" : "s"} they created revoked` : ""}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.status(204).end();
});

/** Audit categories, from the activity type prefix. Data, so the screen's filter is generated from it. */
export const AUDIT_CATEGORIES: Record<string, { label: string; prefixes: string[] }> = {
  access: { label: "Sign-in and security", prefixes: ["member_signed", "member_mfa", "member_recovery", "member_session", "member_password", "admin_", "workspace_mfa"] },
  members: { label: "Members and invitations", prefixes: ["member_invited", "member_joined", "member_role", "member_removed", "workspace_created"] },
  grants: { label: "Grant Studio", prefixes: ["grant_"] },
  automation: { label: "API keys and webhooks", prefixes: ["api_key", "webhook"] },
};

const AUDIT_PAGE = 50;

function auditFilter(req: Request): SQL {
  const conditions: SQL[] = [eq(activityLogTable.userId, req.session.userId!)];
  const category = typeof req.query.category === "string" ? AUDIT_CATEGORIES[req.query.category] : undefined;
  if (category) conditions.push(or(...category.prefixes.map((p) => ilike(activityLogTable.type, `${p.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)))!);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(activityLogTable.description, like), ilike(activityLogTable.actorName, like))!);
  }
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  if (before && !Number.isNaN(before.getTime())) conditions.push(lt(activityLogTable.createdAt, before));
  return and(...conditions)!;
}

const auditView = (r: typeof activityLogTable.$inferSelect) => ({ id: r.id, type: r.type, description: r.description, actor: r.actorName, at: r.createdAt });

/** GET /workspace/audit?category&q&before: the workspace's audit log, newest first, 50 at a time. */
router.get("/workspace/audit", async (req, res): Promise<void> => {
  const rows = await db.select().from(activityLogTable).where(auditFilter(req)).orderBy(desc(activityLogTable.createdAt)).limit(AUDIT_PAGE + 1);
  res.json({
    categories: Object.entries(AUDIT_CATEGORIES).map(([key, c]) => ({ key, label: c.label })),
    entries: rows.slice(0, AUDIT_PAGE).map(auditView),
    nextBefore: rows.length > AUDIT_PAGE ? rows[AUDIT_PAGE - 1].createdAt : null,
  });
});

function csvCell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  // A leading formula character would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** GET /workspace/audit.csv: the same filters, up to 10,000 rows, for records or an auditor. */
router.get("/workspace/audit.csv", async (req, res): Promise<void> => {
  const rows = await db.select().from(activityLogTable).where(auditFilter(req)).orderBy(desc(activityLogTable.createdAt)).limit(10_000);
  const lines = [["Time (UTC)", "Who", "Event", "Description"].join(","), ...rows.map((r) => [r.createdAt, r.actorName ?? "", r.type, r.description].map(csvCell).join(","))];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join("\r\n") + "\r\n");
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
  await logActivity("workspace_created", `Workspace "${name}" created for ${ownerEmail}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
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
