import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/**
 * Who is making the current request, available anywhere below the route
 * (for example the audit log) without passing `req` through every function.
 */
const store = new AsyncLocalStorage<{ actorName: string | null }>();

export function withRequestContext(req: Request, _res: Response, next: NextFunction): void {
  store.run({ actorName: req.session?.actorName ?? null }, next);
}

/** The signed-in member's name, or null for the team password, API keys and background work. */
export function currentActorName(): string | null {
  return store.getStore()?.actorName ?? null;
}
