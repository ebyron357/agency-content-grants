import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that requires an authenticated session with admin access
 * unlocked (see POST /api/auth/admin-unlock in routes/auth.ts).
 * Returns 401 if unauthenticated, 403 if authenticated but not admin.
 * Apply to mutations of global/shared resources (blueprints, dependency
 * registry, AI provider tests, model configuration).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.session.isAdmin !== true) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
