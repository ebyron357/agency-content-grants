import { createHash, randomBytes, randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, invitesTable, membersTable, membershipsTable, usersTable, workspacesTable, type Member, type Workspace } from "@workspace/db";
import { ensureAdminUser } from "./adoptData";

/**
 * Workspaces, members and invitations (docs/SECURITY_AND_ACCESS_HANDOFF.md).
 *
 * The data owner of a workspace is its principal `users` row; a signed-in
 * member's session carries that principal as `session.userId`, so every
 * existing ownership check scopes to the workspace without change.
 */

export { ROLES } from "./permissions";
import { ROLES } from "./permissions";

export type Role = keyof typeof ROLES;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLES, value);
}

export function canManageMembers(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Only an owner can grant or remove the owner role. */
export function canAssignRole(actorRole: string | null | undefined, target: Role): boolean {
  if (actorRole === "owner") return true;
  return actorRole === "admin" && target !== "owner";
}

export const INVITE_TTL_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/** Returns a reason the password is not acceptable, or null. */
export function passwordProblem(password: unknown, email?: string | null): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  if (email && password.toLowerCase().includes(email.split("@")[0])) return "Do not include your email name in the password.";
  if (new Set(password).size < 5) return "Use a less repetitive password.";
  return null;
}

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The operator's own workspace, owning the data of the shared password sign-in. Created on first use. */
export async function ensureAgencyWorkspace(): Promise<Workspace> {
  const principal = await ensureAdminUser();
  const [existing] = await db.select().from(workspacesTable).where(eq(workspacesTable.principalUserId, principal)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(workspacesTable)
    .values({ id: randomUUID(), name: process.env.AGENCY_WORKSPACE_NAME || "Agency workspace", principalUserId: principal, kind: "agency" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(workspacesTable).where(eq(workspacesTable.principalUserId, principal)).limit(1);
  return raced;
}

/** Creates a workspace with its own data principal. */
export async function createWorkspace(name: string, kind: "client" | "agency" = "client"): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const principalId = randomUUID();
    await tx.insert(usersTable).values({ id: principalId, username: `workspace-${principalId}`, passwordHash: "workspace-principal" });
    const [workspace] = await tx.insert(workspacesTable).values({ id: randomUUID(), name, principalUserId: principalId, kind }).returning();
    return workspace;
  });
}

export interface WorkspaceAccess {
  workspace: Workspace;
  role: Role;
}

/** The workspaces a member belongs to, oldest membership first. */
export async function memberWorkspaces(memberId: string): Promise<WorkspaceAccess[]> {
  const rows = await db
    .select({ workspace: workspacesTable, role: membershipsTable.role })
    .from(membershipsTable)
    .innerJoin(workspacesTable, eq(membershipsTable.workspaceId, workspacesTable.id))
    .where(eq(membershipsTable.memberId, memberId))
    .orderBy(asc(membershipsTable.createdAt));
  return rows.filter((r) => isRole(r.role)).map((r) => ({ workspace: r.workspace, role: r.role as Role }));
}

export async function membershipOf(memberId: string, workspaceId: string): Promise<WorkspaceAccess | null> {
  const [row] = await db
    .select({ workspace: workspacesTable, role: membershipsTable.role })
    .from(membershipsTable)
    .innerJoin(workspacesTable, eq(membershipsTable.workspaceId, workspacesTable.id))
    .where(and(eq(membershipsTable.memberId, memberId), eq(membershipsTable.workspaceId, workspaceId)))
    .limit(1);
  return row && isRole(row.role) ? { workspace: row.workspace, role: row.role as Role } : null;
}

export function memberView(m: Pick<Member, "id" | "email" | "name" | "status" | "lastSignInAt" | "createdAt">) {
  return { id: m.id, email: m.email, name: m.name, status: m.status, lastSignInAt: m.lastSignInAt, createdAt: m.createdAt };
}

/**
 * Sessions signed in with the team password before workspaces existed carry no
 * workspace. When such a session belongs to the agency principal, attach it to
 * the agency workspace as owner. Member sessions always carry their workspace.
 */
export async function upgradeLegacySession(session: { authenticated?: boolean; userId?: string; memberId?: string; workspaceId?: string; role?: string }): Promise<void> {
  if (session.authenticated !== true || session.memberId || session.workspaceId || !session.userId) return;
  const agency = await ensureAgencyWorkspace();
  if (agency.principalUserId !== session.userId) return;
  session.workspaceId = agency.id;
  session.role = "owner";
}

