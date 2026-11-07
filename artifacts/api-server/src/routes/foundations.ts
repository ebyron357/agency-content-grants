import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db, foundationFundersTable, foundationGrantsTable, foundationImportRunsTable, grantApplicantsTable, type FoundationFunder } from "@workspace/db";
import { requireAdmin } from "../middleware/requireAdmin";
import { logActivity } from "../lib/activity";
import { enqueue } from "../lib/jobs/registry";
import { FOUNDATION_IMPORT_KEY, foundationImportEnabled, foundationImportJob } from "../lib/jobs/definitions";
import { activeJob } from "../lib/jobs/queue";
import { currentWorker } from "../lib/jobs/worker";
import { NTEE_GROUPS } from "../lib/foundations/aggregate";
import { CAUSES, HISTORY_LABEL, SOURCE, breakdown, causeLabel, causesFor, filingLinks, formatEin, stateLabel } from "../lib/foundations/profile";
import { WEIGHTS, policyView, rankFunders, type MatchFunder } from "../lib/foundations/matching";

/**
 * Foundations (docs/GRANT_STUDIO.md, Foundations): search funders and read a
 * funder's giving history, imported from funder-graph by the
 * `foundation_import` job. Mounted behind requireAuth and requirePermission.
 *
 * Funder records are public reference data, like grant opportunities: every
 * workspace reads the same records, and none holds workspace data. The
 * suggestions route reads an organization only through the workspace that
 * owns it; another workspace's id is a 404.
 */
const router: IRouter = Router();

const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 2,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "A foundation import was requested recently. Try again later." },
});

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

const STATE = /^[A-Z]{2}$/;
const queryText = (req: Request, name: string, max: number) => (typeof req.query[name] === "string" ? (req.query[name] as string).trim().slice(0, max) : "");

function summary(f: FoundationFunder) {
  return {
    ein: f.ein,
    einFormatted: formatEin(f.ein),
    name: f.name,
    state: f.state,
    formType: f.formType,
    totalPaidUsd: Number(f.totalPaidUsd),
    grantCount: f.grantCount,
    firstTaxYear: f.firstTaxYear,
    lastTaxYear: f.lastTaxYear,
    medianGrantUsd: f.sizeStats.median ?? null,
    topCauses: breakdown(f.givingByCategory, Number(f.totalPaidUsd), causeLabel, 3),
    applicationPolicy: policyView(f),
    label: HISTORY_LABEL,
  };
}

/** GET /grants/foundations/meta: causes, the source, and the last import. */
router.get("/grants/foundations/meta", async (_req, res): Promise<void> => {
  const [funders] = await db.select({ n: count() }).from(foundationFundersTable);
  const [lastRun] = await db.select().from(foundationImportRunsTable).orderBy(desc(foundationImportRunsTable.startedAt)).limit(1);
  const job = await activeJob(FOUNDATION_IMPORT_KEY);
  res.json({
    label: HISTORY_LABEL,
    source: SOURCE,
    causes: CAUSES,
    funders: Number(funders.n),
    lastImport: lastRun
      ? { status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, datasetVersion: lastRun.datasetVersion, yearsDone: lastRun.yearsDone, minConfidence: lastRun.minConfidence, note: lastRun.note, error: lastRun.error, stats: lastRun.stats }
      : null,
    importJob: job ? { id: job.id, status: job.status, progress: job.progress } : null,
  });
});

/**
 * GET /grants/foundations?q=&state=&givesIn=&cause=&page=: funders by name,
 * the state they file from, a state they gave in, and a cause (NTEE major group).
 */
