import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that requires an authenticated session.
 * Returns 401 if the session does not have the authenticated flag set.
 * Apply this to all application-data routes.
 *
 * A member's session is also checked against their membership on every
 * request (cached for MEMBERSHIP_CACHE_MS), so a removed or disabled member
 * loses access at once rather than when the session expires, and a role
 * change takes effect on the next request.
 */
const MEMBERSHIP_CACHE_MS = 10_000;
const membershipCache = new Map<string, { role: string | null; at: number }>();

export function invalidateMembershipCache(memberId?: string): void {
  if (!memberId) {
    membershipCache.clear();
    return;
  }
  for (const key of membershipCache.keys()) if (key.startsWith(`${memberId}|`)) membershipCache.delete(key);
}

async function currentRole(memberId: string, workspaceId: string): Promise<string | null> {
  const key = `${memberId}|${workspaceId}`;
  const cached = membershipCache.get(key);
  if (cached && Date.now() - cached.at < MEMBERSHIP_CACHE_MS) return cached.role;
  // Loaded on first use so the module stays importable without a database (unit tests, the operator path).
  const [{ and, eq }, { db, membersTable, membershipsTable }] = await Promise.all([import("drizzle-orm"), import("@workspace/db")]);
  const [row] = await db
    .select({ role: membershipsTable.role })
    .from(membershipsTable)
    .innerJoin(membersTable, eq(membershipsTable.memberId, membersTable.id))
    .where(and(eq(membershipsTable.memberId, memberId), eq(membershipsTable.workspaceId, workspaceId), eq(membersTable.status, "active")))
    .limit(1);
  const role = row?.role ?? null;
  membershipCache.set(key, { role, at: Date.now() });
  return role;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.session?.authenticated !== true) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { memberId, workspaceId } = req.session;
  if (!memberId) {
    next();
    return;
  }
  if (!workspaceId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  currentRole(memberId, workspaceId)
    .then((role) => {
      if (!role) {
        req.session.destroy(() => res.status(401).json({ error: "Your access to this workspace has ended." }));
        return;
      }
      req.session.role = role;
      next();
    })
    .catch(next);
}
