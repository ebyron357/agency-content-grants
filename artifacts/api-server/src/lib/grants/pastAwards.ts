import { asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, usaspendingAwardCacheTable, type UsaspendingAwardCache } from "@workspace/db";
import { DEFAULT_API_BASE, readListing, UsaspendingError, type FetchLike, type PastAward } from "./usaspending";
import { PermanentJobError } from "../jobs/types";

/**
 * The past-award cache (docs/GRANT_STUDIO.md, Past federal awards). A page
 * reads only this table. The `usaspending_awards` job fills a listing the
 * first time someone asks for it and refreshes it once it is older than its
 * TTL, so USAspending is called at most once per listing per TTL, whatever
 * the traffic. A failed read keeps the last good data and records the error.
 */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.trunc(n) : fallback;
}

export const pastAwardsConfig = () => ({
  enabled: process.env.USASPENDING_DISABLED !== "true",
  apiBase: process.env.USASPENDING_API_BASE?.trim() || DEFAULT_API_BASE,
  ttlMs: intEnv("USASPENDING_TTL_HOURS", 168, 1, 24 * 90) * 60 * 60_000,
  retryMs: intEnv("USASPENDING_RETRY_MINUTES", 60, 1, 24 * 60) * 60_000,
  maxListings: intEnv("USASPENDING_MAX_LISTINGS", 500, 10, 20_000),
});

/** Listings nobody has asked for in this long are removed. */
export const FORGET_AFTER_MS = 90 * 24 * 60 * 60_000;

let fetchOverride: FetchLike | undefined;
/** Tests point the job at recorded responses. */
export function setUsaspendingFetch(f: FetchLike | undefined): void {
  fetchOverride = f;
}

/** Reads one listing from USAspending and stores it. Throws (for a retry) when the API fails; the error is recorded either way. */
export async function refreshListing(programNumber: string, opts: { signal?: AbortSignal; now?: Date } = {}): Promise<{ programNumber: string; awards: number; totalAwards: number | null }> {
  const cfg = pastAwardsConfig();
  const now = opts.now ?? new Date();
  try {
    const read = await readListing(programNumber, { apiBase: cfg.apiBase, fetchImpl: fetchOverride, signal: opts.signal, now });
    const values = {
      status: "ready", fetchedAt: now, attemptedAt: now, lastError: null, periodStart: read.window.start, periodEnd: read.window.end,
      totalAwards: read.totalAwards, awards: read.awards as unknown as Record<string, unknown>[],
    };
    await db.insert(usaspendingAwardCacheTable).values({ programNumber, ...values, requestedAt: now }).onConflictDoUpdate({ target: usaspendingAwardCacheTable.programNumber, set: values });
    await prune(cfg.maxListings, now);
    return { programNumber, awards: read.awards.length, totalAwards: read.totalAwards };
  } catch (err) {
    const message = (err as Error).message?.slice(0, 300) || "USAspending read failed";
    await db
      .insert(usaspendingAwardCacheTable)
      .values({ programNumber, status: "error", attemptedAt: now, lastError: message, requestedAt: now })
      .onConflictDoUpdate({ target: usaspendingAwardCacheTable.programNumber, set: { status: "error", attemptedAt: now, lastError: message } });
    if (err instanceof UsaspendingError && err.permanent) throw new PermanentJobError(message);
    throw err;
  }
}

/** Keeps the cache inside its budget: forgets listings nobody asked for in 90 days, then the least recently asked beyond the cap. */
export async function prune(maxListings: number, now = new Date()): Promise<number> {
  const old = await db.delete(usaspendingAwardCacheTable).where(lt(usaspendingAwardCacheTable.requestedAt, new Date(now.getTime() - FORGET_AFTER_MS))).returning({ p: usaspendingAwardCacheTable.programNumber });
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(usaspendingAwardCacheTable)) as { n: number }[];
  let extra = 0;
  if (n > maxListings) {
    const victims = await db.select({ p: usaspendingAwardCacheTable.programNumber }).from(usaspendingAwardCacheTable).orderBy(asc(usaspendingAwardCacheTable.requestedAt)).limit(n - maxListings);
    if (victims.length) extra = (await db.delete(usaspendingAwardCacheTable).where(inArray(usaspendingAwardCacheTable.programNumber, victims.map((v) => v.p))).returning({ p: usaspendingAwardCacheTable.programNumber })).length;
  }
  return old.length + extra;
}

export type CacheState = "ready" | "stale" | "missing" | "error";

/** What a stored row means now, and whether a refresh should be queued. */
export function cacheState(row: UsaspendingAwardCache | undefined, now: number, cfg = pastAwardsConfig()): { state: CacheState; refresh: boolean } {
  if (!row) return { state: "missing", refresh: true };
  const recentlyFailed = row.status === "error" && now - row.attemptedAt.getTime() < cfg.retryMs;
  if (!row.fetchedAt) return { state: "error", refresh: !recentlyFailed };
  const fresh = now - row.fetchedAt.getTime() < cfg.ttlMs;
  if (fresh) return { state: "ready", refresh: false };
  return { state: row.status === "error" ? "error" : "stale", refresh: !recentlyFailed };
}

export async function readCache(programNumbers: string[]): Promise<Map<string, UsaspendingAwardCache>> {
  if (!programNumbers.length) return new Map();
  const rows = await db.select().from(usaspendingAwardCacheTable).where(inArray(usaspendingAwardCacheTable.programNumber, programNumbers));
  return new Map(rows.map((r) => [r.programNumber, r]));
}

export async function markRequested(programNumbers: string[], now = new Date()): Promise<void> {
  if (programNumbers.length) await db.update(usaspendingAwardCacheTable).set({ requestedAt: now }).where(inArray(usaspendingAwardCacheTable.programNumber, programNumbers));
}

export const awardsOf = (row: UsaspendingAwardCache | undefined): PastAward[] => (row?.awards ?? []) as unknown as PastAward[];

export async function cacheRow(programNumber: string): Promise<UsaspendingAwardCache | undefined> {
  return (await db.select().from(usaspendingAwardCacheTable).where(eq(usaspendingAwardCacheTable.programNumber, programNumber)).limit(1))[0];
}