router.get("/grants/foundations", async (req, res): Promise<void> => {
  const q = queryText(req, "q", 100);
  const state = queryText(req, "state", 10).toUpperCase();
  const givesIn = queryText(req, "givesIn", 10).toUpperCase();
  const cause = queryText(req, "cause", 10).toUpperCase();
  const page = Math.min(400, Math.max(1, Number(req.query.page) || 1));
  const pageSize = 25;
  if ((state && !STATE.test(state)) || (givesIn && !STATE.test(givesIn))) return fail(res, 400, "state and givesIn must be two-letter state codes");
  if (cause && (!NTEE_GROUPS[cause] || cause === "Z")) return fail(res, 400, "cause must be an NTEE major group letter (A to Y)");
  const filters: SQL[] = [];
  if (q) filters.push(ilike(foundationFundersTable.nameSearch, `%${q.toUpperCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
  if (state) filters.push(eq(foundationFundersTable.state, state));
  if (givesIn) filters.push(sql`COALESCE((${foundationFundersTable.givingByState} ->> ${givesIn})::bigint, 0) > 0`);
  if (cause) filters.push(sql`COALESCE((${foundationFundersTable.givingByCategory} ->> ${cause})::bigint, 0) > 0`);
  const where = filters.length ? and(...filters) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(foundationFundersTable).where(where);
  // Ranked by giving where the search asks for it (in the state, to the cause), else by total giving.
  const rank = givesIn ? sql`COALESCE((${foundationFundersTable.givingByState} ->> ${givesIn})::bigint, 0)` : cause ? sql`COALESCE((${foundationFundersTable.givingByCategory} ->> ${cause})::bigint, 0)` : sql`${foundationFundersTable.totalPaidUsd}`;
  const rows = await db.select().from(foundationFundersTable).where(where).orderBy(desc(rank), asc(foundationFundersTable.ein)).limit(pageSize).offset((page - 1) * pageSize);
  res.json({ label: HISTORY_LABEL, total: Number(total), page, pageSize, funders: rows.map(summary) });
});

/** GET /grants/foundations/:ein: one funder's giving history, with its source. */
router.get("/grants/foundations/:ein", async (req, res): Promise<void> => {
  const ein = String(req.params.ein).replace(/-/g, "");
  if (!/^\d{9}$/.test(ein)) return fail(res, 404, "Funder not found");
  const [f] = await db.select().from(foundationFundersTable).where(eq(foundationFundersTable.ein, ein)).limit(1);
  if (!f) return fail(res, 404, "Funder not found");
  const grants = await db.select().from(foundationGrantsTable).where(eq(foundationGrantsTable.funderEin, ein)).orderBy(desc(foundationGrantsTable.amountUsd), asc(foundationGrantsTable.id));
  const total = Number(f.totalPaidUsd);
  const sources = f.categorySources;
  const classified = (sources.ntee ?? 0) + (sources.purpose ?? 0);
  res.json({
    ...summary(f),
    givingByYear: Object.entries(f.givingByYear).map(([year, usd]) => ({ year: Number(year), usd })).sort((a, b) => b.year - a.year),
    givingByState: breakdown(f.givingByState, total, stateLabel, 60),
    givingByCause: breakdown(f.givingByCategory, total, causeLabel, 30),
    causeBasis: { fromNtee: sources.ntee ?? 0, fromPurpose: sources.purpose ?? 0, unclassified: sources.none ?? 0, classifiedShare: f.grantCount ? Math.round((classified / f.grantCount) * 100) : 0 },
    grantSize: f.sizeStats,
    recentGrants: grants.map((g) => ({
      recipientName: g.recipientName, recipientCity: g.recipientCity, recipientState: g.recipientState, recipientEin: g.recipientEin ? formatEin(g.recipientEin) : null,
      amountUsd: Number(g.amountUsd), taxYear: g.taxYear, purpose: g.purpose, cause: g.category ? causeLabel(g.category) : null, objectId: g.objectId,
    })),
    filings: Object.entries(f.filings).map(([taxPeriodEnd, objectId]) => ({ taxPeriodEnd, objectId })).sort((a, b) => b.taxPeriodEnd.localeCompare(a.taxPeriodEnd)),
    // Part XIV line 2b–2d as filed (no contact names), only from the filing the policy came from.
    applicationInfo: policyView(f).status === "unknown" ? {} : f.applicationInfo,
    applicationPolicyFiling: f.applicationPolicyObjectId ? { ...filingLinks(f.ein, f.applicationPolicyObjectId), taxYear: f.applicationPolicyTaxYear, taxPeriodEnd: f.applicationPolicyTaxPeriodEnd } : null,
    source: {
      ...SOURCE,
      datasetVersion: f.datasetVersion,
      latestTaxYear: f.lastTaxYear,
      latestTaxPeriodEnd: f.latestTaxPeriodEnd,
      latestSubmittedOn: f.latestSubmittedOn,
      filing: filingLinks(f.ein, f.latestObjectId),
      updatedAt: f.updatedAt,
    },
  });
});

/**
 * GET /grants/applicants/:id/foundation-suggestions?request=&cause=&hideInvitationOnly=:
 * funders ranked for the organization by giving in its state, to its causes
 * (NTEE major groups), grant size against its budget or request, and how
 * recently and steadily they gave. Each comes with its reasons and the filings
 * behind them. Funding history and a guide to research: never an open call,
 * never an eligibility decision.
 */
const CANDIDATES = 300;
router.get("/grants/applicants/:id/foundation-suggestions", async (req, res): Promise<void> => {
  const [applicant] = await db
    .select()
    .from(grantApplicantsTable)
    .where(and(eq(grantApplicantsTable.id, String(req.params.id)), eq(grantApplicantsTable.userId, req.session.userId!)))
    .limit(1);
  if (!applicant) return fail(res, 404, "Organization not found");
  const state = applicant.state?.trim().toUpperCase() ?? "";
  const extra = queryText(req, "cause", 30).toUpperCase().split(",").map((c) => c.trim()).filter(Boolean);
  if (extra.some((c) => !NTEE_GROUPS[c] || c === "Z")) return fail(res, 400, "cause must be NTEE major group letters (A to Y)");
  const requestText = queryText(req, "request", 15);
  const requestUsd = requestText ? Number(requestText) : null;
  if (requestUsd !== null && (!Number.isFinite(requestUsd) || requestUsd <= 0 || requestUsd > 1e10)) return fail(res, 400, "request must be a positive amount in dollars");
  const hideInvitationOnly = req.query.hideInvitationOnly === "true";
  const fromProfile = causesFor({ state, focusAreas: applicant.focusAreas, mission: applicant.mission });
  const causes = extra.length ? extra.map((key) => ({ key, label: causeLabel(key), from: "your choice" })) : fromProfile;
  const base = {
    label: HISTORY_LABEL,
    state: state || null,
    causes,
    causesFromProfile: fromProfile,
    annualBudget: applicant.annualBudget,
    requestUsd,
    weights: WEIGHTS,
    note: "Suggestions come from past giving in tax filings. They are a starting point for research, not an eligibility decision and not an open call. Many private foundations do not accept unsolicited proposals; check each funder's own instructions.",
  };
  if (!STATE.test(state)) return void res.json({ ...base, missing: "Add the organization's two-letter state to see funders that gave there.", suggestions: [] });
  if (!causes.length) return void res.json({ ...base, missing: "Add focus areas (for example literacy, food security, housing) to see funders that gave to your causes.", suggestions: [] });
  const keys = causes.map((c) => c.key);
  const inState = sql`COALESCE((${foundationFundersTable.givingByState} ->> ${state})::bigint, 0)`;
  const causeGiving = sql.join(keys.map((k) => sql`COALESCE((${foundationFundersTable.givingByCategory} ->> ${k})::bigint, 0)`), sql` + `);
  // Candidates: funders that gave both in the state and to a cause, the largest in-state givers first; then scored on every factor.
  const rows = await db
    .select()
    .from(foundationFundersTable)
    .where(and(sql`${inState} > 0`, sql`(${causeGiving}) > 0`))
    .orderBy(desc(inState), asc(foundationFundersTable.ein))
    .limit(CANDIDATES);
  const [{ latest }] = await db.select({ latest: sql<number | null>`max(${foundationFundersTable.lastTaxYear})` }).from(foundationFundersTable);
  const latestDataYear = Number(latest) || new Date().getUTCFullYear() - 2;
  const byEin = new Map(rows.map((r) => [r.ein, r]));
  const ranked = rankFunders(rows.map((r): MatchFunder => ({ ...r, totalPaidUsd: Number(r.totalPaidUsd) })), { state, causes, annualBudget: applicant.annualBudget, requestUsd }, latestDataYear, { limit: 10, hideInvitationOnly });
  res.json({
    ...base,
    latestDataYear,
    candidates: rows.length,
    suggestions: ranked.map((m) => {
      const f = byEin.get(m.ein)!;
      return { ...summary(f), ...m, label: HISTORY_LABEL };
    }),
  });
});

/** POST /grants/foundations/import: queues an import (admin unlock). While one is queued or running, returns that one. */
function importEnabled(_req: Request, res: Response, next: () => void): void {
  if (foundationImportEnabled()) return next();
  fail(res, 409, "The foundation import is off on this server. The owner turns it on with FOUNDATIONS_IMPORT_ENABLED=true once the database and worker can hold it.");
}

router.post("/grants/foundations/import", requireAdmin, importEnabled, importLimiter, async (req, res): Promise<void> => {
  const { job, created } = await enqueue(foundationImportJob, {}, { dedupeKey: FOUNDATION_IMPORT_KEY, requestedBy: req.session.actorName ?? "operator" });
  if (created) {
    currentWorker()?.nudge();
    await logActivity("foundation_import_requested", "Foundation giving import requested", { userId: req.session.userId }).catch(() => {});
  }
  res.status(202).json({ status: created ? "queued" : job.status, jobId: job.id });
});

export default router;
