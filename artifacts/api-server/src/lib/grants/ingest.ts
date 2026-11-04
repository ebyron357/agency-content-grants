import { db, grantOpportunitiesTable, grantSyncRunsTable } from "@workspace/db";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { INGEST_ELIGIBILITY_CODES } from "./eligibility";
import { evaluateGate } from "./gate";
import { emitDeadlineReminders, emitMatchAlerts } from "./alerts";
import { CA_CONNECTOR_VERSION, CA_SOURCE, caChecksum, fetchOpenCaRecords, normalizeCaRecord, type CaFetchLike } from "./california";
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
  /** grant.new_matches and grant.deadline_approaching events emitted after the sync. */
  alerts?: number;
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

/**
 * California Grants Portal sync: every open record is complete, so it is
 * upserted with its detail, gated, and records that leave the open set are
 * marked closed. Recorded as its own sync run.
 */
export async function syncCalifornia(fetchImpl?: CaFetchLike): Promise<SyncResult> {
  const runId = randomUUID();
  const startedAt = new Date();
  await db.insert(grantSyncRunsTable).values({ id: runId, source: CA_SOURCE, startedAt, status: "running" });
  let fetched = 0;
  let upserted = 0;
  try {
    const records = await fetchOpenCaRecords(fetchImpl);
    const seen: string[] = [];
    for (const raw of records) {
      const rec = normalizeCaRecord(raw);
      if (!rec) continue;
      fetched++;
      seen.push(rec.sourceRef);
      const checksum = caChecksum(rec);
      const gate = evaluateGate({ title: rec.title, officialUrl: rec.officialUrl, fetchedAt: startedAt, status: rec.status, closeDate: rec.closeDate, rollingDeadline: rec.rollingDeadline }, startedAt);
      const { sourceRef, ...fields } = rec;
      const [existing] = await db
        .select({ id: grantOpportunitiesTable.id, checksum: grantOpportunitiesTable.checksum })
        .from(grantOpportunitiesTable)
        .where(and(eq(grantOpportunitiesTable.source, CA_SOURCE), eq(grantOpportunitiesTable.sourceRef, sourceRef)))
        .limit(1);
      const common = { fetchedAt: startedAt, detailFetchedAt: startedAt, publishable: gate.publishable, gateMissing: gate.missing };
      if (existing && existing.checksum === checksum) {
        await db.update(grantOpportunitiesTable).set(common).where(eq(grantOpportunitiesTable.id, existing.id));
        continue;
      }
      if (existing) {
        await db.update(grantOpportunitiesTable).set({ ...fields, ...common, checksum, connectorVersion: CA_CONNECTOR_VERSION }).where(eq(grantOpportunitiesTable.id, existing.id));
      } else {
        await db.insert(grantOpportunitiesTable).values({ id: randomUUID(), source: CA_SOURCE, sourceRef, ...fields, ...common, checksum, connectorVersion: CA_CONNECTOR_VERSION });
      }
      upserted++;
    }
    if (seen.length > 0) {
      await db
        .update(grantOpportunitiesTable)
        .set({ status: "closed", publishable: false, gateMissing: ["open status (posted or forecasted)"] })
        .where(and(
          eq(grantOpportunitiesTable.source, CA_SOURCE),
          inArray(grantOpportunitiesTable.status, ["posted", "forecasted"]),
          sql`${grantOpportunitiesTable.sourceRef} NOT IN (${sql.join(seen.map((v) => sql`${v}`), sql`, `)})`,
        ));
    }
    await db.update(grantSyncRunsTable).set({ status: "succeeded", finishedAt: new Date(), fetched, upserted }).where(eq(grantSyncRunsTable.id, runId));
    return { runId, fetched, upserted, details: fetched, status: "succeeded" };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db.update(grantSyncRunsTable).set({ status: "failed", finishedAt: new Date(), fetched, upserted, error: message }).where(eq(grantSyncRunsTable.id, runId));
    return { runId, fetched, upserted, details: 0, status: "failed", error: message };
  }
}

// ── The sync job ─────────────────────────────────────────────────────────────
// Runs as the "grant_sync" background job (lib/jobs/definitions.ts): the queue
// keeps one at a time, retries it with backoff, and schedules it daily.

export interface GrantSyncProgress {
  step: "grants.gov" | "california" | "alerts" | "done";
  [key: string]: unknown;
}

/** Refreshes every source, then sends alerts. Throws when every source failed, so the job is retried. */
export async function runGrantSync(opts: { fetchImpl?: FetchLike; caFetch?: CaFetchLike; onProgress?: (p: GrantSyncProgress) => Promise<void> | void; signal?: AbortSignal } = {}): Promise<{ grantsGov: SyncResult; california: SyncResult | null; alerts: number | null }> {
  const report = async (p: GrantSyncProgress) => {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("Aborted");
    await opts.onProgress?.(p);
  };
  await report({ step: "grants.gov" });
  const grantsGov = await syncGrantsGov(opts.fetchImpl);
  console.log(`[grants-sync] grants.gov status=${grantsGov.status} fetched=${grantsGov.fetched} upserted=${grantsGov.upserted} details=${grantsGov.details}`);
  let california: SyncResult | null = null;
  if (process.env.GRANTS_CA_DISABLED !== "true") {
    await report({ step: "california", grantsGov: { status: grantsGov.status, upserted: grantsGov.upserted } });
    california = await syncCalifornia(opts.caFetch);
    console.log(`[grants-sync] california status=${california.status} fetched=${california.fetched} upserted=${california.upserted}${california.error ? ` error=${california.error}` : ""}`);
  }
  // Alerts are best-effort: a failure here must not mark a good sync as failed.
  let alerts: number | null = null;
  await report({ step: "alerts" });
  try {
    alerts = (await emitMatchAlerts()).events + (await emitDeadlineReminders());
  } catch (err) {
    console.warn("[grants-sync] alerts failed", (err as Error).message);
  }
  const failed = [grantsGov, california].filter((r): r is SyncResult => r !== null && r.status === "failed");
  if (failed.length === (california ? 2 : 1)) throw new Error(`Every grant source failed: ${failed.map((r) => r.error ?? "unknown error").join("; ")}`);
  return { grantsGov, california, alerts };
}
