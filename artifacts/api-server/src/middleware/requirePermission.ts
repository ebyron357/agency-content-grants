import type { Request, Response, NextFunction } from "express";
import { PERMISSIONS, ROLES, hasPermission, requirementFor, rolesWith } from "../lib/permissions";

/**
 * Enforces the per-role permissions in lib/permissions.ts for session
 * requests. Mounted after requireAuth, which refreshes `session.role` from the
 * membership on every member request. A session without a member is the team
 * password, which signs in as the agency workspace's owner. API-key requests
 * carry their own scopes and are not affected.
 */
export function requirePermission(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated !== true) {
    next();
    return;
  }
  const role = req.session.memberId ? req.session.role : (req.session.role ?? "owner");
  const { needs } = requirementFor(req.method, req.path);
  if (hasPermission(role, needs)) {
    next();
    return;
  }
  const first = typeof needs === "string" ? needs : needs[0];
  const label = (r: string) => (ROLES as Record<string, { label: string }>)[r]?.label ?? r;
  res.status(403).json({
    error: `Your role (${label(role ?? "none")}) cannot ${PERMISSIONS[first].charAt(0).toLowerCase()}${PERMISSIONS[first].slice(1)}. Ask an owner or admin; this needs: ${rolesWith(needs).map(label).join(", ")}.`,
    code: "forbidden_by_role",
    needs,
  });
}
