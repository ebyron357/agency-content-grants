import { eq } from "drizzle-orm";
import { db, nonprofitLookupsTable } from "@workspace/db";
import { fetchOrganization, type LookupOutcome, type NonprofitRecord } from "./propublica";

/**
 * Cached EIN lookups (docs/SELF_SIGNUP.md §5). A found organization is kept 30
 * days and an unknown EIN 1 day, so a person retrying, and other workspaces
 * looking up the same organization, do not call ProPublica again. A failed
 * request (timeout, outage) is never cached.
 */
export const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

export type CachedOutcome = LookupOutcome & { cached: boolean; fetchedAt: Date | null };

export async function lookupOrganization(ein: string, now: Date = new Date()): Promise<CachedOutcome> {
  const [hit] = await db.select().from(nonprofitLookupsTable).where(eq(nonprofitLookupsTable.ein, ein)).limit(1);
  if (hit) {
    const age = now.getTime() - hit.fetchedAt.getTime();
    if (hit.status === "found" && hit.data && age < FOUND_TTL_MS) return { kind: "found", record: hit.data as unknown as NonprofitRecord, cached: true, fetchedAt: hit.fetchedAt };
    if (hit.status === "not_found" && age < NOT_FOUND_TTL_MS) return { kind: "not_found", cached: true, fetchedAt: hit.fetchedAt };
  }
  const outcome = await fetchOrganization(ein);
  if (outcome.kind === "unavailable") return { ...outcome, cached: false, fetchedAt: null };
  const values = { status: outcome.kind, data: outcome.kind === "found" ? (outcome.record as unknown as Record<string, unknown>) : null, fetchedAt: now };
  await db.insert(nonprofitLookupsTable).values({ ein, ...values }).onConflictDoUpdate({ target: nonprofitLookupsTable.ein, set: values });
  return { ...outcome, cached: false, fetchedAt: now };
}

/** The cached record for an EIN, if one was found and is still fresh. Used to record where prefilled facts came from. */
export async function cachedRecord(ein: string, now: Date = new Date()): Promise<{ record: NonprofitRecord; fetchedAt: Date } | null> {
  const [hit] = await db.select().from(nonprofitLookupsTable).where(eq(nonprofitLookupsTable.ein, ein)).limit(1);
  if (!hit || hit.status !== "found" || !hit.data || now.getTime() - hit.fetchedAt.getTime() >= FOUND_TTL_MS) return null;
  return { record: hit.data as unknown as NonprofitRecord, fetchedAt: hit.fetchedAt };
}
