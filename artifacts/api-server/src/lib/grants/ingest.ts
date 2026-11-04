import { db, grantOpportunitiesTable, grantSyncRunsTable } from "@workspace/db";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { INGEST_ELIGIBILITY_CODES } from "./eligibility";
import { evaluateGate } from "./gate";
import {
  GRANTS_GOV_CONNECTOR_VERSION,
  GRANTS_GOV_SOURCE,
  checksumOf,
  fetchOpportunityDetail,
  normalizeSearchHit,
  searchOpportunities,
  type FetchLike,
  type NormalizedDetail,
  type NormalizedOpportunity,
} from "./grantsgov";

/**
 * Grants.gov ingestion.
 *
 * Search results do not carry eligibility codes, so the connector runs one
 * search per applicant-type code and merges the codes it saw each opportunity
 * under. Details (award range, cost sharing, description, eligibility text)
 * are fetched for every open opportunity that has none or whose detail is older
 * than a week, a few at a time, and again whenever someone opens an opportunity.
 * Matching needs them: cost sharing and the award range are only in the detail.
 */

const PAGE_SIZE = 100;
const MAX_PER_CODE = 2_000;
const DETAIL_MAX_PER_RUN = Number(process.env.GRANTS_DETAIL_MAX_PER_RUN) || 2_000;
const DETAIL_CONCURRENCY = 4;
const DETAIL_STALE_MS = 7 * 24 * 60 * 60_000;

export interface SyncResult {
  runId: string;
  fetched: number;
  upserted: number;
  details: number;
  status: "succeeded" | "failed";
  error?: string;
}

/** Collects every posted or forecast opportunity, keyed by id, with the eligibility codes it appeared under. */
export async function collectOpportunities(fetchImpl?: FetchLike): Promise<Map<string, { opp: NormalizedOpportunity; codes: Set<string> }>> {
  const found = new Map<string, { opp: NormalizedOpportunity; codes: Set<string> }>();
  for (const code of INGEST_ELIGIBILITY_CODES) {
    let start = 0;
    for (;;) {
      const page = await searchOpportunities({ eligibilities: code, rows: PAGE_SIZE, startRecordNum: start }, fetchImpl);
      for (const hit of page.hits) {
        const opp = normalizeSearchHit(hit);
        if (!opp) continue;
        const entry = found.get(opp.sourceRef);
        if (entry) entry.codes.add(code);
        else found.set(opp.sourceRef, { opp, codes: new Set([code]) });
      }
      start += page.hits.length;
      if (page.hits.length === 0 || start >= page.hitCount || start >= MAX_PER_CODE) break;
    }
  }
  return found;
}

function opportunityRecord(opp: NormalizedOpportunity, eligibilityCodes: string[], detail: NormalizedDetail | null, fetchedAt: Date) {
  const merged = {
    number: opp.number,
    title: opp.title,
    agency: detail?.agency ?? opp.agency,
    agencyCode: opp.agencyCode,
    status: opp.status,
    openDate: detail?.openDate ?? opp.openDate,
    closeDate: detail?.closeDate ?? opp.closeDate,
    assistanceListings: detail?.assistanceListings.length ? detail.assistanceListings : opp.assistanceListings,
    eligibilityCodes: detail?.eligibilityCodes.length ? detail.eligibilityCodes : eligibilityCodes,
    officialUrl: opp.officialUrl,
  };
  const gate = evaluateGate({ ...merged, fetchedAt });
  return { merged, gate };
}

/** Upserts one normalized opportunity; returns true when the stored record changed. */
export async function upsertOpportunity(opp: NormalizedOpportunity, eligibilityCodes: string[], fetchedAt: Date): Promise<boolean> {
  const { merged, gate } = opportunityRecord(opp, eligibilityCodes, null, fetchedAt);
  const checksum = checksumOf(merged);
  const [existing] = await db
    .select({ id: grantOpportunitiesTable.id, checksum: grantOpportunitiesTable.checksum, detailFetchedAt: grantOpportunitiesTable.detailFetchedAt })
    .from(grantOpportunitiesTable)
    .where(and(eq(grantOpportunitiesTable.source, GRANTS_GOV_SOURCE), eq(grantOpportunitiesTable.sourceRef, opp.sourceRef)))
    .limit(1);
  if (existing) {
    if (existing.checksum === checksum) {
      // Re-check the gate (a closing date can pass without the record changing).
      await db.update(grantOpportunitiesTable).set({ fetchedAt, publishable: gate.publishable, gateMissing: gate.missing }).where(eq(grantOpportunitiesTable.id, existing.id));
      return false;
    }
    await db
      .update(grantOpportunitiesTable)
      .set({
        number: merged.number,
        title: merged.title,
        agencyCode: merged.agencyCode,
        status: merged.status,
        openDate: merged.openDate,
        closeDate: merged.closeDate,
        assistanceListings: merged.assistanceListings,
        // Keep the detail record's eligibility codes once they are known.
        ...(existing.detailFetchedAt ? {} : { eligibilityCodes: merged.eligibilityCodes, agency: merged.agency }),
        fetchedAt,
        checksum,
        connectorVersion: GRANTS_GOV_CONNECTOR_VERSION,
        publishable: gate.publishable,
        gateMissing: gate.missing,
      })
      .where(eq(grantOpportunitiesTable.id, existing.id));
    return true;
  }
  await db.insert(grantOpportunitiesTable).values({
    id: randomUUID(),
    source: GRANTS_GOV_SOURCE,
    sourceRef: opp.sourceRef,
    ...merged,
    fetchedAt,
    checksum,
    connectorVersion: GRANTS_GOV_CONNECTOR_VERSION,
    publishable: gate.publishable,
    gateMissing: gate.missing,
  });
  return true;
}

