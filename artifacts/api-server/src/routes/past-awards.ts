import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, grantApplicantsTable, grantOpportunitiesTable, type UsaspendingAwardCache } from "@workspace/db";
import { enqueue } from "../lib/jobs/registry";
import { usaspendingAwardsJob, usaspendingKey } from "../lib/jobs/definitions";
import { runJobNow } from "../lib/jobs/worker";
import { awardsOf, cacheRow, cacheState, markRequested, pastAwardsConfig, readCache } from "../lib/grants/pastAwards";
import { LABEL, awardUrl, normalizeProgramNumber, summarize, type PastAward } from "../lib/grants/usaspending";

/**
 * Past federal awards on a federal opportunity (docs/GRANT_STUDIO.md, Past
 * federal awards). Mounted behind requireAuth and requirePermission.
 *
 * Award records are public reference data, like opportunities. The page reads
 * the cache only; a missing or expired listing queues one `usaspending_awards`
 * job (one per listing at a time), and the first view of a listing waits a few
 * seconds for it. When USAspending cannot be reached, the last stored copy is
 * shown with the date it was read, or the panel says plainly that the data is
 * unavailable. The organization (for in-state awards) is read only through the
 * workspace that owns it.
 */
const router: IRouter = Router();

const MAX_LISTINGS = 3;
const FIRST_READ_WAIT_MS = 4_000;
const SOURCE = {
  name: "USAspending.gov",
  url: "https://www.usaspending.gov",
  api: "https://api.usaspending.gov",
  terms: "USAspending.gov data is public federal spending data published by the U.S. Department of the Treasury; the API needs no key.",
  note: "Grants only (award types 02–05: block, formula, project and cooperative agreements), by the award's start date. Award amounts are the federal obligation USAspending reports.",
};

function awardView(a: PastAward) {
  return { ...a, url: awardUrl(a.generatedId) };
}

function listingView(programNumber: string, row: UsaspendingAwardCache | undefined, state: string | null, now: number, enabled: boolean) {
  const base = { programNumber, label: LABEL };
  if (!enabled) return { ...base, status: "off" as const, message: "Past federal awards are turned off on this server.", fetchedAt: null, summary: null };
  const { state: cache } = cacheState(row, now);
  if (!row?.fetchedAt) {
    if (row?.status === "error") {
      return { ...base, status: "unavailable" as const, message: `USAspending could not be reached when we last tried (${row.attemptedAt.toISOString().slice(0, 10)}). We will try again later.`, fetchedAt: null, summary: null };
    }
    return { ...base, status: "loading" as const, message: "Reading past awards from USAspending. This takes a few seconds the first time.", fetchedAt: null, summary: null };
  }
  const s = summarize(awardsOf(row), state);
  const summary = {
    ...s,
    totalAwards: row.totalAwards,
    period: { start: row.periodStart, end: row.periodEnd },
    recent: s.recent.map(awardView),
    inState: s.inState ? { ...s.inState, awards: s.inState.awards.map(awardView) } : null,
  };
  const read = row.fetchedAt.toISOString().slice(0, 10);
  if (cache === "ready") return { ...base, status: "ready" as const, message: null, fetchedAt: row.fetchedAt, summary };
  if (cache === "error") return { ...base, status: "stale" as const, message: `USAspending could not be reached just now. Showing the copy read on ${read}.`, fetchedAt: row.fetchedAt, summary };
  return { ...base, status: "stale" as const, message: `Showing the copy read on ${read}; a fresh copy is on its way.`, fetchedAt: row.fetchedAt, summary };
}

/** GET /grants/opportunities/:id/past-awards?applicantId=: recent awards under the opportunity's Assistance Listings. */
router.get("/grants/opportunities/:id/past-awards", async (req, res): Promise<void> => {
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, String(req.params.id))).limit(1);
  if (!opp) return void res.status(404).json({ error: "Opportunity not found" });
  const base = { label: LABEL, source: SOURCE };
  if (opp.jurisdiction || opp.source !== "grants_gov") {
    return void res.json({ ...base, applicable: false, reason: "Past federal awards are shown for federal programs from Grants.gov. This is a state program.", state: null, listings: [] });
  }
  const programs = [...new Set(opp.assistanceListings.map(normalizeProgramNumber).filter((p): p is string => p !== null))].slice(0, MAX_LISTINGS);
  if (!programs.length) return void res.json({ ...base, applicable: false, reason: "The official record lists no Assistance Listing number, so past awards cannot be looked up.", state: null, listings: [] });

  let state: string | null = null;
  const applicantId = typeof req.query.applicantId === "string" ? req.query.applicantId : "";
  if (applicantId) {
    const [applicant] = await db.select({ state: grantApplicantsTable.state }).from(grantApplicantsTable).where(and(eq(grantApplicantsTable.id, applicantId), eq(grantApplicantsTable.userId, req.session.userId!))).limit(1);
    const s = applicant?.state?.trim().toUpperCase() ?? "";
    state = /^[A-Z]{2}$/.test(s) ? s : null;
  }

  const cfg = pastAwardsConfig();
  const rows = await readCache(programs);
  if (cfg.enabled) {
    const now = Date.now();
    for (const p of programs) {
      const { state: cache, refresh } = cacheState(rows.get(p), now, cfg);
      if (!refresh) continue;
      const { job } = await enqueue(usaspendingAwardsJob, { programNumber: p }, { dedupeKey: usaspendingKey(p), requestedBy: "past-awards" });
      // The first view of a listing waits briefly for the read; later views show the stored copy while it refreshes.
      if (cache === "missing") {
        await runJobNow(job.id, FIRST_READ_WAIT_MS).catch((err) => console.warn("[past-awards] read failed", p, (err as Error).message));
        const row = await cacheRow(p);
        if (row) rows.set(p, row);
      }
    }
    await markRequested(programs);
  }
  const now = Date.now();
  res.json({ ...base, applicable: true, reason: null, state, listings: programs.map((p) => listingView(p, rows.get(p), state, now, cfg.enabled)) });
});

export default router;
