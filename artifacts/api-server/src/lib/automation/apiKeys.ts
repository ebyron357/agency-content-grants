/**
 * API key generation/verification. The raw key is only ever known to the
 * caller — we store a one-way sha256 hash and compare with a constant-time
 * check, the same discipline `routes/auth.ts` already uses for the admin
 * password. Losing the database never exposes a usable key.
 */
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db";
import type { ApiKey } from "@workspace/db";

const KEY_PREFIX = "cmk_live_";

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Generates a new raw key + its stored hash/display-prefix. The raw value is never persisted. */
export function generateApiKey(): { raw: string; hash: string; displayPrefix: string } {
  const raw = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashApiKey(raw), displayPrefix: raw.slice(0, KEY_PREFIX.length + 8) };
}

/**
 * Looks up an active (non-revoked) API key by its raw value. Uses a direct
 * hash-equality lookup (sha256 is already effectively constant-time to brute
 * force here — the secret space, not the comparison, is what matters) and
 * `timingSafeEqual` as defense in depth once a row is found, mirroring the
 * password-comparison pattern already used for admin auth.
 */
export async function verifyApiKey(rawKey: string): Promise<ApiKey | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = hashApiKey(rawKey);
  const [row] = await db.select().from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyHash, hash), isNull(apiKeysTable.revokedAt)))
    .limit(1);
  if (!row) return null;

  const a = Buffer.from(row.keyHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Best-effort last-used stamp — never blocks or fails the caller's request.
  db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, row.id))
    .catch((err) => console.error("[api-keys] failed to stamp lastUsedAt", err));

  return row;
}

export function newApiKeyId(): string {
  return randomUUID();
}