/** Fetches and stores one opportunity's full record. */
export async function refreshOpportunityDetail(id: string, fetchImpl?: FetchLike): Promise<void> {
  const [row] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, id)).limit(1);
  if (!row || row.source !== GRANTS_GOV_SOURCE) return;
  const detail = await fetchOpportunityDetail(row.sourceRef, fetchImpl);
  const now = new Date();
  const closeDate = detail.closeDate ?? row.closeDate;
  const gate = evaluateGate({ title: row.title, officialUrl: row.officialUrl, fetchedAt: now, status: row.status, closeDate });
  await db
    .update(grantOpportunitiesTable)
    .set({
      awardFloor: detail.awardFloor,
      awardCeiling: detail.awardCeiling,
      estimatedFunding: detail.estimatedFunding,
      costSharing: detail.costSharing,
      eligibilityCodes: detail.eligibilityCodes.length ? detail.eligibilityCodes : row.eligibilityCodes,
      eligibilityText: detail.eligibilityText,
      categories: detail.categories,
      description: detail.description,
      closeDate,
      openDate: detail.openDate ?? row.openDate,
      agency: detail.agency ?? row.agency,
      assistanceListings: detail.assistanceListings.length ? detail.assistanceListings : row.assistanceListings,
      detailFetchedAt: now,
      publishable: gate.publishable,
      gateMissing: gate.missing,
    })
    .where(eq(grantOpportunitiesTable.id, id));
}

/** Runs one full sync: search every code, upsert, then fetch missing or week-old details. */
export async function syncGrantsGov(fetchImpl?: FetchLike): Promise<SyncResult> {
  const runId = randomUUID();
  const startedAt = new Date();
  await db.insert(grantSyncRunsTable).values({ id: runId, source: GRANTS_GOV_SOURCE, startedAt, status: "running" });
  let fetched = 0;
  let upserted = 0;
  let details = 0;
  try {
    const found = await collectOpportunities(fetchImpl);
    fetched = found.size;
    for (const { opp, codes } of found.values()) {
      if (await upsertOpportunity(opp, [...codes].sort(), startedAt)) upserted++;
    }
    // Opportunities that were open but no longer appear in an open search are now closed or archived.
    const seen = [...found.keys()];
    if (seen.length > 0) {
      await db
        .update(grantOpportunitiesTable)
        .set({ status: "closed", publishable: false, gateMissing: ["open status (posted or forecasted)"] })
        .where(and(
          eq(grantOpportunitiesTable.source, GRANTS_GOV_SOURCE),
          inArray(grantOpportunitiesTable.status, ["posted", "forecasted"]),
          sql`${grantOpportunitiesTable.sourceRef} NOT IN (${sql.join(seen.map((s) => sql`${s}`), sql`, `)})`,
        ));
    }
    const pending = await db
      .select({ id: grantOpportunitiesTable.id })
      .from(grantOpportunitiesTable)
      .where(and(
        eq(grantOpportunitiesTable.source, GRANTS_GOV_SOURCE),
        eq(grantOpportunitiesTable.publishable, true),
        or(isNull(grantOpportunitiesTable.detailFetchedAt), lt(grantOpportunitiesTable.detailFetchedAt, new Date(startedAt.getTime() - DETAIL_STALE_MS))),
      ))
      // Never-fetched first, then the nearest closing dates.
      .orderBy(sql`${grantOpportunitiesTable.detailFetchedAt} IS NOT NULL`, asc(grantOpportunitiesTable.closeDate))
      .limit(DETAIL_MAX_PER_RUN);
    const queue = pending.map((p) => p.id);
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          await refreshOpportunityDetail(id, fetchImpl);
          details++;
        } catch (err) {
          console.warn("[grants-sync] detail fetch failed", id, (err as Error).message);
        }
      }
    };
    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, worker));
    await db.update(grantSyncRunsTable).set({ status: "succeeded", finishedAt: new Date(), fetched, upserted }).where(eq(grantSyncRunsTable.id, runId));
    return { runId, fetched, upserted, details, status: "succeeded" };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db.update(grantSyncRunsTable).set({ status: "failed", finishedAt: new Date(), fetched, upserted, error: message }).where(eq(grantSyncRunsTable.id, runId));
    return { runId, fetched, upserted, details, status: "failed", error: message };
  }
}

// ── Scheduler (same guarded setInterval pattern as the other schedulers) ──────

const DAY_MS = 24 * 60 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function isGrantSyncRunning(): boolean {
  return running;
}

/** Runs a sync unless one is already running. Returns null when skipped. */
export async function runGrantSyncOnce(fetchImpl?: FetchLike): Promise<SyncResult | null> {
  if (running) return null;
  running = true;
  try {
    const result = await syncGrantsGov(fetchImpl);
    console.log(`[grants-sync] status=${result.status} fetched=${result.fetched} upserted=${result.upserted} details=${result.details}`);
    return result;
  } finally {
    running = false;
  }
}

export function startGrantSyncScheduler(): void {
  // Off in tests (CI starts the API for integration and browser tests) unless enabled explicitly.
  const disabled = process.env.GRANTS_SYNC_DISABLED === "true" || (process.env.NODE_ENV === "test" && process.env.GRANTS_SYNC_ENABLED !== "true");
  if (timer || disabled) return;
  timer = setInterval(() => { void runGrantSyncOnce().catch((err) => console.error("[grants-sync] failed:", err)); }, DAY_MS);
  setTimeout(() => { void runGrantSyncOnce().catch((err) => console.error("[grants-sync] failed:", err)); }, 60_000);
}

export function stopGrantSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
