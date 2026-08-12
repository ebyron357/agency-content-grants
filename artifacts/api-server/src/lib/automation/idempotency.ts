/**
 * Idempotency-key middleware for automation action endpoints — the Stripe
 * pattern: a caller sends `Idempotency-Key: <opaque string>` on a POST; a
 * retried request with the same key and the same body replays the original
 * response instead of repeating the side effect. A key reused with a
 * *different* body is rejected (it's a caller bug, not a safe retry).
 *
 * Claimed via a first-insert-wins unique constraint on
 * (userId, endpoint, idempotencyKey), so two concurrent identical requests
 * can't both "win" and both run the handler.
 */
import { randomUUID, createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeysTable } from "@workspace/db";
import { getAutomationUserId } from "../../middleware/requireApiKeyOrSession";

// An "in_progress" row older than this is assumed to belong to a request
// whose process crashed before completing — reclaimed so the caller's retry
// isn't blocked forever, mirroring the stale-claim recovery pattern used by
// the Content Distribution Engine's claim/fencing-token logic.
const STALE_CLAIM_MS = 2 * 60_000;

const UNIQUE_VIOLATION = "23505";

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

export function withIdempotency(endpoint: string | ((req: Request) => string)) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      res.status(400).json({ error: "This action requires an 'Idempotency-Key' header so retries can't repeat the side effect." });
      return;
    }
    // A route with a path param (e.g. :id) MUST resolve `endpoint` per-request
    // (pass a function), or two different resources reached through the same
    // route template would share one idempotency namespace — a key reused
    // (with an identical body) against a *different* resource would wrongly
    // replay the first resource's response instead of acting on the second.
    const resolvedEndpoint = typeof endpoint === "function" ? endpoint(req) : endpoint;
    const userId = getAutomationUserId(req);
    const requestHash = hashBody(req.body);

    const existing = await loadOrReclaim(userId, resolvedEndpoint, key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        res.status(422).json({ error: "This Idempotency-Key was already used with a different request body." });
        return;
      }
      if (existing.status === "in_progress") {
        res.status(409).json({ error: "A request with this Idempotency-Key is already being processed." });
        return;
      }
      res.status(existing.responseStatus ?? 200).json(existing.responseBody ?? {});
      return;
    }

    try {
      await db.insert(idempotencyKeysTable).values({
        id: randomUUID(), userId, endpoint: resolvedEndpoint, idempotencyKey: key, requestHash, status: "in_progress",
      });
    } catch (err: any) {
      if (err?.code === UNIQUE_VIOLATION) {
        // Lost the race to a concurrent identical request — replay/reject exactly as above.
        const race = await loadOrReclaim(userId, resolvedEndpoint, key);
        if (race) {
          if (race.requestHash !== requestHash) {
            res.status(422).json({ error: "This Idempotency-Key was already used with a different request body." });
            return;
          }
          if (race.status === "in_progress") {
            res.status(409).json({ error: "A request with this Idempotency-Key is already being processed." });
            return;
          }
          res.status(race.responseStatus ?? 200).json(race.responseBody ?? {});
          return;
        }
      }
      next(err);
      return;
    }

    // Capture whatever the handler eventually sends so a retry can replay it.
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      db.update(idempotencyKeysTable)
        .set({ status: "completed", responseStatus: res.statusCode, responseBody: body as any })
        .where(and(eq(idempotencyKeysTable.userId, userId), eq(idempotencyKeysTable.endpoint, resolvedEndpoint), eq(idempotencyKeysTable.idempotencyKey, key)))
        .catch((err) => console.error("[idempotency] failed to record response", err));
      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}

async function loadOrReclaim(userId: string, endpoint: string, key: string) {
  const [row] = await db.select().from(idempotencyKeysTable)
    .where(and(eq(idempotencyKeysTable.userId, userId), eq(idempotencyKeysTable.endpoint, endpoint), eq(idempotencyKeysTable.idempotencyKey, key)))
    .limit(1);
  if (!row) return null;
  if (row.status === "in_progress" && row.updatedAt.getTime() < Date.now() - STALE_CLAIM_MS) {
    // Treat an abandoned claim as if it never happened — delete and let the caller re-claim it fresh.
    await db.delete(idempotencyKeysTable).where(
      and(eq(idempotencyKeysTable.userId, userId), eq(idempotencyKeysTable.endpoint, endpoint), eq(idempotencyKeysTable.idempotencyKey, key), lt(idempotencyKeysTable.updatedAt, new Date(Date.now() - STALE_CLAIM_MS))),
    );
    return null;
  }
  return row;
}
