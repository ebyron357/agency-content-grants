import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that requires an authenticated session.
 * Returns 401 if the session does not have the authenticated flag set.
 * Apply this to all application-data routes.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.session?.authenticated === true) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}
