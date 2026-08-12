/**
 * Auth for automation action routes: accepts either an existing session
 * cookie (the human dashboard user, always full access) OR an
 * `Authorization: Bearer <api key>` header (a scoped, revocable programmatic
 * caller — see lib/automation/apiKeys.ts and docs/automation-api.md).
 *
 * IMPORTANT: a valid API key must NEVER touch `req.session`. express-session
 * persists whatever's on `req.session` at the end of the response and mints
 * a `sid` cookie for it — writing `userId`/`authenticated` there (even
 * "just for this request") would hand a bearer-key caller a real, long-lived
 * dashboard session cookie, letting them keep full access after their key is
 * revoked, and would let a Bearer header silently overwrite an existing
 * browser session's identity. Instead, a verified API key is attached to a
 * dedicated, request-scoped `req.automationAuth` property that is never
 * part of the session and is discarded when the request ends. Use
 * `getAutomationUserId(req)` (not `req.session.userId`) anywhere under
 * `/api/automation/*` to read "whoever is authorized for this request".
 */
import type { Request, Response, NextFunction } from "express";
import { verifyApiKey } from "../lib/automation/apiKeys";
import type { AutomationScope } from "../lib/automation/scopes";

declare global {
  namespace Express {
    interface Request {
      /** Set only for API-key-authenticated requests; never persisted to the session. Absent (full access) for session auth. */
      automationAuth?: { userId: string; scopes: string[] };
    }
  }
}

export async function requireApiKeyOrSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const rawKey = authHeader.slice("Bearer ".length).trim();
    const apiKey = await verifyApiKey(rawKey);
    if (!apiKey) {
      res.status(401).json({ error: "Invalid or revoked API key." });
      return;
    }
    // Deliberately NOT `req.session.userId = ...` — see file header.
    req.automationAuth = { userId: apiKey.userId, scopes: (apiKey.scopes as string[]) ?? [] };
    next();
    return;
  }

  if (req.session?.authenticated === true) {
    next(); // human session — full access, no scope restriction
    return;
  }

  res.status(401).json({ error: "Unauthorized. Provide a session cookie or an 'Authorization: Bearer <api key>' header." });
}

/** The user authorized for this request, whichever auth method was used. Only valid downstream of requireApiKeyOrSession. */
export function getAutomationUserId(req: Request): string {
  return req.automationAuth?.userId ?? req.session.userId!;
}

/** Gate a route on a specific scope. A no-op for session-authenticated requests (req.automationAuth is undefined). */
export function requireScope(scope: AutomationScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.automationAuth) { next(); return; } // session auth — full access
    if (req.automationAuth.scopes.includes(scope)) { next(); return; }
    res.status(403).json({ error: `This API key does not have the '${scope}' scope.` });
  };
}
