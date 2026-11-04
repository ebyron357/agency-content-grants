import { randomUUID } from "crypto";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Request } from "express";
import { db, memberSessionsTable } from "@workspace/db";
import { invalidateMembershipCache } from "../middleware/requireAuth";

/**
 * Per-browser member sessions (docs/SECURITY_AND_ACCESS_HANDOFF.md §1).
 * Each sign-in gets a row; the session cookie carries its id, and requireAuth
 * refuses a session whose row is revoked. This works whatever the session
 * store is, and lets a person see and end their other sign-ins.
 */

/** Matches the session cookie's lifetime: rows older than this are expired. */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export async function startMemberSession(req: Request, memberId: string, workspaceId: string, method: "password" | "mfa" | "recovery_code" | "invite"): Promise<string> {
  const id = randomUUID();
  await db.insert(memberSessionsTable).values({
    id,
    memberId,
    workspaceId,
    method,
    userAgent: (req.header("user-agent") ?? "").slice(0, 300) || null,
    ipAddress: req.ip ?? null,
  });
  return id;
}

export async function revokeMemberSession(id: string | undefined, memberId?: string): Promise<boolean> {
  if (!id) return false;
  const conditions = [eq(memberSessionsTable.id, id), isNull(memberSessionsTable.revokedAt)];
  if (memberId) conditions.push(eq(memberSessionsTable.memberId, memberId));
  const rows = await db.update(memberSessionsTable).set({ revokedAt: new Date() }).where(and(...conditions)).returning({ memberId: memberSessionsTable.memberId });
  if (rows[0]) invalidateMembershipCache(rows[0].memberId);
  return rows.length === 1;
}

/** Whether a member's session row is still live. */
export async function memberSessionActive(id: string | undefined): Promise<boolean> {
  if (!id) return false;
  const [row] = await db.select({ revokedAt: memberSessionsTable.revokedAt }).from(memberSessionsTable).where(eq(memberSessionsTable.id, id)).limit(1);
  return !!row && !row.revokedAt;
}

/** Ends every session of a member, except `keep` when given. Returns how many were ended. */
export async function revokeMemberSessions(memberId: string, opts: { keep?: string; workspaceId?: string } = {}): Promise<number> {
  const conditions = [eq(memberSessionsTable.memberId, memberId), isNull(memberSessionsTable.revokedAt)];
  if (opts.keep) conditions.push(ne(memberSessionsTable.id, opts.keep));
  if (opts.workspaceId) conditions.push(eq(memberSessionsTable.workspaceId, opts.workspaceId));
  const rows = await db.update(memberSessionsTable).set({ revokedAt: new Date() }).where(and(...conditions)).returning({ id: memberSessionsTable.id });
  invalidateMembershipCache(memberId);
  return rows.length;
}

export async function activeMemberSessions(memberId: string) {
  return db
    .select()
    .from(memberSessionsTable)
    .where(and(eq(memberSessionsTable.memberId, memberId), isNull(memberSessionsTable.revokedAt), gt(memberSessionsTable.createdAt, new Date(Date.now() - SESSION_LIFETIME_MS))))
    .orderBy(desc(memberSessionsTable.lastSeenAt));
}

/** A short, human description of a browser from its user agent. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown browser";
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /node|undici|curl/i.test(ua) ? "Script" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
