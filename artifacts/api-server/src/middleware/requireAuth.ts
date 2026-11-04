import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that requires an authenticated session.
 * Returns 401 if the session does not have the authenticated flag set.
 * Apply this to all application-data routes.
 *
 * A member's session is also checked on every request (cached for
 * MEMBERSHIP_CACHE_MS) against their membership, their account and the
 * member_sessions row for this browser. A removed or disabled member, or a
 * session ended from another device, loses access on the next request, and a
 * role change takes effect at once. In a workspace that requires two-factor,
 * a member who has not turned it on can reach only their own account routes.
 */
const MEMBERSHIP_CACHE_MS = 10_000;
/** lastSeenAt is written at most this often per session. */
const LAST_SEEN_WRITE_MS = 5 * 60_000;

interface Access {
  /** The member's role, or null when the membership, account or session no longer allows access. */
  role: string | null;
  /** The workspace requires two-factor and this member has not turned it on. */
  enrollmentRequired: boolean;
  at: number;
}

const membershipCache = new Map<string, Access>();

/** Clears cached access for one member (after a role, membership, session or two-factor change), or for everyone. */
export function invalidateMembershipCache(memberId?: string): void {
  if (!memberId) {
    membershipCache.clear();
    return;
  }
  for (const key of membershipCache.keys()) if (key.startsWith(`${memberId}|`)) membershipCache.delete(key);
}

async function currentAccess(memberId: string, workspaceId: string, memberSessionId: string): Promise<Access> {
  const key = `${memberId}|${workspaceId}|${memberSessionId}`;
  const cached = membershipCache.get(key);
  if (cached && Date.now() - cached.at < MEMBERSHIP_CACHE_MS) return cached;
  // Loaded on first use so the module stays importable without a database (unit tests, the operator path).
  const [{ and, eq, isNull }, { db, membersTable, membershipsTable, memberSessionsTable, workspacesTable }] = await Promise.all([import("drizzle-orm"), import("@workspace/db")]);
  const [row] = await db
    .select({ role: membershipsTable.role, mfaOn: membersTable.totpEnabledAt, requireMfa: workspacesTable.requireMfa, lastSeenAt: memberSessionsTable.lastSeenAt })
    .from(membershipsTable)
    .innerJoin(membersTable, eq(membershipsTable.memberId, membersTable.id))
    .innerJoin(workspacesTable, eq(membershipsTable.workspaceId, workspacesTable.id))
    .innerJoin(memberSessionsTable, and(eq(memberSessionsTable.id, memberSessionId), eq(memberSessionsTable.memberId, memberId), isNull(memberSessionsTable.revokedAt)))
    .where(and(eq(membershipsTable.memberId, memberId), eq(membershipsTable.workspaceId, workspaceId), eq(membersTable.status, "active")))
    .limit(1);
  const access: Access = { role: row?.role ?? null, enrollmentRequired: !!row && row.requireMfa && !row.mfaOn, at: Date.now() };
  membershipCache.set(key, access);
  if (row && Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_WRITE_MS) {
    db.update(memberSessionsTable).set({ lastSeenAt: new Date() }).where(eq(memberSessionsTable.id, memberSessionId)).catch(() => {});
  }
  return access;
}

/** Routes a member may use before turning on two-factor in a workspace that requires it: their own account and security. */
const ENROLLMENT_ALLOWED = /^\/account(\/|$)/;

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.session?.authenticated !== true) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { memberId, workspaceId, memberSessionId } = req.session;
  if (!memberId) {
    next();
    return;
  }
  if (!workspaceId || !memberSessionId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  currentAccess(memberId, workspaceId, memberSessionId)
    .then((access) => {
      if (!access.role) {
        req.session.destroy(() => res.status(401).json({ error: "You have been signed out. Sign in again to continue." }));
        return;
      }
      req.session.role = access.role;
      if (access.enrollmentRequired && !ENROLLMENT_ALLOWED.test(req.path)) {
        res.status(403).json({ error: "This workspace requires two-factor sign-in. Turn it on in Settings, Team, Your account to continue.", code: "mfa_enrollment_required" });
        return;
      }
      next();
    })
    .catch(next);
}
