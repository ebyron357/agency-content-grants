/**
 * API key management — session-authenticated CRUD for the bearer tokens
 * external tools (e.g. n8n) use against /automation/* instead of a session
 * cookie. See lib/automation/apiKeys.ts and docs/automation-api.md.
 */
import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import { getApiKeyOwned } from "../middleware/ownershipHelpers";
import { generateApiKey } from "../lib/automation/apiKeys";
import { AUTOMATION_SCOPES, isValidScope } from "../lib/automation/scopes";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

function paramId(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

function serialize(key: typeof apiKeysTable.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

// GET /api-keys — list the caller's keys. Never returns the raw key or its hash.
router.get("/api-keys", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const keys = await db.select().from(apiKeysTable).where(eq(apiKeysTable.userId, userId));
  res.json(keys.map(serialize));
});

// POST /api-keys — create a new key. The raw value is returned exactly once and never stored.
router.post("/api-keys", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (scopes.length === 0 || !scopes.every(isValidScope)) {
    res.status(400).json({ error: `scopes must be a non-empty array from: ${AUTOMATION_SCOPES.join(", ")}` });
    return;
  }

  const { raw, hash, displayPrefix } = generateApiKey();
  const [key] = await db.insert(apiKeysTable).values({
    id: randomUUID(),
    userId,
    name,
    keyPrefix: displayPrefix,
    keyHash: hash,
    scopes,
  }).returning();

  await logActivity("api_key_created", `API key "${name}" created`, { userId }).catch(() => {});
  res.status(201).json({ ...serialize(key), key: raw });
});

// DELETE /api-keys/:id — revoke (not delete) so audit/activity history stays intact.
router.delete("/api-keys/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const key = await getApiKeyOwned(paramId(req.params.id), userId, res);
  if (!key) return;
  if (key.revokedAt) { res.json(serialize(key)); return; }

  const [revoked] = await db.update(apiKeysTable).set({ revokedAt: new Date() }).where(eq(apiKeysTable.id, key.id)).returning();
  await logActivity("api_key_revoked", `API key "${key.name}" revoked`, { userId }).catch(() => {});
  res.json(serialize(revoked));
});

export default router;
