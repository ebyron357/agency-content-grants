import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createHash, randomUUID } from "crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, count } from "drizzle-orm";
import {
  db,
  grantApplicantsTable,
  grantApplicationsTable,
  grantApprovalsTable,
  grantBudgetLinesTable,
  grantClaimFlagsTable,
  grantFactsTable,
  grantFederalFormsTable,
  grantNoticesTable,
  grantSnippetsTable,
  grantSupportLettersTable,
  grantOpportunitiesTable,
  grantReadinessItemsTable,
  grantRequirementsTable,
  grantSectionsTable,
  grantSyncRunsTable,
  jobsTable,
  usersTable,
  type GrantApplicant,
  type GrantApplication,
  type GrantFact,
  type GrantSnippet,
  type GrantSupportLetter,
  type GrantOpportunity,
  type GrantNotice,
} from "@workspace/db";
import { getActiveProvider } from "../lib/ai/router";
import { sanitizeRichHtml } from "../lib/richText";
import { logActivity } from "../lib/activity";
import {
  APPLICANT_TYPES,
  BUDGET_CATEGORIES,
  READINESS_KINDS,
  READINESS_STATUSES,
  isApplicantType,
  isBudgetCategory,
  isReadinessKind,
  readinessKindsFor,
  GRANTS_GOV_CODE_LABELS,
  type ApplicantType,
} from "../lib/grants/eligibility";
import { matchOpportunity, type MatchResult } from "../lib/grants/matching";
import { alertSummaries, broadTopics, hasTopics, isNewFor, matchInput, newSince, scoreMatches, summarizeAlerts } from "../lib/grants/alerts";
import { chooseRegistryTemplate } from "../lib/grants/templateRegistry";
import { findTemplate, workspaceTemplates } from "./grant-templates";
import { summarizeBudget, lineTotal } from "../lib/grants/budget";
import { checkLimit, htmlToText } from "../lib/grants/text";
import { OUTCOMES, isOutcome, outcomeTransitionError, summarizePipeline } from "../lib/grants/pipeline";
import { evaluateCompliance } from "../lib/grants/compliance";
import { invalidatePackage } from "../lib/grants/aiWork";
import { buildApplicationPackage } from "../lib/grants/packageExport";
import { refreshOpportunityDetail } from "../lib/grants/ingest";
import { enqueue } from "../lib/jobs/registry";
import { GRANT_SYNC_KEY, aiKey, grantSyncJob, noticeChecklistJob, requirementsExtractJob, sectionDraftJob, sectionReviewJob } from "../lib/jobs/definitions";
import multer from "multer";
import { NoticeFileError, assertNoticeFile, noticeConfig, noticeFileName, sha256 } from "../lib/grants/noticePdf";
import { checkNoticeUrl } from "../lib/grants/noticeFetch";
import { deleteNoticeFiles, removeNotice } from "../lib/grants/noticeWork";
import { storeSourcePdf, deleteSourcePdf, readSourcePdf } from "../lib/sourceStorage";
import { activeJob } from "../lib/jobs/queue";
import { currentWorker, runJobNow } from "../lib/jobs/worker";
import { daysUntil } from "../lib/grants/gate";
import { buildDeadlineCalendar, fileStem } from "../lib/grants/calendar";
import { CA_SOURCE } from "../lib/grants/california";
import { PLACE_DESIGNATIONS, PLACE_STATUSES, effectiveStatus, isPlaceKind, needsRecheck, placeCatalog, validGeoRef, COUNTY_FIPS, TRACT_GEOID, type PlaceDesignations, type PlaceRecord } from "../lib/grants/places";
import {
  DEFAULT_FORMAT,
  FORMAT_FONTS,
  LETTER_STATUSES,
  LETTER_STATUS_LABELS,
  LOGIC_MODEL_COLUMNS,
  checkFormat,
  defaultFileStem,
  formatProfileOf,
  logicModelGaps,
  logicModelHtml,
  parseFormatProfile,
  parseLogicModel,
  sectionWritingChecks,
  type LogicModel,
} from "../lib/grants/writing";
import { checkNewOrganization, claimAiDraftedApplication, limitResponse } from "../lib/billing/service";
import { calibration, rateCompetitiveness, type RatingBand } from "../lib/grants/competitiveness";
import { FACT_CATEGORIES, SECTION_FACT_CATEGORIES, factLine, factsForSection, isFactCategory } from "../lib/grants/facts";
import { flagView, syncClaimChecks } from "../lib/grants/claimsWork";
import { CLAIM_KIND_LABELS } from "../lib/grants/claims";
import { FORM_SHORT_LABELS, FORM_SOURCE, coerceValue, entryFields, formsCheck, type FormView } from "../lib/grants/federalForms/engine";
import { formsContext, loadFormViews } from "../lib/grants/federalForms/store";
import { buildFormsPdf, formRows, formsJson } from "../lib/grants/federalForms/render";
import { isFederalFormKey, type FederalFormKey } from "../lib/grants/federalForms/types";

/**
 * Grant Studio API (docs/GRANT_STUDIO.md).
 *
 * Ownership: applicant.user_id = session user. Every child record is reached
 * through its applicant, and a record the user does not own is a 404, so ids
 * cannot be probed. Opportunities are public reference data.
 */

const router: IRouter = Router();

const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "Too many AI requests. Wait a few minutes and try again." },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 4,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "The opportunity refresh was run recently. Try again later." },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function pick(body: unknown, allowed: readonly string[]): Record<string, unknown> | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The request body must be an object.";
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) return `Unknown or forbidden field(s): ${unknown.join(", ")}`;
  return body as Record<string, unknown>;
}

function optionalText(value: unknown, max: number): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return false;
  return value.trim().slice(0, max);
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] | false {
  if (!Array.isArray(value)) return false;
  const out = value.filter((v) => typeof v === "string").map((v: string) => v.trim().slice(0, maxLength)).filter(Boolean);
  return [...new Set(out)].slice(0, maxItems);
}

function optionalNumber(value: unknown, min: number, max: number): number | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return false;
  return num;
}

function isoDate(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : false;
}

/** The name recorded on approvals and outcomes: the signed-in member, or the principal's username for the shared operator sign-in. */
async function actorOf(req: Request): Promise<string> {
  if (req.session.actorName) return req.session.actorName;
  const [user] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
  return user?.username ?? "operator";
}

async function ownedApplicant(id: string, userId: string, res: Response): Promise<GrantApplicant | null> {
  const [row] = await db.select().from(grantApplicantsTable).where(and(eq(grantApplicantsTable.id, id), eq(grantApplicantsTable.userId, userId))).limit(1);
  if (!row) fail(res, 404, "Organization not found");
  return row ?? null;
}

async function ownedApplication(id: string, userId: string, res: Response): Promise<{ app: GrantApplication; applicant: GrantApplicant } | null> {
  const [row] = await db
    .select({ app: grantApplicationsTable, applicant: grantApplicantsTable })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantApplicationsTable.id, id), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!row) fail(res, 404, "Application not found");
  return row ?? null;
}

/** Loads a child row (section, requirement, budget line) only through an application the user owns. */
async function ownedChild<T extends typeof grantSectionsTable | typeof grantRequirementsTable | typeof grantBudgetLinesTable>(
  table: T,
  id: string,
  userId: string,
  res: Response,
): Promise<{ row: T["$inferSelect"]; app: GrantApplication; applicant: GrantApplicant } | null> {
  const t = table as any;
  const [found] = await db
    .select({ row: t, app: grantApplicationsTable, applicant: grantApplicantsTable })
    .from(t)
    .innerJoin(grantApplicationsTable, eq(t.applicationId, grantApplicationsTable.id))
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(t.id, id), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!found) fail(res, 404, "Not found");
  return (found as any) ?? null;
}

/** Every designation, with what was recorded, what holds today and whether it is due for a recheck. */
function placesView(applicant: GrantApplicant) {
  const recorded = (applicant.placeDesignations ?? {}) as PlaceDesignations;
  const now = new Date();
  return placeCatalog().map((spec) => {
    const record = recorded[spec.key] ?? null;
    return { ...spec, record, effectiveStatus: effectiveStatus(record ?? undefined, now), needsRecheck: needsRecheck(record ?? undefined, now) };
  });
}

function applicantSummary(applicant: GrantApplicant) {
  return { ...applicant, applicantTypeLabel: APPLICANT_TYPES[applicant.applicantType as ApplicantType]?.label ?? applicant.applicantType, places: placesView(applicant) };
}

function readinessView(applicant: GrantApplicant, items: (typeof grantReadinessItemsTable.$inferSelect)[]) {
  const byKind = new Map(items.map((i) => [i.kind, i]));
  const kinds = isApplicantType(applicant.applicantType) ? readinessKindsFor(applicant.applicantType) : [];
  const rows = kinds.map((kind) => {
    const spec = READINESS_KINDS[kind];
    const item = byKind.get(kind);
    return {
      kind,
      label: spec.label,
      blocking: spec.blocking,
      federal: spec.federal,
      status: item?.status ?? "missing",
      expiresOn: item?.expiresOn ?? null,
      note: item?.note ?? null,
      confirmedBy: item?.confirmedBy ?? null,
      confirmedAt: item?.confirmedAt ?? null,
    };
  });
  const ready = rows.filter((r) => r.status === "ready").length;
  const blockingOpen = rows.filter((r) => r.blocking && r.status !== "ready").length;
  return { items: rows, score: rows.length ? Math.round((ready / rows.length) * 100) : 0, blockingOpen };
}

/** Display names for each source, and California's own wording for the eligibility codes it maps to. */
const SOURCE_LABELS: Record<string, string> = { grants_gov: "Grants.gov", [CA_SOURCE]: "California Grants Portal" };
const CA_CODE_LABELS: Record<string, string> = { "12": "Nonprofit", "13": "Nonprofit", "22": "Business", "23": "Business", "25": "Other legal entity" };

function eligibilityLabels(o: GrantOpportunity): string[] {
  if (o.source === CA_SOURCE) return [...new Set(o.eligibilityCodes.map((c) => CA_CODE_LABELS[c] ?? `Code ${c}`))];
  return o.eligibilityCodes.map((c) => GRANTS_GOV_CODE_LABELS[c] ?? `Code ${c}`);
}

function opportunityView(o: GrantOpportunity) {
  return {
    id: o.id,
    source: o.source,
    sourceLabel: SOURCE_LABELS[o.source] ?? o.source,
    jurisdiction: o.jurisdiction,
    federal: !o.jurisdiction,
    rollingDeadline: o.rollingDeadline,
    costSharePercent: o.costSharePercent,
    sourceRef: o.sourceRef,
    number: o.number,
    title: o.title,
    agency: o.agency,
    agencyCode: o.agencyCode,
    status: o.status,
    openDate: o.openDate,
    closeDate: o.closeDate,
    daysLeft: daysUntil(o.closeDate),
    awardFloor: o.awardFloor,
    awardCeiling: o.awardCeiling,
    estimatedFunding: o.estimatedFunding,
    costSharing: o.costSharing,
    eligibilityCodes: o.eligibilityCodes,
    eligibilityLabels: eligibilityLabels(o),
    eligibilityText: o.eligibilityText,
    categories: o.categories,
    assistanceListings: o.assistanceListings,
    description: o.description,
    officialUrl: o.officialUrl,
    fetchedAt: o.fetchedAt,
    detailFetchedAt: o.detailFetchedAt,
    publishable: o.publishable,
    gateMissing: o.gateMissing,
  };
}


// ── Meta and sync ──────────────────────────────────────────────────────────

router.get("/grants/meta", async (req, res): Promise<void> => {
  const [opps] = await db.select({ total: count() }).from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.publishable, true));
  const bySource = await db.select({ source: grantOpportunitiesTable.source, n: count() }).from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.publishable, true)).groupBy(grantOpportunitiesTable.source);
  const [lastRun] = await db.select().from(grantSyncRunsTable).orderBy(desc(grantSyncRunsTable.startedAt)).limit(1);
  const sync = await activeJob(GRANT_SYNC_KEY);
  res.json({
    applicantTypes: Object.entries(APPLICANT_TYPES).map(([key, v]) => ({ key, label: v.label, kind: v.kind })),
    readinessKinds: Object.entries(READINESS_KINDS).map(([key, v]) => ({ key, label: v.label, blocking: v.blocking })),
    readinessStatuses: READINESS_STATUSES,
    budgetCategories: Object.entries(BUDGET_CATEGORIES).map(([key, label]) => ({ key, label })),
    placeDesignations: placeCatalog(),
    templates: (await workspaceTemplates(req.session.userId!)).filter((t) => t.status === "active").map((t) => ({ key: t.key, label: t.label, builtIn: t.builtIn })),
    aiProvider: getActiveProvider().name,
    aiDemo: getActiveProvider().name === "demo",
    opportunities: Number(opps.total),
    sources: bySource.map((b) => ({ source: b.source, label: SOURCE_LABELS[b.source] ?? b.source, opportunities: Number(b.n) })),
    lastSync: lastRun ?? null,
    syncRunning: sync !== null,
    /** The queued or running refresh, for progress. */
    syncJob: sync ? { id: sync.id, status: sync.status, progress: sync.progress, runAt: sync.runAt, attempts: sync.attempts, lastError: sync.lastError } : null,
  });
});

/**
 * POST /grants/sync: queues a refresh of every source. While one is queued or
 * running, returns that one instead of adding another.
 */
router.post("/grants/sync", syncLimiter, async (req, res): Promise<void> => {
  const { job, created } = await enqueue(grantSyncJob, {}, { dedupeKey: GRANT_SYNC_KEY, requestedBy: req.session.actorName ?? "operator" });
  if (created) {
    currentWorker()?.nudge();
    await logActivity("grants_sync_requested", "Grant opportunity refresh requested", { userId: req.session.userId }).catch(() => {});
  }
  res.status(202).json({ status: created ? "queued" : job.status, jobId: job.id });
});

// ── Applicants (organizations) ─────────────────────────────────────────────

const APPLICANT_FIELDS = ["name", "applicantType", "ein", "uei", "state", "serviceArea", "mission", "focusAreas", "naicsCodes", "annualBudget", "maxCostSharePercent", "principalAddress", "censusTract", "countyFips"] as const;

function applicantValues(body: Record<string, unknown>, creating: boolean): Record<string, unknown> | string {
  const values: Record<string, unknown> = {};
  if (creating || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) return "name is required";
    values.name = body.name.trim().slice(0, 200);
  }
  if (creating || body.applicantType !== undefined) {
    if (!isApplicantType(body.applicantType)) return `applicantType must be one of: ${Object.keys(APPLICANT_TYPES).join(", ")}`;
    values.applicantType = body.applicantType;
  }
  if (body.ein !== undefined) {
    const ein = optionalText(body.ein, 20);
    if (ein === false || (ein && !/^\d{2}-?\d{7}$/.test(ein))) return "ein must look like 12-3456789";
    values.ein = ein;
  }
  if (body.uei !== undefined) {
    const uei = optionalText(body.uei, 20);
    if (uei === false || (uei && !/^[A-Za-z0-9]{12}$/.test(uei))) return "uei must be the 12-character SAM.gov Unique Entity ID";
    values.uei = uei ? uei.toUpperCase() : uei;
  }
  for (const [field, max] of [["state", 60], ["serviceArea", 500], ["mission", 4000]] as const) {
    if (body[field] === undefined) continue;
    const text = optionalText(body[field], max);
    if (text === false) return `${field} must be text`;
    values[field] = text;
  }
  if (body.principalAddress !== undefined) {
    const text = optionalText(body.principalAddress, 300);
    if (text === false) return "principalAddress must be text";
    values.principalAddress = text;
  }
  if (body.censusTract !== undefined) {
    const tract = optionalText(body.censusTract, 20);
    if (tract === false || (tract && !TRACT_GEOID.test(tract))) return "censusTract must be the 11-digit census tract GEOID (state, county and tract), for example 37063001503";
    values.censusTract = tract;
  }
  if (body.countyFips !== undefined) {
    const fips = optionalText(body.countyFips, 10);
    if (fips === false || (fips && !COUNTY_FIPS.test(fips))) return "countyFips must be the 5-digit county FIPS code, for example 37063";
    values.countyFips = fips;
  }
  if (body.focusAreas !== undefined) {
    const list = stringList(body.focusAreas, 25, 80);
    if (list === false) return "focusAreas must be a list of text";
    values.focusAreas = list;
  }
  if (body.naicsCodes !== undefined) {
    const list = stringList(body.naicsCodes, 20, 6);
    if (list === false || list.some((c) => !/^\d{2,6}$/.test(c))) return "naicsCodes must be 2 to 6 digit codes";
    values.naicsCodes = list;
  }
  if (body.annualBudget !== undefined) {
    const n = optionalNumber(body.annualBudget, 0, 10_000_000_000);
    if (n === false) return "annualBudget must be a positive number";
    values.annualBudget = n == null ? null : Math.round(n);
  }
  if (body.maxCostSharePercent !== undefined) {
    const n = optionalNumber(body.maxCostSharePercent, 0, 100);
    if (n === false || n == null) return "maxCostSharePercent must be 0 to 100";
    values.maxCostSharePercent = Math.round(n);
  }
  return values;
}

router.get("/grants/applicants", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const applicants = await db.select().from(grantApplicantsTable).where(eq(grantApplicantsTable.userId, userId)).orderBy(asc(grantApplicantsTable.name));
  const ids = applicants.map((a) => a.id);
  const items = ids.length ? await db.select().from(grantReadinessItemsTable).where(inArray(grantReadinessItemsTable.applicantId, ids)) : [];
  const apps = ids.length ? await db.select({ applicantId: grantApplicationsTable.applicantId, n: count() }).from(grantApplicationsTable).where(inArray(grantApplicationsTable.applicantId, ids)).groupBy(grantApplicationsTable.applicantId) : [];
  const appCounts = new Map(apps.map((a) => [a.applicantId, Number(a.n)]));
  const alerts = await alertSummaries(applicants);
  res.json(applicants.map((a) => ({
    ...applicantSummary(a),
    readiness: readinessView(a, items.filter((i) => i.applicantId === a.id)),
    applicationCount: appCounts.get(a.id) ?? 0,
    alerts: alerts.get(a.id) ?? { newMatches: 0, closingSoon: 0 },
  })));
});

router.post("/grants/applicants", async (req, res): Promise<void> => {
  const body = pick(req.body, APPLICANT_FIELDS);
  if (typeof body === "string") return fail(res, 400, body);
  const values = applicantValues(body, true);
  if (typeof values === "string") return fail(res, 400, values);
  // Plan limit on organizations; allowed whenever billing is off (docs/BILLING.md).
  const allowed = await checkNewOrganization(req.session);
  if (!allowed.allowed) {
    res.status(402).json(limitResponse(allowed));
    return;
  }
  const [row] = await db.insert(grantApplicantsTable).values({ id: randomUUID(), userId: req.session.userId!, ...(values as any) }).returning();
  await logActivity("grant_applicant_created", `Organization "${row.name}" added to Grant Studio`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.status(201).json({ ...applicantSummary(row), readiness: readinessView(row, []), applicationCount: 0 });
});

router.get("/grants/applicants/:id", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const items = await db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, applicant.id));
  const applications = await db
    .select({ app: grantApplicationsTable, opp: grantOpportunitiesTable })
    .from(grantApplicationsTable)
    .innerJoin(grantOpportunitiesTable, eq(grantApplicationsTable.opportunityId, grantOpportunitiesTable.id))
    .where(eq(grantApplicationsTable.applicantId, applicant.id))
    .orderBy(desc(grantApplicationsTable.updatedAt));
  res.json({
    ...applicantSummary(applicant),
    readiness: readinessView(applicant, items),
    applications: applications.map(({ app, opp }) => ({ ...app, opportunity: { id: opp.id, title: opp.title, agency: opp.agency, closeDate: opp.closeDate, daysLeft: daysUntil(opp.closeDate) } })),
  });
});

router.patch("/grants/applicants/:id", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const body = pick(req.body, APPLICANT_FIELDS);
  if (typeof body === "string") return fail(res, 400, body);
  const values = applicantValues(body, false);
  if (typeof values === "string") return fail(res, 400, values);
  const [row] = await db.update(grantApplicantsTable).set(values as any).where(eq(grantApplicantsTable.id, applicant.id)).returning();
  const items = await db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, row.id));
  res.json({ ...applicantSummary(row), readiness: readinessView(row, items) });
});

router.delete("/grants/applicants/:id", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const apps = await db.select({ id: grantApplicationsTable.id }).from(grantApplicationsTable).where(eq(grantApplicationsTable.applicantId, applicant.id));
  await deleteNoticeFiles(apps.map((a) => a.id));
  await db.delete(grantApplicantsTable).where(eq(grantApplicantsTable.id, applicant.id));
  await logActivity("grant_applicant_deleted", `Organization "${applicant.name}" deleted from Grant Studio`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.status(204).end();
});

router.put("/grants/applicants/:id/readiness/:kind", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const kind = param(req, "kind");
  if (!isReadinessKind(kind) || !readinessKindsFor(applicant.applicantType as ApplicantType).includes(kind)) return fail(res, 400, "That readiness item does not apply to this organization.");
  const body = pick(req.body, ["status", "expiresOn", "note"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (!READINESS_STATUSES.includes(body.status as any)) return fail(res, 400, `status must be one of: ${READINESS_STATUSES.join(", ")}`);
  const expiresOn = isoDate(body.expiresOn);
  if (expiresOn === false) return fail(res, 400, "expiresOn must be a date (YYYY-MM-DD)");
  const note = optionalText(body.note, 1000);
  if (note === false) return fail(res, 400, "note must be text");
  const username = await actorOf(req);
  const values = {
    status: body.status as string,
    expiresOn: expiresOn ?? null,
    note: note ?? null,
    confirmedBy: body.status === "ready" ? username : null,
    confirmedAt: body.status === "ready" ? new Date() : null,
  };
  await db
    .insert(grantReadinessItemsTable)
    .values({ id: randomUUID(), applicantId: applicant.id, kind, ...values })
    .onConflictDoUpdate({ target: [grantReadinessItemsTable.applicantId, grantReadinessItemsTable.kind], set: values });
  const items = await db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, applicant.id));
  res.json(readinessView(applicant, items));
});

// ── Place designations ────────────────────────────────────────────────────

/**
 * Records what a person found on the agency's own tool for one designation.
 * Grant Studio never decides a designation; "unknown" clears the finding.
 */
router.put("/grants/applicants/:id/places/:kind", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const kind = param(req, "kind");
  if (!isPlaceKind(kind)) return fail(res, 404, "Unknown place designation");
  const body = pick(req.body, ["status", "place", "geoRef", "checkedOn", "validThrough", "note"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (!PLACE_STATUSES.includes(body.status as any)) return fail(res, 400, `status must be one of: ${PLACE_STATUSES.join(", ")}`);
  const place = optionalText(body.place, 200);
  if (place === false) return fail(res, 400, "place must be text");
  const geoRef = optionalText(body.geoRef, 60);
  if (geoRef === false || (geoRef && !validGeoRef(kind, geoRef))) {
    const g = PLACE_DESIGNATIONS[kind].geography;
    return fail(res, 400, g === "census tract" ? "geoRef must be the 11-digit census tract GEOID" : g === "county" ? "geoRef must be the 5-digit county FIPS code (or an 11-digit tract GEOID)" : g === "ZIP Code Tabulation Area" ? "geoRef must be the 5-digit ZCTA" : "geoRef is too long");
  }
  const checkedOn = isoDate(body.checkedOn);
  if (checkedOn === false) return fail(res, 400, "checkedOn must be a date (YYYY-MM-DD)");
  const validThrough = isoDate(body.validThrough);
  if (validThrough === false) return fail(res, 400, "validThrough must be a date (YYYY-MM-DD)");
  const note = optionalText(body.note, 1000);
  if (note === false) return fail(res, 400, "note must be text");
  const status = body.status as PlaceRecord["status"];
  if (status !== "unknown" && !checkedOn) return fail(res, 400, "Record the date you checked the official tool (checkedOn).");
  if (checkedOn && checkedOn > new Date().toISOString().slice(0, 10)) return fail(res, 400, "checkedOn cannot be in the future.");
  const designations = { ...((applicant.placeDesignations ?? {}) as PlaceDesignations) };
  if (status === "unknown" && !place && !geoRef && !note) delete designations[kind];
  else {
    designations[kind] = {
      status,
      place: place ?? null,
      geoRef: geoRef ?? null,
      checkedOn: checkedOn ?? null,
      validThrough: validThrough ?? null,
      note: note ?? null,
      recordedBy: status === "unknown" ? null : await actorOf(req),
      recordedAt: status === "unknown" ? null : new Date().toISOString(),
    };
  }
  const [row] = await db.update(grantApplicantsTable).set({ placeDesignations: designations as Record<string, unknown> }).where(eq(grantApplicantsTable.id, applicant.id)).returning();
  res.json({ places: placesView(row) });
});

// ── Fact library ───────────────────────────────────────────────────────────

const FACT_FIELDS = ["category", "label", "body", "source", "asOf", "confirmed"] as const;
const MAX_FACTS_PER_APPLICANT = 300;

async function ownedFact(id: string, userId: string, res: Response): Promise<{ fact: GrantFact; applicant: GrantApplicant } | null> {
  const [row] = await db
    .select({ fact: grantFactsTable, applicant: grantApplicantsTable })
    .from(grantFactsTable)
    .innerJoin(grantApplicantsTable, eq(grantFactsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantFactsTable.id, id), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!row) fail(res, 404, "Fact not found");
  return row ?? null;
}

function factValues(body: Record<string, unknown>, creating: boolean): Record<string, unknown> | string {
  const values: Record<string, unknown> = {};
  if (creating || body.category !== undefined) {
    if (!isFactCategory(body.category)) return `category must be one of: ${Object.keys(FACT_CATEGORIES).join(", ")}`;
    values.category = body.category;
  }
  for (const [field, max, required] of [["label", 160, true], ["body", 2000, true], ["source", 500, false]] as const) {
    if (!creating && body[field] === undefined) continue;
    const text = optionalText(body[field], max);
    if (text === false) return `${field} must be text`;
    if (required && !text) return `${field} is required`;
    values[field] = text ?? null;
  }
  if (body.asOf !== undefined) {
    const date = isoDate(body.asOf);
    if (date === false) return "asOf must be a date (YYYY-MM-DD)";
    values.asOf = date ?? null;
  }
  if (body.confirmed !== undefined && typeof body.confirmed !== "boolean") return "confirmed must be true or false";
  return values;
}

function factView(f: GrantFact) {
  return { ...f, confirmed: Boolean(f.confirmedAt), categoryLabel: FACT_CATEGORIES[f.category as keyof typeof FACT_CATEGORIES]?.label ?? f.category };
}

router.get("/grants/applicants/:id/facts", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const facts = await db.select().from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id)).orderBy(asc(grantFactsTable.category), desc(grantFactsTable.updatedAt));
  res.json({
    categories: Object.entries(FACT_CATEGORIES).map(([key, c]) => ({ key, ...c })),
    facts: facts.map(factView),
  });
});

router.post("/grants/applicants/:id/facts", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const body = pick(req.body, FACT_FIELDS);
  if (typeof body === "string") return fail(res, 400, body);
  const values = factValues(body, true);
  if (typeof values === "string") return fail(res, 400, values);
  const [{ n }] = await db.select({ n: count() }).from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id));
  if (Number(n) >= MAX_FACTS_PER_APPLICANT) return fail(res, 400, `An organization can hold at most ${MAX_FACTS_PER_APPLICANT} facts.`);
  const confirmation = body.confirmed === true ? { confirmedBy: await actorOf(req), confirmedAt: new Date() } : {};
  const [row] = await db.insert(grantFactsTable).values({ id: randomUUID(), applicantId: applicant.id, ...(values as any), ...confirmation }).returning();
  res.status(201).json(factView(row));
});

router.patch("/grants/facts/:fid", async (req, res): Promise<void> => {
  const owned = await ownedFact(param(req, "fid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, FACT_FIELDS);
  if (typeof body === "string") return fail(res, 400, body);
  const values = factValues(body, false);
  if (typeof values === "string") return fail(res, 400, values);
  const contentChanged = ["category", "label", "body", "source", "asOf"].some((k) => values[k] !== undefined && values[k] !== (owned.fact as any)[k]);
  // Editing a confirmed fact withdraws the confirmation unless the same request confirms it again.
  if (body.confirmed === true) Object.assign(values, { confirmedBy: await actorOf(req), confirmedAt: new Date() });
  else if (body.confirmed === false || contentChanged) Object.assign(values, { confirmedBy: null, confirmedAt: null });
  if (Object.keys(values).length === 0) {
    res.json(factView(owned.fact));
    return;
  }
  const [row] = await db.update(grantFactsTable).set(values).where(eq(grantFactsTable.id, owned.fact.id)).returning();
  res.json(factView(row));
});

router.delete("/grants/facts/:fid", async (req, res): Promise<void> => {
  const owned = await ownedFact(param(req, "fid"), req.session.userId!, res);
  if (!owned) return;
  await db.delete(grantFactsTable).where(eq(grantFactsTable.id, owned.fact.id));
  res.status(204).end();
});

// ── Matches and opportunities ─────────────────────────────────────────────

router.get("/grants/applicants/:id/matches", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  if (!isApplicantType(applicant.applicantType)) return fail(res, 400, "Unknown organization type");
  const items = await db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, applicant.id));
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const filters = [eq(grantOpportunitiesTable.publishable, true)];
  if (q) filters.push(or(ilike(grantOpportunitiesTable.title, `%${q}%`), ilike(grantOpportunitiesTable.agency, `%${q}%`), ilike(grantOpportunitiesTable.number, `%${q}%`))!);
  const opps = await db.select().from(grantOpportunitiesTable).where(and(...filters));
  const { scored, excluded } = scoreMatches(applicant, opps, items);
  const since = newSince(applicant);
  const relevantTotal = scored.filter((s) => s.match.relevant).length;
  const alerts = summarizeAlerts(applicant, scored);
  const relevantOnly = req.query.relevantOnly === "1" || req.query.relevantOnly === "true";
  const newOnly = req.query.newOnly === "1" || req.query.newOnly === "true";
  let shown = relevantOnly ? scored.filter((s) => s.match.relevant) : scored;
  if (newOnly) shown = shown.filter((s) => isNewFor(s.opp, since));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json({
    total: scored.length,
    relevantTotal,
    relevantOnly,
    newOnly,
    newTotal: alerts.newMatches,
    closingSoonTotal: alerts.closingSoon,
    hasTopics: hasTopics(applicant),
    broadTopics: q ? [] : broadTopics(applicant.focusAreas, scored),
    newSince: since,
    excluded,
    considered: opps.length,
    matches: shown.slice(0, limit).map(({ opp, match }) => ({ opportunity: opportunityView(opp), match, isNew: isNewFor(opp, since) })),
  });
});

router.post("/grants/applicants/:id/matches/seen", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const [row] = await db.update(grantApplicantsTable).set({ matchesSeenAt: new Date() }).where(eq(grantApplicantsTable.id, applicant.id)).returning();
  res.json({ matchesSeenAt: row.matchesSeenAt });
});

router.get("/grants/opportunities", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;
  const filters = [eq(grantOpportunitiesTable.publishable, true)];
  if (q) filters.push(or(ilike(grantOpportunitiesTable.title, `%${q}%`), ilike(grantOpportunitiesTable.agency, `%${q}%`), ilike(grantOpportunitiesTable.number, `%${q}%`))!);
  const code = typeof req.query.eligibility === "string" ? req.query.eligibility : "";
  if (/^\d{2}$/.test(code)) filters.push(sql`${grantOpportunitiesTable.eligibilityCodes} @> ${JSON.stringify([code])}::jsonb`);
  const where = and(...filters);
  const [{ total }] = await db.select({ total: count() }).from(grantOpportunitiesTable).where(where);
  const rows = await db.select().from(grantOpportunitiesTable).where(where).orderBy(sql`${grantOpportunitiesTable.closeDate} ASC NULLS LAST`).limit(pageSize).offset((page - 1) * pageSize);
  res.json({ total: Number(total), page, pageSize, opportunities: rows.map(opportunityView) });
});

router.get("/grants/opportunities/:id", async (req, res): Promise<void> => {
  const id = param(req, "id");
  let [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, id)).limit(1);
  if (!opp) return fail(res, 404, "Opportunity not found");
  let detailError: string | null = null;
  // Only Grants.gov has a separate detail record; state records are complete when synced.
  const stale = opp.source === "grants_gov" && (!opp.detailFetchedAt || Date.now() - opp.detailFetchedAt.getTime() > 24 * 60 * 60_000);
  if (stale) {
    try {
      await refreshOpportunityDetail(opp.id);
      [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, id)).limit(1);
    } catch (err) {
      detailError = "The official record could not be refreshed just now; showing the last stored copy.";
      console.warn("[grants] detail refresh failed", id, (err as Error).message);
    }
  }
  let match: MatchResult | null = null;
  let existingApplicationId: string | null = null;
  const applicantId = typeof req.query.applicantId === "string" ? req.query.applicantId : "";
  if (applicantId) {
    const [applicant] = await db.select().from(grantApplicantsTable).where(and(eq(grantApplicantsTable.id, applicantId), eq(grantApplicantsTable.userId, req.session.userId!))).limit(1);
    if (applicant && isApplicantType(applicant.applicantType)) {
      const items = await db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, applicant.id));
      match = matchOpportunity(matchInput(applicant), opp, items);
      const [existing] = await db.select({ id: grantApplicationsTable.id }).from(grantApplicationsTable).where(and(eq(grantApplicationsTable.applicantId, applicant.id), eq(grantApplicationsTable.opportunityId, opp.id))).limit(1);
      existingApplicationId = existing?.id ?? null;
    }
  }
  res.json({ opportunity: opportunityView(opp), match, existingApplicationId, detailError });
});

// ── Applications ──────────────────────────────────────────────────────────

router.post("/grants/applications", async (req, res): Promise<void> => {
  const body = pick(req.body, ["applicantId", "opportunityId", "eligibilityConfirmed", "eligibilityNote", "template"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (typeof body.applicantId !== "string" || typeof body.opportunityId !== "string") return fail(res, 400, "applicantId and opportunityId are required");
  if (body.eligibilityConfirmed !== true) return fail(res, 400, "Confirm eligibility against the official notice before starting an application.");
  const note = optionalText(body.eligibilityNote, 2000);
  if (note === false) return fail(res, 400, "eligibilityNote must be text");
  if (body.template !== undefined && typeof body.template !== "string") return fail(res, 400, "Unknown template");
  const applicant = await ownedApplicant(body.applicantId, req.session.userId!, res);
  if (!applicant) return;
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, body.opportunityId)).limit(1);
  if (!opp) return fail(res, 404, "Opportunity not found");
  if (!opp.publishable) return fail(res, 409, "This opportunity is not open or its official record is incomplete.");
  const [existing] = await db.select({ id: grantApplicationsTable.id }).from(grantApplicationsTable).where(and(eq(grantApplicationsTable.applicantId, applicant.id), eq(grantApplicationsTable.opportunityId, opp.id))).limit(1);
  if (existing) {
    res.status(200).json({ id: existing.id, existing: true });
    return;
  }
  // A chosen template must be one this workspace can use; otherwise the registry picks one.
  const available = await workspaceTemplates(req.session.userId!);
  const templateKey = (body.template as string | undefined) ?? chooseRegistryTemplate(available, applicant.applicantType as ApplicantType, opp.title, opp.jurisdiction);
  const template = available.find((t) => t.key === templateKey && t.status === "active");
  if (!template) return fail(res, 400, "Unknown or archived template");
  const username = await actorOf(req);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(grantApplicationsTable).values({
      id,
      applicantId: applicant.id,
      opportunityId: opp.id,
      template: templateKey,
      title: opp.title.slice(0, 300),
      requestedAmount: opp.awardCeiling ?? null,
      eligibilityConfirmedAt: new Date(),
      eligibilityConfirmedBy: username,
      eligibilityNote: note ?? null,
    });
    await tx.insert(grantSectionsTable).values(template.sections.map((s, position) => ({ id: randomUUID(), applicationId: id, key: s.key, title: s.title, guidance: s.guidance, limitType: s.limitType, limitValue: s.limitValue, position })));
    await tx.insert(grantRequirementsTable).values(template.requirements.map((r, position) => ({ id: randomUUID(), applicationId: id, kind: r.kind, label: r.label, detail: r.detail, sectionKey: r.sectionKey ?? null, sourceRef: "template", origin: "template", position })));
    await tx.insert(grantApprovalsTable).values({ id: randomUUID(), applicationId: id, scope: "eligibility", role: "writer", approvedBy: username, note: note ?? null });
  });
  await logActivity("grant_application_started", `Application started: ${opp.title}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.status(201).json({ id, existing: false });
});

router.get("/grants/applications", async (req, res): Promise<void> => {
  const rows = await db
    .select({ app: grantApplicationsTable, applicant: grantApplicantsTable, opp: grantOpportunitiesTable })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .innerJoin(grantOpportunitiesTable, eq(grantApplicationsTable.opportunityId, grantOpportunitiesTable.id))
    .where(eq(grantApplicantsTable.userId, req.session.userId!))
    .orderBy(desc(grantApplicationsTable.updatedAt));
  res.json(rows.map(({ app, applicant, opp }) => ({
    ...app,
    applicant: { id: applicant.id, name: applicant.name },
    opportunity: { id: opp.id, title: opp.title, agency: opp.agency, closeDate: opp.closeDate, daysLeft: daysUntil(opp.closeDate) },
  })));
});

async function activeAiJobs(applicationId: string, sectionIds: string[]) {
  const keys = [aiKey("extract", applicationId), aiKey("notice", applicationId), ...sectionIds.flatMap((id) => [aiKey("draft", id), aiKey("review", id)])];
  const rows = await db.select().from(jobsTable).where(and(inArray(jobsTable.dedupeKey, keys), inArray(jobsTable.status, ["queued", "running"])));
  return rows.map((j) => ({ id: j.id, kind: j.kind, status: j.status, sectionId: (j.payload as { sectionId?: string }).sectionId ?? null, attempts: j.attempts, lastError: j.lastError, progress: j.progress ?? null }));
}

/** The attached notice, without its page texts (those are read one page at a time). */
function noticeView(n: GrantNotice | undefined, rows: { noticeId: string | null; confirmed: boolean; rejectedAt: Date | null }[]) {
  if (!n) return null;
  const mine = rows.filter((r) => r.noticeId === n.id);
  const { pages: _pages, fileKey, ...rest } = n;
  return {
    ...rest,
    hasFile: Boolean(fileKey),
    counts: {
      proposed: mine.filter((r) => !r.confirmed && !r.rejectedAt).length,
      confirmed: mine.filter((r) => r.confirmed).length,
      rejected: mine.filter((r) => r.rejectedAt).length,
    },
    limits: { maxPages: noticeConfig().maxPages, maxMegabytes: Math.round(noticeConfig().maxBytes / 1024 / 1024) },
  };
}

/** One section's claim check: when it ran, by which method, and its flags (open first). */
function claimsView(section: typeof grantSectionsTable.$inferSelect, flags: (typeof grantClaimFlagsTable.$inferSelect)[]) {
  const mine = flags
    .filter((f) => f.sectionId === section.id)
    .sort((a, b) => (a.status === b.status ? a.createdAt.getTime() - b.createdAt.getTime() : a.status === "open" ? -1 : 1));
  const aiCurrent = Boolean(section.claimsAiHash && section.claimsAiHash === createHash("sha256").update(section.content).digest("hex"));
  return {
    checkedAt: section.claimsCheckedAt,
    method: "Rule check (no AI): numbers, dates, results, named partners and credentials are matched against confirmed facts, this application's records and sources cited in the text.",
    aiCheckedAt: section.claimsAiCheckedAt,
    aiProvider: section.claimsAiProvider,
    aiCurrent,
    open: mine.filter((f) => f.status === "open").length,
    flags: mine.map(flagView),
  };
}

function formSummary(v: FormView) {
  return { key: v.key, label: FORM_SHORT_LABELS[v.key], formName: v.formName, status: v.status, errorCount: v.errorCount, counts: v.counts, notApplicable: v.notApplicable, reviewedBy: v.reviewedBy, reviewedAt: v.reviewedAt, canBeNotApplicable: v.canBeNotApplicable };
}

async function workspace(app: GrantApplication, applicant: GrantApplicant) {
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, app.opportunityId)).limit(1);
  const [allRequirements, sectionRows, lines, approvals, readiness] = await Promise.all([
    db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, app.id)).orderBy(asc(grantRequirementsTable.position), asc(grantRequirementsTable.createdAt)),
    db.select().from(grantSectionsTable).where(eq(grantSectionsTable.applicationId, app.id)).orderBy(asc(grantSectionsTable.position)),
    db.select().from(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.applicationId, app.id)).orderBy(asc(grantBudgetLinesTable.position), asc(grantBudgetLinesTable.createdAt)),
    db.select().from(grantApprovalsTable).where(eq(grantApprovalsTable.applicationId, app.id)).orderBy(asc(grantApprovalsTable.createdAt)),
    db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, applicant.id)),
  ]);
  const libraryFacts = await db.select().from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id)).orderBy(desc(grantFactsTable.updatedAt));
  const letters = await db.select().from(grantSupportLettersTable).where(eq(grantSupportLettersTable.applicationId, app.id)).orderBy(asc(grantSupportLettersTable.createdAt));
  const [notice] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, app.id)).limit(1);
  // The unsupported-claim check runs on any section whose text or records changed since it last ran.
  const flags = await syncClaimChecks(app, applicant, sectionRows);
  const sections = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.applicationId, app.id)).orderBy(asc(grantSectionsTable.position));
  const openBySection = new Map<string, number>();
  for (const f of flags) if (f.status === "open") openBySection.set(f.sectionId, (openBySection.get(f.sectionId) ?? 0) + 1);
  // A rejected row is kept for the record but is no longer part of the matrix, the checks or the package.
  const requirements = allRequirements.filter((r) => !r.rejectedAt);
  const rejectedRequirements = allRequirements.filter((r) => r.rejectedAt);
  const budget = summarizeBudget(lines, app.indirectRatePercent, opp.awardCeiling);
  const packageApproved = approvals.some((a) => a.scope === "package");
  const formatSet = Object.keys(app.formatProfile ?? {}).length > 0;
  const profile = formatProfileOf(app.formatProfile);
  const format = checkFormat(profile, sections);
  const logicModel = (app.logicModel ?? {}) as LogicModel;
  const federal = !opp.jurisdiction;
  const forms = await loadFormViews(app, formsContext(app, applicant, opp, budget, lines.length > 0), federal);
  // The organization's own recorded decisions, for the rating's context.
  const decisions = await db.select({ outcome: grantApplicationsTable.outcome, n: count() }).from(grantApplicationsTable).where(and(eq(grantApplicationsTable.applicantId, applicant.id), inArray(grantApplicationsTable.outcome, ["awarded", "declined"]))).groupBy(grantApplicationsTable.outcome);
  const match = isApplicantType(applicant.applicantType) ? matchOpportunity(matchInput(applicant), opp, readiness) : null;
  const compliance = evaluateCompliance({
    applicantType: applicant.applicantType as ApplicantType,
    federal: !opp.jurisdiction,
    eligibilityConfirmed: Boolean(app.eligibilityConfirmedAt),
    closeDate: opp.closeDate,
    requirements,
    sections,
    budget,
    readiness,
    packageApproved,
    wordsPerPage: format.wordsPerPage,
    format: formatSet ? format : undefined,
    letters,
    claims: { open: [...openBySection.values()].reduce((a, b) => a + b, 0), sections: sections.filter((s) => openBySection.has(s.id)).map((s) => s.title) },
    forms: federal ? formsCheck(forms) : undefined,
  });
  const rating = rateCompetitiveness({
    match,
    sections,
    requirements,
    checks: compliance.checks,
    daysLeft: daysUntil(opp.closeDate),
    rollingDeadline: opp.rollingDeadline,
    forecast: opp.status === "forecasted",
    estimatedFunding: opp.estimatedFunding,
    awardCeiling: opp.awardCeiling,
    history: {
      awarded: Number(decisions.find((d) => d.outcome === "awarded")?.n ?? 0),
      declined: Number(decisions.find((d) => d.outcome === "declined")?.n ?? 0),
    },
  });
  return {
    application: app,
    rating,
    applicant: { ...applicantSummary(applicant), readiness: readinessView(applicant, readiness) },
    opportunity: opportunityView(opp),
    templateLabel: (await findTemplate(applicant.userId, app.template))?.label ?? app.template,
    requirements,
    rejectedRequirements,
    notice: noticeView(notice, allRequirements),
    sections: sections.map((s) => ({ ...s, limitCheck: checkLimit(s.content, s.limitType, s.limitValue, format.wordsPerPage), writingChecks: sectionWritingChecks(s), claims: claimsView(s, flags) })),
    claimKinds: CLAIM_KIND_LABELS,
    /** The federal forms' status (the fields are at GET /grants/applications/:id/forms). Null for a state program. */
    federalForms: federal ? forms.map(formSummary) : null,
    format: { ...format, set: formatSet, fonts: FORMAT_FONTS, defaults: DEFAULT_FORMAT },
    logicModel: { model: logicModel, gaps: logicModelGaps(logicModel), columns: Object.entries(LOGIC_MODEL_COLUMNS).map(([key, c]) => ({ key, ...c })) },
    letters: letters.map(letterView),
    letterStatuses: LETTER_STATUSES.map((key) => ({ key, label: LETTER_STATUS_LABELS[key] })),
    budgetLines: lines.map((l) => ({ ...l, total: lineTotal(l) })),
    budget,
    approvals,
    compliance,
    aiDemo: getActiveProvider().name === "demo",
    /** AI jobs still queued or running for this application, so the page can show them and refresh when they finish. */
    aiJobs: await activeAiJobs(app.id, sections.map((s) => s.id)),
    library: {
      total: libraryFacts.length,
      confirmed: libraryFacts.filter((f) => f.confirmedAt).map(factView),
      sectionCategories: SECTION_FACT_CATEGORIES,
    },
  };
}

router.get("/grants/applications/:id", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  res.json(await workspace(owned.app, owned.applicant));
});

router.patch("/grants/applications/:id", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["title", "requestedAmount", "indirectRatePercent", "noticeText", "formatProfile", "logicModel"]);
  if (typeof body === "string") return fail(res, 400, body);
  const values: Record<string, unknown> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return fail(res, 400, "title must be text");
    values.title = body.title.trim().slice(0, 300);
  }
  const amount = optionalNumber(body.requestedAmount, 0, 1_000_000_000);
  if (amount === false) return fail(res, 400, "requestedAmount must be a positive number");
  if (amount !== undefined) values.requestedAmount = amount;
  const rate = optionalNumber(body.indirectRatePercent, 0, 100);
  if (rate === false || rate === null) return fail(res, 400, "indirectRatePercent must be 0 to 100");
  if (rate !== undefined) values.indirectRatePercent = rate;
  const notice = optionalText(body.noticeText, 200_000);
  if (notice === false) return fail(res, 400, "noticeText must be text");
  if (notice !== undefined) values.noticeText = notice;
  if (body.formatProfile !== undefined) {
    if (body.formatProfile === null) values.formatProfile = {};
    else {
      const profile = parseFormatProfile(body.formatProfile);
      if (typeof profile === "string") return fail(res, 400, profile);
      values.formatProfile = profile;
    }
  }
  if (body.logicModel !== undefined) {
    const model = parseLogicModel(body.logicModel ?? {});
    if (typeof model === "string") return fail(res, 400, model);
    values.logicModel = model;
  }
  if (Object.keys(values).length) {
    await db.update(grantApplicationsTable).set(values).where(eq(grantApplicationsTable.id, owned.app.id));
    // The package approval covers the amount, the budget and the format the file is exported in.
    if (values.requestedAmount !== undefined || values.indirectRatePercent !== undefined || values.formatProfile !== undefined) await invalidatePackage(owned.app.id);
  }
  const [app] = await db.select().from(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id)).limit(1);
  res.json(await workspace(app, owned.applicant));
});

router.delete("/grants/applications/:id", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  await deleteNoticeFiles([owned.app.id]);
  await db.delete(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id));
  res.status(204).end();
});

// ── Requirements (compliance matrix) ─────────────────────────────────────

const REQUIREMENT_KINDS = ["section", "attachment", "form", "eligibility", "formatting", "criterion", "deadline"];
const REQUIREMENT_STATUSES = ["open", "covered", "not_applicable"];

function requirementValues(body: Record<string, unknown>, creating: boolean): Record<string, unknown> | string {
  const values: Record<string, unknown> = {};
  if (creating || body.label !== undefined) {
    if (typeof body.label !== "string" || !body.label.trim()) return "label is required";
    values.label = body.label.trim().slice(0, 300);
  }
  if (creating || body.kind !== undefined) {
    if (!REQUIREMENT_KINDS.includes(body.kind as string)) return `kind must be one of: ${REQUIREMENT_KINDS.join(", ")}`;
    values.kind = body.kind;
  }
  if (body.status !== undefined) {
    if (!REQUIREMENT_STATUSES.includes(body.status as string)) return `status must be one of: ${REQUIREMENT_STATUSES.join(", ")}`;
    values.status = body.status;
  }
  for (const [field, max] of [["detail", 2000], ["sourceRef", 200], ["sectionKey", 60]] as const) {
    if (body[field] === undefined) continue;
    const text = optionalText(body[field], max);
    if (text === false) return `${field} must be text`;
    values[field] = text;
  }
  if (body.points !== undefined) {
    const points = optionalNumber(body.points, 0, 1000);
    if (points === false) return "points must be a number";
    values.points = points == null ? null : Math.round(points);
  }
  if (body.confirmed !== undefined) {
    if (typeof body.confirmed !== "boolean") return "confirmed must be true or false";
    values.confirmed = body.confirmed;
  }
  return values;
}

router.post("/grants/applications/:id/requirements", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["kind", "label", "detail", "sourceRef", "sectionKey", "points"]);
  if (typeof body === "string") return fail(res, 400, body);
  const values = requirementValues(body, true);
  if (typeof values === "string") return fail(res, 400, values);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${grantRequirementsTable.position}), 0)` }).from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, owned.app.id));
  // A row a person adds is theirs: it is confirmed by them as they add it.
  const [row] = await db.insert(grantRequirementsTable).values({ id: randomUUID(), applicationId: owned.app.id, origin: "manual", confirmed: true, confirmedBy: await actorOf(req), confirmedAt: new Date(), position: Number(max) + 1, ...(values as any) }).returning();
  await invalidatePackage(owned.app.id);
  res.status(201).json(row);
});

router.patch("/grants/requirements/:rid", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantRequirementsTable, param(req, "rid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["kind", "label", "detail", "sourceRef", "sectionKey", "points", "status", "confirmed"]);
  if (typeof body === "string") return fail(res, 400, body);
  const values = requirementValues(body, false);
  if (typeof values === "string") return fail(res, 400, values);
  if (owned.row.rejectedAt && Object.keys(values).length) return fail(res, 409, "This requirement was rejected. Restore it before editing or confirming it.");
  // A confirmation names the person who made it; withdrawing it clears the name.
  if (values.confirmed === true && !owned.row.confirmed) Object.assign(values, { confirmedBy: await actorOf(req), confirmedAt: new Date() });
  if (values.confirmed === false) Object.assign(values, { confirmedBy: null, confirmedAt: null });
  const [row] = await db.update(grantRequirementsTable).set(values).where(eq(grantRequirementsTable.id, owned.row.id)).returning();
  await invalidatePackage(owned.app.id);
  res.json(row);
});

/** Rejects a row: it leaves the matrix but is kept, with who rejected it, so the decision can be reviewed or undone. */
router.post("/grants/requirements/:rid/reject", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantRequirementsTable, param(req, "rid"), req.session.userId!, res);
  if (!owned) return;
  const [row] = await db
    .update(grantRequirementsTable)
    .set({ rejectedBy: await actorOf(req), rejectedAt: new Date(), confirmed: false, confirmedBy: null, confirmedAt: null })
    .where(eq(grantRequirementsTable.id, owned.row.id))
    .returning();
  await invalidatePackage(owned.app.id);
  res.json(row);
});

/** Puts a rejected row back in the matrix, unconfirmed. */
router.post("/grants/requirements/:rid/restore", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantRequirementsTable, param(req, "rid"), req.session.userId!, res);
  if (!owned) return;
  const [row] = await db.update(grantRequirementsTable).set({ rejectedBy: null, rejectedAt: null }).where(eq(grantRequirementsTable.id, owned.row.id)).returning();
  await invalidatePackage(owned.app.id);
  res.json(row);
});

router.delete("/grants/requirements/:rid", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantRequirementsTable, param(req, "rid"), req.session.userId!, res);
  if (!owned) return;
  await db.delete(grantRequirementsTable).where(eq(grantRequirementsTable.id, owned.row.id));
  await invalidatePackage(owned.app.id);
  res.status(204).end();
});

router.post("/grants/applications/:id/requirements/confirm-all", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  // Confirms what the person sees in the matrix: not rejected rows. The request names who confirmed.
  await db
    .update(grantRequirementsTable)
    .set({ confirmed: true, confirmedBy: await actorOf(req), confirmedAt: new Date() })
    .where(and(eq(grantRequirementsTable.applicationId, owned.app.id), eq(grantRequirementsTable.confirmed, false), isNull(grantRequirementsTable.rejectedAt)));
  await invalidatePackage(owned.app.id);
  res.json(await workspace(owned.app, owned.applicant));
});

router.post("/grants/applications/:id/requirements/extract", aiLimiter, async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body ?? {}, ["noticeText"]);
  if (typeof body === "string") return fail(res, 400, body);
  const supplied = optionalText(body.noticeText, 200_000);
  if (supplied === false) return fail(res, 400, "noticeText must be text");
  const notice = supplied ?? owned.app.noticeText;
  if (!notice || notice.length < 200) return fail(res, 400, "Paste the funding notice text (at least a few paragraphs) first.");
  if (supplied) await db.update(grantApplicationsTable).set({ noticeText: supplied }).where(eq(grantApplicationsTable.id, owned.app.id));
  await runAiJob(req, res, requirementsExtractJob, { applicationId: owned.app.id }, aiKey("extract", owned.app.id), async (r) => {
    const [app] = await db.select().from(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id)).limit(1);
    res.json({ added: Number(r.added ?? 0), demo: r.demo === true, message: (r.message as string | null) ?? null, workspace: await workspace(app, owned.applicant) });
  });
});

// ── Notice PDF and its requirement checklist ────────────────────────────────

/**
 * One PDF per application, uploaded (multipart field `pdf`) or fetched from a
 * link (the opportunity's official page, or one the person pastes). Attaching
 * a notice queues a `grant_notice_checklist` job that reads the pages and
 * proposes requirement rows, each citing its page and left unconfirmed.
 */
const noticeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: noticeConfig().maxBytes, files: 1, fields: 4 } });

function noticeUploadMiddleware(req: Request, res: Response, next: (err?: unknown) => void): void {
  if (!req.is("multipart/form-data")) return next();
  noticeUpload.single("pdf")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const limit = Math.round(noticeConfig().maxBytes / 1024 / 1024);
      return fail(res, err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.code === "LIMIT_FILE_SIZE" ? `The notice is larger than the ${limit} MB limit.` : `Upload problem: ${err.message}`);
    }
    if (err) return fail(res, 400, "The upload could not be read.");
    next();
  });
}

async function queueNoticeJob(req: Request, res: Response, noticeId: string, applicationId: string, done: () => Promise<void>): Promise<void> {
  const { job } = await enqueue(noticeChecklistJob, { noticeId, userId: req.session.userId! }, { userId: req.session.userId!, dedupeKey: aiKey("notice", applicationId), requestedBy: req.session.actorName ?? "operator" });
  const finished = await runJobNow(job.id);
  if (finished?.status === "succeeded" || finished?.status === "failed") return done();
  res.status(202).json({ jobId: job.id, status: finished?.status ?? job.status, pending: true });
}

router.post("/grants/applications/:id/notice", aiLimiter, noticeUploadMiddleware, async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  if (await activeJob(aiKey("notice", owned.app.id))) return fail(res, 409, "A notice is already being read for this application. Wait for it to finish.");
  const cfg = noticeConfig();
  const actor = await actorOf(req);
  let values: Omit<typeof grantNoticesTable.$inferInsert, "id" | "applicationId" | "uploadedBy">;
  if (req.file) {
    try {
      assertNoticeFile(req.file.buffer, cfg);
    } catch (err) {
      return fail(res, err instanceof NoticeFileError ? 400 : 500, err instanceof Error ? err.message : "The file could not be checked.");
    }
    let fileKey: string;
    try {
      fileKey = await storeSourcePdf(req.file.buffer);
    } catch (err) {
      req.log?.error({ err }, "Notice PDF storage failed");
      return fail(res, 503, "Persistent PDF storage is unavailable.");
    }
    values = { origin: "upload", sourceUrl: null, fileName: noticeFileName(req.file.originalname), fileKey, fileBytes: req.file.buffer.length, sha256: sha256(req.file.buffer) };
  } else {
    const body = pick(req.body ?? {}, ["url", "useOfficialLink"]);
    if (typeof body === "string") return fail(res, 400, body);
    const [opp] = await db.select({ officialUrl: grantOpportunitiesTable.officialUrl }).from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, owned.app.opportunityId)).limit(1);
    const raw = body.useOfficialLink === true ? opp?.officialUrl : typeof body.url === "string" ? body.url.trim() : "";
    if (!raw) return fail(res, 400, "Attach the notice PDF, or give a link to it.");
    if (raw.length > 2000) return fail(res, 400, "The link is too long.");
    try {
      checkNoticeUrl(raw);
    } catch (err) {
      return fail(res, 400, err instanceof Error ? err.message : "The link cannot be used.");
    }
    values = { origin: "link", sourceUrl: raw, fileName: noticeFileName(new URL(raw).pathname.split("/").pop()), fileKey: null, fileBytes: 0, sha256: null };
  }

  // Attaching a new notice replaces the old one and its unreviewed proposals.
  const [previous] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, owned.app.id)).limit(1);
  if (previous) await removeNotice(owned.app.id);
  const id = randomUUID();
  try {
    await db.insert(grantNoticesTable).values({ id, applicationId: owned.app.id, uploadedBy: actor, status: "queued", ...values });
  } catch (err) {
    if (values.fileKey) await deleteSourcePdf(values.fileKey).catch(() => {});
    throw err;
  }
  await logActivity("grant_notice_attached", `Notice attached to "${owned.app.title}" (${values.origin === "upload" ? values.fileName : "from a link"})`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  await queueNoticeJob(req, res, id, owned.app.id, async () => {
    const [app] = await db.select().from(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id)).limit(1);
    res.status(201).json(await workspace(app, owned.applicant));
  });
});

/** Reads the notice again (for example after an AI key was added), replacing proposals nobody has acted on. */
router.post("/grants/applications/:id/notice/rerun", aiLimiter, async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const [notice] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, owned.app.id)).limit(1);
  if (!notice) return fail(res, 404, "No notice is attached to this application.");
  await db.update(grantNoticesTable).set({ status: "queued", error: null }).where(eq(grantNoticesTable.id, notice.id));
  await queueNoticeJob(req, res, notice.id, owned.app.id, async () => {
    res.json(await workspace(owned.app, owned.applicant));
  });
});

router.delete("/grants/applications/:id/notice", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  if (await activeJob(aiKey("notice", owned.app.id))) return fail(res, 409, "The notice is being read. Wait for it to finish, then remove it.");
  if (!(await removeNotice(owned.app.id))) return fail(res, 404, "No notice is attached to this application.");
  res.json(await workspace(owned.app, owned.applicant));
});

/** One page's text, so a person can check a citation against the notice itself. */
router.get("/grants/applications/:id/notice/pages/:page", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const [notice] = await db.select({ pages: grantNoticesTable.pages, pageCount: grantNoticesTable.pageCount }).from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, owned.app.id)).limit(1);
  if (!notice) return fail(res, 404, "No notice is attached to this application.");
  const n = Number(param(req, "page"));
  const pages = (notice.pages ?? []) as string[];
  if (!Number.isInteger(n) || n < 1 || n > pages.length) return fail(res, 404, `Page not found: the notice has ${pages.length} page${pages.length === 1 ? "" : "s"} read.`);
  res.setHeader("Cache-Control", "no-store");
  res.json({ page: n, pagesRead: pages.length, pageCount: notice.pageCount, text: pages[n - 1] });
});

/** The original notice PDF, for the person to open beside the checklist. */
router.get("/grants/applications/:id/notice/file", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const [notice] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, owned.app.id)).limit(1);
  if (!notice?.fileKey) return fail(res, 404, "No notice file is stored for this application.");
  try {
    const buffer = await readSourcePdf(notice.fileKey);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${notice.fileName.replace(/[^\w.\- ()]+/g, "_")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(buffer);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fail(res, 404, "The stored notice file was not found.");
    throw err;
  }
});

// ── Sections ───────────────────────────────────────────────────────────────

router.patch("/grants/sections/:sid", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["title", "content", "guidance", "limitType", "limitValue"]);
  if (typeof body === "string") return fail(res, 400, body);
  const values: Record<string, unknown> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return fail(res, 400, "title must be text");
    values.title = body.title.trim().slice(0, 200);
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string") return fail(res, 400, "content must be text");
    if (body.content.length > 400_000) return fail(res, 413, "The section is too long to save.");
    values.content = sanitizeRichHtml(body.content);
    values.demoContent = false;
    values.status = checkLimit(values.content as string, null, null).words ? "drafting" : "empty";
    values.approvedBy = null;
    values.approvedAt = null;
  }
  if (body.guidance !== undefined) {
    const g = optionalText(body.guidance, 4000);
    if (g === false) return fail(res, 400, "guidance must be text");
    values.guidance = g;
  }
  if (body.limitType !== undefined) {
    if (body.limitType !== null && !["words", "characters", "pages"].includes(body.limitType as string)) return fail(res, 400, "limitType must be words, characters or pages");
    values.limitType = body.limitType;
  }
  if (body.limitValue !== undefined) {
    const n = optionalNumber(body.limitValue, 1, 1_000_000);
    if (n === false) return fail(res, 400, "limitValue must be a positive number");
    values.limitValue = n == null ? null : Math.round(n);
  }
  const [row] = await db.update(grantSectionsTable).set(values).where(eq(grantSectionsTable.id, owned.row.id)).returning();
  await invalidatePackage(owned.app.id);
  res.json({ ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) });
});

/**
 * Queues an AI job and answers within a few seconds when it finishes, with
 * the same response as before. Otherwise 202 with the job id: the page follows
 * the job and refreshes when it is done. One job per section (or notice) runs
 * at a time; asking again returns the running one.
 */
async function runAiJob(req: Request, res: Response, def: typeof sectionDraftJob | typeof sectionReviewJob | typeof requirementsExtractJob, payload: Record<string, string>, key: string, done: (result: Record<string, unknown>) => Promise<void>): Promise<void> {
  const { job } = await enqueue(def as any, { ...payload, userId: req.session.userId! }, { userId: req.session.userId!, dedupeKey: key, requestedBy: req.session.actorName ?? "operator" });
  const finished = await runJobNow(job.id);
  if (finished?.status === "succeeded") return done((finished.result ?? {}) as Record<string, unknown>);
  if (finished?.status === "failed") {
    res.status(502).json({ error: finished.lastError ?? "The AI request failed.", jobId: finished.id });
    return;
  }
  res.status(202).json({ jobId: job.id, status: finished?.status ?? job.status, pending: true });
}

async function sectionResponse(sectionId: string) {
  const [row] = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.id, sectionId)).limit(1);
  return { ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) };
}

router.post("/grants/sections/:sid/draft", aiLimiter, async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  if (owned.row.status === "approved") return fail(res, 409, "Reopen the section before drafting it again.");
  // Plan limit: the first AI draft in an application each month counts it once, but only if a draft
  // in it succeeds (the job confirms or releases the reservation). Allowed whenever billing is off.
  const allowed = await claimAiDraftedApplication(req.session, owned.app.id);
  if (!allowed.allowed) {
    res.status(402).json(limitResponse(allowed));
    return;
  }
  await runAiJob(req, res, sectionDraftJob, { sectionId: owned.row.id, ...(allowed.usage ?? {}) }, aiKey("draft", owned.row.id), async (r) => {
    res.json({ section: await sectionResponse(owned.row.id), demo: r.demo === true, provider: r.provider ?? null, message: (r.message as string | null) ?? null });
  });
});

router.post("/grants/sections/:sid/review", aiLimiter, async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  await runAiJob(req, res, sectionReviewJob, { sectionId: owned.row.id }, aiKey("review", owned.row.id), async (r) => {
    res.json({ section: await sectionResponse(owned.row.id), demo: r.demo === true, message: (r.message as string | null) ?? null });
  });
});

router.post("/grants/sections/:sid/approve", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const limit = checkLimit(owned.row.content, owned.row.limitType, owned.row.limitValue);
  if (!limit.words) return fail(res, 409, "Write the section before approving it.");
  if (owned.row.demoContent) return fail(res, 409, "Replace the demo scaffold with your own writing before approving.");
  if (limit.over) return fail(res, 409, `The section is over its limit (${limit.used} of ${limit.limit} ${limit.unit}).`);
  // The unsupported-claim check runs on the current text first; an open flag blocks approval.
  const flags = await syncClaimChecks(owned.app, owned.applicant, [owned.row]);
  const open = flags.filter((f) => f.sectionId === owned.row.id && f.status === "open");
  if (open.length) {
    res.status(409).json({ error: `${open.length} unsupported claim${open.length === 1 ? " is" : "s are"} open in this section. Link each to a confirmed fact, edit the text, or dismiss it with a reason, then approve.`, openClaims: open.map(flagView) });
    return;
  }
  const username = await actorOf(req);
  const [row] = await db.update(grantSectionsTable).set({ status: "approved", approvedBy: username, approvedAt: new Date() }).where(eq(grantSectionsTable.id, owned.row.id)).returning();
  await db.insert(grantApprovalsTable).values({ id: randomUUID(), applicationId: owned.app.id, scope: "section", subjectId: row.id, role: "reviewer", approvedBy: username });
  res.json({ ...row, limitCheck: limit });
});

router.post("/grants/sections/:sid/reopen", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const [row] = await db.update(grantSectionsTable).set({ status: "drafting", approvedBy: null, approvedAt: null }).where(eq(grantSectionsTable.id, owned.row.id)).returning();
  await invalidatePackage(owned.app.id);
  res.json({ ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) });
});

// ── Budget ────────────────────────────────────────────────────────────────

function budgetValues(body: Record<string, unknown>, creating: boolean): Record<string, unknown> | string {
  const values: Record<string, unknown> = {};
  if (creating || body.category !== undefined) {
    if (!isBudgetCategory(body.category)) return `category must be one of: ${Object.keys(BUDGET_CATEGORIES).join(", ")}`;
    values.category = body.category;
  }
  if (creating || body.description !== undefined) {
    if (typeof body.description !== "string" || !body.description.trim()) return "description is required";
    values.description = body.description.trim().slice(0, 300);
  }
  for (const [field, min, max] of [["quantity", 0, 1_000_000], ["unitCost", 0, 1_000_000_000], ["matchPercent", 0, 100]] as const) {
    if (body[field] === undefined) continue;
    const n = optionalNumber(body[field], min, max);
    if (n === false || n === null) return `${field} must be a number from ${min} to ${max}`;
    values[field] = n;
  }
  if (body.justification !== undefined) {
    const j = optionalText(body.justification, 4000);
    if (j === false) return "justification must be text";
    values.justification = j;
  }
  return values;
}

router.post("/grants/applications/:id/budget-lines", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["category", "description", "quantity", "unitCost", "matchPercent", "justification"]);
  if (typeof body === "string") return fail(res, 400, body);
  const values = budgetValues(body, true);
  if (typeof values === "string") return fail(res, 400, values);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${grantBudgetLinesTable.position}), 0)` }).from(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.applicationId, owned.app.id));
  const [row] = await db.insert(grantBudgetLinesTable).values({ id: randomUUID(), applicationId: owned.app.id, position: Number(max) + 1, ...(values as any) }).returning();
  await invalidatePackage(owned.app.id);
  res.status(201).json({ ...row, total: lineTotal(row) });
});

router.patch("/grants/budget-lines/:lid", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantBudgetLinesTable, param(req, "lid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["category", "description", "quantity", "unitCost", "matchPercent", "justification"]);
  if (typeof body === "string") return fail(res, 400, body);
  const values = budgetValues(body, false);
  if (typeof values === "string") return fail(res, 400, values);
  const [row] = await db.update(grantBudgetLinesTable).set(values).where(eq(grantBudgetLinesTable.id, owned.row.id)).returning();
  await invalidatePackage(owned.app.id);
  res.json({ ...row, total: lineTotal(row) });
});

router.delete("/grants/budget-lines/:lid", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantBudgetLinesTable, param(req, "lid"), req.session.userId!, res);
  if (!owned) return;
  await db.delete(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.id, owned.row.id));
  await invalidatePackage(owned.app.id);
  res.status(204).end();
});

/** Writes a budget justification from the budget lines into the budget justification section. */
router.post("/grants/applications/:id/budget-justification", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const lines = await db.select().from(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.applicationId, owned.app.id)).orderBy(asc(grantBudgetLinesTable.position));
  if (!lines.length) return fail(res, 400, "Add budget lines first.");
  const [section] = await db.select().from(grantSectionsTable).where(and(eq(grantSectionsTable.applicationId, owned.app.id), eq(grantSectionsTable.key, "budget_justification"))).limit(1);
  if (!section) return fail(res, 404, "This application has no budget justification section.");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const parts: string[] = [];
  for (const key of Object.keys(BUDGET_CATEGORIES) as (keyof typeof BUDGET_CATEGORIES)[]) {
    const group = lines.filter((l) => l.category === key);
    if (!group.length) continue;
    parts.push(`<h3>${BUDGET_CATEGORIES[key]}</h3><ul>`);
    for (const l of group) {
      parts.push(`<li><strong>${esc(l.description)}</strong>: ${l.quantity} × ${usd(l.unitCost)} = ${usd(lineTotal(l))}${l.matchPercent ? ` (${l.matchPercent}% match)` : ""}. ${esc(l.justification?.trim() || "[Add why this cost is needed.]")}</li>`);
    }
    parts.push("</ul>");
  }
  if (owned.app.indirectRatePercent > 0) parts.push(`<h3>Indirect costs</h3><p>Indirect costs at ${owned.app.indirectRatePercent}% of requested direct costs. [Add: the basis for the rate, for example a negotiated agreement or the de minimis rate the notice allows.]</p>`);
  const content = sanitizeRichHtml(parts.join(""));
  const [row] = await db.update(grantSectionsTable).set({ content, demoContent: false, status: "drafting", approvedBy: null, approvedAt: null }).where(eq(grantSectionsTable.id, section.id)).returning();
  await invalidatePackage(owned.app.id);
  res.json({ ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) });
});

// ── Package ───────────────────────────────────────────────────────────────

router.post("/grants/applications/:id/approve-package", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body ?? {}, ["confirmAuthorized", "note"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (body.confirmAuthorized !== true) return fail(res, 400, "Only the organization's authorized representative may approve the package. Confirm that you are, or are acting with their written approval.");
  const note = optionalText(body.note, 1000);
  if (note === false) return fail(res, 400, "note must be text");
  const ws = await workspace(owned.app, owned.applicant);
  if (!ws.compliance.readyForApproval) return fail(res, 409, "Every compliance check must pass before the package is approved.");
  const username = await actorOf(req);
  await db.insert(grantApprovalsTable).values({ id: randomUUID(), applicationId: owned.app.id, scope: "package", role: "authorized_representative", approvedBy: username, note: note ?? null });
  await db.update(grantApplicationsTable).set({ status: "approved" }).where(eq(grantApplicationsTable.id, owned.app.id));
  await logActivity("grant_package_approved", `Package approved: ${owned.app.title}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  const [app] = await db.select().from(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id)).limit(1);
  res.json(await workspace(app, owned.applicant));
});

router.get("/grants/applications/:id/package.docx", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const ws = await workspace(owned.app, owned.applicant);
  const draft = req.query.draft === "1" || req.query.draft === "true";
  if (!draft && !ws.compliance.readyToExport) return fail(res, 409, "The final package needs every compliance check and the authorized representative's approval. Download a draft instead.");
  const buffer = await buildApplicationPackage({
    draft,
    applicantName: owned.applicant.name,
    applicantTypeLabel: ws.applicant.applicantTypeLabel,
    ein: owned.applicant.ein,
    uei: owned.applicant.uei,
    opportunity: { title: ws.opportunity.title, number: ws.opportunity.number, agency: ws.opportunity.agency, closeDate: ws.opportunity.closeDate, officialUrl: ws.opportunity.officialUrl, federal: ws.opportunity.federal },
    requestedAmount: ws.budget.requested,
    sections: ws.sections.map((s) => ({ title: s.title, content: s.content })),
    budgetLines: ws.budgetLines,
    budget: ws.budget,
    requirements: ws.requirements,
    approvals: ws.approvals,
    format: ws.format.profile,
    forms: (await applicationForms(owned.app, owned.applicant)).views.map(formRows),
    generatedAt: new Date(),
  });
  if (!draft) {
    await db.update(grantApplicationsTable).set({ status: "exported", exportedAt: new Date() }).where(eq(grantApplicationsTable.id, owned.app.id));
    await logActivity("grant_package_exported", `Package exported: ${owned.app.title}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  }
  // The notice's file name when one is recorded (already checked against Grants.gov's rules), otherwise a Grants.gov-safe default.
  const recorded = ws.format.profile.fileName?.replace(/\.(?:docx|doc|pdf)$/i, "");
  const name = recorded && !draft ? recorded : defaultFileStem(owned.applicant.name, ws.opportunity.number, draft);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.docx"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
});

// ── Federal forms ─────────────────────────────────────────────────────────
// SF-424, SF-424A, SF-424B and SF-LLL from HHS/simpler-grants-gov's public-domain
// definitions (lib/grants/federalForms). Prefilled from the organization, the
// opportunity and the budget; everything else is for a person. Nothing is sent
// to Grants.gov: the forms go into the package a person submits.

async function applicationForms(app: GrantApplication, applicant: GrantApplicant) {
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, app.opportunityId)).limit(1);
  const lines = await db.select().from(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.applicationId, app.id));
  const federal = !opp.jurisdiction;
  const ctx = formsContext(app, applicant, opp, summarizeBudget(lines, app.indirectRatePercent, opp.awardCeiling), lines.length > 0);
  return { opp, federal, ctx, views: await loadFormViews(app, ctx, federal) };
}

function formParam(req: Request, res: Response): FederalFormKey | null {
  const key = param(req, "form");
  if (!isFederalFormKey(key)) {
    fail(res, 404, "Unknown form");
    return null;
  }
  return key;
}

async function upsertForm(applicationId: string, key: FederalFormKey, values: Partial<typeof grantFederalFormsTable.$inferInsert>): Promise<void> {
  await db
    .insert(grantFederalFormsTable)
    .values({ id: randomUUID(), applicationId, formKey: key, ...values })
    .onConflictDoUpdate({ target: [grantFederalFormsTable.applicationId, grantFederalFormsTable.formKey], set: { ...values, updatedAt: new Date() } });
}

async function formsResponse(app: GrantApplication, applicant: GrantApplicant) {
  const { federal, views } = await applicationForms(app, applicant);
  return { federal, source: FORM_SOURCE, forms: views, check: federal ? formsCheck(views) : null };
}

router.get("/grants/applications/:id/forms", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  res.json(await formsResponse(owned.app, owned.applicant));
});

router.put("/grants/applications/:id/forms/:form", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const key = formParam(req, res);
  if (!key) return;
  const body = pick(req.body, ["values", "reset"]);
  if (typeof body === "string") return fail(res, 400, body);
  const { federal } = await applicationForms(owned.app, owned.applicant);
  if (!federal) return fail(res, 409, "State programs use the forms on their own portal; GrantCrest fills federal forms only.");
  const values = body.values ?? {};
  if (!values || typeof values !== "object" || Array.isArray(values)) return fail(res, 400, "values must be an object of field: value.");
  const reset = body.reset ?? [];
  if (!Array.isArray(reset) || reset.some((r) => typeof r !== "string")) return fail(res, 400, "reset must be a list of field ids.");
  const entries = Object.entries(values as Record<string, unknown>);
  if (entries.length + reset.length > 300) return fail(res, 400, "Too many fields in one save.");
  const fields = entryFields(key);
  const [row] = await db.select().from(grantFederalFormsTable).where(and(eq(grantFederalFormsTable.applicationId, owned.app.id), eq(grantFederalFormsTable.formKey, key))).limit(1);
  const next: Record<string, unknown> = { ...(row?.values ?? {}) };
  const problems: string[] = [];
  for (const [id, raw] of entries) {
    const field = fields.get(id);
    if (!field) {
      problems.push(`${id} is not a field a person fills in on this form.`);
      continue;
    }
    const coerced = coerceValue(field, raw);
    if (!coerced.ok) problems.push(coerced.error);
    else next[id] = coerced.value;
  }
  for (const id of reset as string[]) {
    if (!fields.has(id)) problems.push(`${id} is not a field a person fills in on this form.`);
    else delete next[id];
  }
  if (problems.length) {
    res.status(400).json({ error: problems[0], errors: problems });
    return;
  }
  await upsertForm(owned.app.id, key, { values: next, updatedBy: await actorOf(req) });
  await invalidatePackage(owned.app.id);
  res.json(await formsResponse(owned.app, owned.applicant));
});

router.post("/grants/applications/:id/forms/:form/review", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const key = formParam(req, res);
  if (!key) return;
  const { federal, views } = await applicationForms(owned.app, owned.applicant);
  if (!federal) return fail(res, 409, "State programs use the forms on their own portal.");
  const view = views.find((v) => v.key === key)!;
  if (view.notApplicable) return fail(res, 409, "This form is marked not applicable.");
  if (view.errorCount > 0) return fail(res, 409, `Complete the ${view.counts.toComplete} field${view.counts.toComplete === 1 ? "" : "s"} marked on this form before marking it reviewed.`);
  await upsertForm(owned.app.id, key, { reviewedBy: await actorOf(req), reviewedAt: new Date(), reviewedHash: view.dataHash });
  res.json(await formsResponse(owned.app, owned.applicant));
});

router.post("/grants/applications/:id/forms/:form/applicability", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const key = formParam(req, res);
  if (!key) return;
  if (key !== "sflll") return fail(res, 400, "Only the SF-LLL can be marked not applicable.");
  const body = pick(req.body, ["notApplicable", "reason"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (typeof body.notApplicable !== "boolean") return fail(res, 400, "notApplicable must be true or false.");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (body.notApplicable && reason.length < 10) return fail(res, 400, "Say why the SF-LLL does not apply (at least 10 characters), for example that no one is paid to lobby for this award.");
  const { federal } = await applicationForms(owned.app, owned.applicant);
  if (!federal) return fail(res, 409, "State programs use the forms on their own portal.");
  const actor = await actorOf(req);
  await upsertForm(owned.app.id, key, body.notApplicable
    ? { notApplicable: true, notApplicableReason: reason, notApplicableBy: actor, notApplicableAt: new Date() }
    : { notApplicable: false, notApplicableReason: null, notApplicableBy: null, notApplicableAt: null });
  await invalidatePackage(owned.app.id);
  res.json(await formsResponse(owned.app, owned.applicant));
});

/** The filled forms as JSON (Simpler Grants' data shape) or as a readable PDF; final only once the package is approved. */
async function sendForms(req: Request, res: Response, kind: "json" | "pdf"): Promise<void> {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const { federal, views, opp } = await applicationForms(owned.app, owned.applicant);
  if (!federal) return fail(res, 404, "This application is for a state program: its forms are on the state's portal.");
  const draft = req.query.draft === "1" || req.query.draft === "true";
  if (!draft && !(await workspace(owned.app, owned.applicant)).compliance.readyToExport) {
    return fail(res, 409, "The final forms come with the approved package. Download a draft instead.");
  }
  const meta = { draft, applicantName: owned.applicant.name, opportunityTitle: opp.title, opportunityNumber: opp.number, generatedAt: new Date() };
  const stem = `${defaultFileStem(owned.applicant.name, opp.number, draft)}_forms`;
  res.setHeader("Cache-Control", "no-store");
  if (kind === "json") {
    res.setHeader("Content-Disposition", `attachment; filename="${stem}.json"`);
    res.json(formsJson(views, meta));
    return;
  }
  const pdf = await buildFormsPdf(views, meta);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${stem}.pdf"`);
  res.send(pdf);
}

router.get("/grants/applications/:id/forms.json", (req, res) => sendForms(req, res, "json"));
router.get("/grants/applications/:id/forms.pdf", (req, res) => sendForms(req, res, "pdf"));

// ── Unsupported-claim check ───────────────────────────────────────────────
// Flags are kept per section (grant_claim_flags). A person resolves each one:
// links it to a confirmed fact, edits the text (the check closes it), or
// dismisses it with a recorded reason. Approval is refused while any is open.

async function ownedFlag(id: string, userId: string, res: Response) {
  const [found] = await db
    .select({ flag: grantClaimFlagsTable, section: grantSectionsTable, app: grantApplicationsTable, applicant: grantApplicantsTable })
    .from(grantClaimFlagsTable)
    .innerJoin(grantSectionsTable, eq(grantClaimFlagsTable.sectionId, grantSectionsTable.id))
    .innerJoin(grantApplicationsTable, eq(grantClaimFlagsTable.applicationId, grantApplicationsTable.id))
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantClaimFlagsTable.id, id), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!found) fail(res, 404, "Claim flag not found");
  return found ?? null;
}

async function sectionClaims(sectionId: string, app: GrantApplication, applicant: GrantApplicant) {
  const [section] = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.id, sectionId)).limit(1);
  const flags = await syncClaimChecks(app, applicant, [section]);
  const [fresh] = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.id, sectionId)).limit(1);
  return claimsView(fresh, flags);
}

router.post("/grants/sections/:sid/claims/check", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  await syncClaimChecks(owned.app, owned.applicant, [owned.row], { force: [owned.row.id] });
  res.json({ claims: await sectionClaims(owned.row.id, owned.app, owned.applicant) });
});

router.post("/grants/claim-flags/:fid/resolve", async (req, res): Promise<void> => {
  const owned = await ownedFlag(param(req, "fid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["action", "factId", "reason", "sameSentence"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (owned.flag.status !== "open") return fail(res, 409, "This flag is already resolved.");
  const actor = await actorOf(req);
  let values: Partial<typeof grantClaimFlagsTable.$inferInsert>;
  if (body.action === "link") {
    if (typeof body.factId !== "string") return fail(res, 400, "Choose a confirmed fact from this organization's library.");
    const [fact] = await db.select().from(grantFactsTable).where(and(eq(grantFactsTable.id, body.factId), eq(grantFactsTable.applicantId, owned.applicant.id))).limit(1);
    if (!fact || !fact.confirmedAt) return fail(res, 400, "Choose a confirmed fact from this organization's library.");
    values = { status: "resolved", resolution: "linked", factId: fact.id, dismissReason: null, resolvedBy: actor, resolvedAt: new Date() };
  } else if (body.action === "dismiss") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 1000) return fail(res, 400, "Say why this claim needs no fact or source (10 to 1,000 characters). The reason is kept with the application.");
    values = { status: "resolved", resolution: "dismissed", factId: null, dismissReason: reason, resolvedBy: actor, resolvedAt: new Date() };
  } else {
    return fail(res, 400, "action must be link or dismiss. To fix the text instead, edit the section: the check closes the flag when the claim is gone.");
  }
  // With sameSentence, one fact or reason resolves every open flag in the same sentence.
  const scope = body.sameSentence === true
    ? and(eq(grantClaimFlagsTable.sectionId, owned.flag.sectionId), eq(grantClaimFlagsTable.sentence, owned.flag.sentence), eq(grantClaimFlagsTable.status, "open"))
    : eq(grantClaimFlagsTable.id, owned.flag.id);
  const updated = await db.update(grantClaimFlagsTable).set(values).where(scope).returning({ id: grantClaimFlagsTable.id });
  await logActivity("grant_claim_resolved", `Claim ${values.resolution}: "${owned.flag.claim.slice(0, 80)}" in ${owned.section.title}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.json({ resolved: updated.length, claims: await sectionClaims(owned.flag.sectionId, owned.app, owned.applicant) });
});

router.post("/grants/claim-flags/:fid/reopen", async (req, res): Promise<void> => {
  const owned = await ownedFlag(param(req, "fid"), req.session.userId!, res);
  if (!owned) return;
  if (owned.flag.status !== "resolved" || (owned.flag.resolution !== "linked" && owned.flag.resolution !== "dismissed")) return fail(res, 409, "Only a linked or dismissed flag can be reopened.");
  if (owned.section.status === "approved") return fail(res, 409, "Reopen the section before reopening one of its flags.");
  await db.update(grantClaimFlagsTable).set({ status: "open", resolution: null, factId: null, dismissReason: null, resolvedBy: null, resolvedAt: null }).where(eq(grantClaimFlagsTable.id, owned.flag.id));
  res.json({ claims: await sectionClaims(owned.flag.sectionId, owned.app, owned.applicant) });
});

// ── Saved writing ──────────────────────────────────────────────────────────

const MAX_SNIPPETS_PER_APPLICANT = 200;

async function ownedSnippet(id: string, userId: string, res: Response): Promise<{ snippet: GrantSnippet; applicant: GrantApplicant } | null> {
  const [row] = await db
    .select({ snippet: grantSnippetsTable, applicant: grantApplicantsTable })
    .from(grantSnippetsTable)
    .innerJoin(grantApplicantsTable, eq(grantSnippetsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantSnippetsTable.id, id), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!row) fail(res, 404, "Saved writing not found");
  return row ?? null;
}

function snippetView(w: GrantSnippet) {
  const { words } = checkLimit(w.content, null, null);
  return { ...w, words, preview: htmlToText(w.content).slice(0, 240) };
}

router.get("/grants/applicants/:id/snippets", async (req, res): Promise<void> => {
  const applicant = await ownedApplicant(param(req, "id"), req.session.userId!, res);
  if (!applicant) return;
  const rows = await db.select().from(grantSnippetsTable).where(eq(grantSnippetsTable.applicantId, applicant.id)).orderBy(desc(grantSnippetsTable.updatedAt));
  res.json(rows.map(snippetView));
});

router.post("/grants/sections/:sid/save-to-library", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body ?? {}, ["title"]);
  if (typeof body === "string") return fail(res, 400, body);
  const section = owned.row;
  if (section.status !== "approved") return fail(res, 409, "Approve the section before saving it for reuse.");
  if (section.demoContent) return fail(res, 409, "Demo scaffold text cannot be saved.");
  const title = optionalText(body.title, 160);
  if (title === false) return fail(res, 400, "title must be text");
  const [{ n }] = await db.select({ n: count() }).from(grantSnippetsTable).where(eq(grantSnippetsTable.applicantId, owned.applicant.id));
  if (Number(n) >= MAX_SNIPPETS_PER_APPLICANT) return fail(res, 400, `An organization can keep at most ${MAX_SNIPPETS_PER_APPLICANT} saved texts.`);
  const [row] = await db.insert(grantSnippetsTable).values({
    id: randomUUID(),
    applicantId: owned.applicant.id,
    title: title || `${section.title} (${owned.app.title.slice(0, 80)})`,
    sectionKey: section.key,
    content: sanitizeRichHtml(section.content),
    sourceApplicationId: owned.app.id,
    sourceLabel: owned.app.title.slice(0, 200),
    savedBy: await actorOf(req),
  }).returning();
  res.status(201).json(snippetView(row));
});

router.patch("/grants/snippets/:wid", async (req, res): Promise<void> => {
  const owned = await ownedSnippet(param(req, "wid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["title"]);
  if (typeof body === "string") return fail(res, 400, body);
  const title = optionalText(body.title, 160);
  if (!title) return fail(res, 400, "title is required");
  const [row] = await db.update(grantSnippetsTable).set({ title }).where(eq(grantSnippetsTable.id, owned.snippet.id)).returning();
  res.json(snippetView(row));
});

router.delete("/grants/snippets/:wid", async (req, res): Promise<void> => {
  const owned = await ownedSnippet(param(req, "wid"), req.session.userId!, res);
  if (!owned) return;
  await db.delete(grantSnippetsTable).where(eq(grantSnippetsTable.id, owned.snippet.id));
  res.status(204).end();
});

/** Puts saved writing into a section (replace or append). Like any edit, it withdraws approvals and the package approval. */
router.post("/grants/sections/:sid/insert-snippet", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["snippetId", "mode"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (body.mode !== "replace" && body.mode !== "append") return fail(res, 400, "mode must be replace or append");
  if (owned.row.status === "approved") return fail(res, 409, "Reopen the section before changing it.");
  const [snippet] = await db.select().from(grantSnippetsTable).where(and(eq(grantSnippetsTable.id, String(body.snippetId ?? "")), eq(grantSnippetsTable.applicantId, owned.applicant.id))).limit(1);
  if (!snippet) return fail(res, 404, "Saved writing not found");
  const base = body.mode === "append" && !owned.row.demoContent ? owned.row.content : "";
  const content = sanitizeRichHtml(base + snippet.content);
  const [row] = await db
    .update(grantSectionsTable)
    .set({ content, demoContent: false, status: checkLimit(content, null, null).words ? "drafting" : "empty", approvedBy: null, approvedAt: null })
    .where(eq(grantSectionsTable.id, owned.row.id))
    .returning();
  await invalidatePackage(owned.app.id);
  res.json({ ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) });
});

// ── Writing toolkit: logic model and letters of support ───────────────────

/** Puts the application's logic model into a section as headings and lists (replace or append). Like any edit, it withdraws approvals. */
router.post("/grants/sections/:sid/insert-logic-model", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["mode"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (body.mode !== "replace" && body.mode !== "append") return fail(res, 400, "mode must be replace or append");
  if (owned.row.status === "approved") return fail(res, 409, "Reopen the section before changing it.");
  const html = logicModelHtml((owned.app.logicModel ?? {}) as LogicModel);
  if (!html) return fail(res, 400, "The logic model is empty. Fill it in on the Write step first.");
  const base = body.mode === "append" && !owned.row.demoContent ? owned.row.content : "";
  const content = sanitizeRichHtml(base + html);
  const [row] = await db
    .update(grantSectionsTable)
    .set({ content, demoContent: false, status: "drafting", approvedBy: null, approvedAt: null })
    .where(eq(grantSectionsTable.id, owned.row.id))
    .returning();
  await invalidatePackage(owned.app.id);
  res.json({ ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue), writingChecks: sectionWritingChecks(row) });
});

const LETTER_FIELDS = ["name", "organization", "purpose", "email", "status", "requestedOn", "dueOn", "receivedOn", "requirementId", "note"] as const;
const MAX_LETTERS_PER_APPLICATION = 60;

function letterView(l: GrantSupportLetter) {
  return { ...l, statusLabel: LETTER_STATUS_LABELS[l.status as keyof typeof LETTER_STATUS_LABELS] ?? l.status };
}

async function letterValues(body: Record<string, unknown>, creating: boolean, applicationId: string): Promise<Record<string, unknown> | string> {
  const values: Record<string, unknown> = {};
  for (const [field, max, required] of [["name", 160, true], ["organization", 200, false], ["purpose", 500, false], ["note", 1000, false]] as const) {
    if (!creating && body[field] === undefined) continue;
    const text = optionalText(body[field], max);
    if (text === false) return `${field} must be text`;
    if (required && !text) return `${field} is required`;
    values[field] = text ?? null;
  }
  if (body.email !== undefined) {
    const email = optionalText(body.email, 200);
    if (email === false || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return "email must be an email address";
    values.email = email;
  }
  if (body.status !== undefined || creating) {
    const status = body.status ?? "to_request";
    if (!LETTER_STATUSES.includes(status as any)) return `status must be one of: ${LETTER_STATUSES.join(", ")}`;
    values.status = status;
  }
  for (const field of ["requestedOn", "dueOn", "receivedOn"] as const) {
    const date = isoDate(body[field]);
    if (date === false) return `${field} must be a date (YYYY-MM-DD)`;
    if (date !== undefined) values[field] = date;
  }
  if (body.requirementId !== undefined) {
    if (body.requirementId === null || body.requirementId === "") values.requirementId = null;
    else {
      const [reqRow] = await db.select({ id: grantRequirementsTable.id }).from(grantRequirementsTable).where(and(eq(grantRequirementsTable.id, String(body.requirementId)), eq(grantRequirementsTable.applicationId, applicationId))).limit(1);
      if (!reqRow) return "requirementId must be a requirement of this application";
      values.requirementId = reqRow.id;
    }
  }
  // Recording a received letter without a date stamps today.
  if (values.status === "received" && body.receivedOn === undefined) values.receivedOn = new Date().toISOString().slice(0, 10);
  if (values.status === "requested" && body.requestedOn === undefined && creating) values.requestedOn = new Date().toISOString().slice(0, 10);
  return values;
}

async function ownedLetter(id: string, userId: string, res: Response): Promise<{ letter: GrantSupportLetter; app: GrantApplication } | null> {
  const [row] = await db
    .select({ letter: grantSupportLettersTable, app: grantApplicationsTable })
    .from(grantSupportLettersTable)
    .innerJoin(grantApplicationsTable, eq(grantSupportLettersTable.applicationId, grantApplicationsTable.id))
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantSupportLettersTable.id, id), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!row) fail(res, 404, "Letter not found");
  return row ?? null;
}

router.post("/grants/applications/:id/letters", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, LETTER_FIELDS);
  if (typeof body === "string") return fail(res, 400, body);
  const values = await letterValues(body, true, owned.app.id);
  if (typeof values === "string") return fail(res, 400, values);
  const [{ n }] = await db.select({ n: count() }).from(grantSupportLettersTable).where(eq(grantSupportLettersTable.applicationId, owned.app.id));
  if (Number(n) >= MAX_LETTERS_PER_APPLICATION) return fail(res, 400, `An application can track at most ${MAX_LETTERS_PER_APPLICATION} letters.`);
  const [row] = await db.insert(grantSupportLettersTable).values({ id: randomUUID(), applicationId: owned.app.id, ...(values as any) }).returning();
  res.status(201).json(letterView(row));
});

router.patch("/grants/letters/:lid", async (req, res): Promise<void> => {
  const owned = await ownedLetter(param(req, "lid"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, LETTER_FIELDS);
  if (typeof body === "string") return fail(res, 400, body);
  const values = await letterValues(body, false, owned.app.id);
  if (typeof values === "string") return fail(res, 400, values);
  if (Object.keys(values).length === 0) {
    res.json(letterView(owned.letter));
    return;
  }
  const [row] = await db.update(grantSupportLettersTable).set(values).where(eq(grantSupportLettersTable.id, owned.letter.id)).returning();
  res.json(letterView(row));
});

router.delete("/grants/letters/:lid", async (req, res): Promise<void> => {
  const owned = await ownedLetter(param(req, "lid"), req.session.userId!, res);
  if (!owned) return;
  await db.delete(grantSupportLettersTable).where(eq(grantSupportLettersTable.id, owned.letter.id));
  res.status(204).end();
});

// ── Outcomes and pipeline ──────────────────────────────────────────────────

router.post("/grants/applications/:id/outcome", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const body = pick(req.body, ["outcome", "date", "trackingNumber", "awardedAmount", "note"]);
  if (typeof body === "string") return fail(res, 400, body);
  if (!isOutcome(body.outcome)) return fail(res, 400, `outcome must be one of: ${OUTCOMES.join(", ")}`);
  const outcome = body.outcome;
  const problem = outcomeTransitionError({ status: owned.app.status, outcome: owned.app.outcome }, outcome);
  if (problem) return fail(res, 409, problem);
  const date = isoDate(body.date);
  if (date === false) return fail(res, 400, "date must be a date (YYYY-MM-DD)");
  const tracking = optionalText(body.trackingNumber, 100);
  if (tracking === false) return fail(res, 400, "trackingNumber must be text");
  const note = optionalText(body.note, 2000);
  if (note === false) return fail(res, 400, "note must be text");
  const amount = optionalNumber(body.awardedAmount, 0, 1_000_000_000);
  if (amount === false) return fail(res, 400, "awardedAmount must be a positive number");
  if (outcome === "awarded" && !amount) return fail(res, 400, "Record the awarded amount.");
  const day = date ?? new Date().toISOString().slice(0, 10);
  const values: Record<string, unknown> = { outcome, outcomeDate: day, outcomeRecordedBy: await actorOf(req) };
  if (note !== undefined) values.outcomeNote = note;
  if (outcome === "submitted") {
    const ws = await workspace(owned.app, owned.applicant);
    // The rating is frozen at submission so the organization's award rate can later be measured by band.
    Object.assign(values, { submittedOn: day, submittedAmount: ws.budget.requested || owned.app.requestedAmount || null, trackingNumber: tracking ?? owned.app.trackingNumber ?? null, awardedAmount: null, ratingAtSubmission: ws.rating.score, ratingBandAtSubmission: ws.rating.band });
  } else {
    if (tracking !== undefined) values.trackingNumber = tracking;
    values.awardedAmount = outcome === "awarded" ? amount : null;
  }
  const [app] = await db.update(grantApplicationsTable).set(values).where(eq(grantApplicationsTable.id, owned.app.id)).returning();
  await logActivity("grant_outcome_recorded", `Application "${app.title}" marked ${outcome}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.json(await workspace(app, owned.applicant));
});

/** Undoes the latest outcome step: a decision returns to submitted, a submission returns to exported. */
router.delete("/grants/applications/:id/outcome", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  if (!owned.app.outcome) return fail(res, 409, "No outcome is recorded.");
  const values = owned.app.outcome === "submitted"
    ? { outcome: null, outcomeDate: null, submittedOn: null, submittedAmount: null, trackingNumber: null, awardedAmount: null, outcomeNote: null, outcomeRecordedBy: null, ratingAtSubmission: null, ratingBandAtSubmission: null }
    : { outcome: "submitted", outcomeDate: owned.app.submittedOn, awardedAmount: null };
  const [app] = await db.update(grantApplicationsTable).set(values).where(eq(grantApplicationsTable.id, owned.app.id)).returning();
  res.json(await workspace(app, owned.applicant));
});

router.get("/grants/pipeline", async (req, res): Promise<void> => {
  const applicantId = typeof req.query.applicantId === "string" ? req.query.applicantId : null;
  const filters = [eq(grantApplicantsTable.userId, req.session.userId!)];
  if (applicantId) filters.push(eq(grantApplicantsTable.id, applicantId));
  const rows = await db
    .select({ app: grantApplicationsTable, opp: grantOpportunitiesTable })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .innerJoin(grantOpportunitiesTable, eq(grantApplicationsTable.opportunityId, grantOpportunitiesTable.id))
    .where(and(...filters));
  res.json({
    ...summarizePipeline(rows.map(({ app, opp }) => ({
      status: app.status,
      outcome: app.outcome,
      requested: app.submittedAmount,
      awardedAmount: app.awardedAmount,
      daysLeft: daysUntil(opp.closeDate),
    }))),
    /** Real award rates by the competitiveness band frozen at submission. */
    calibration: calibration(rows.map(({ app }) => ({ band: app.ratingBandAtSubmission as RatingBand | null, outcome: app.outcome }))),
  });
});

// ── Deadline calendars ─────────────────────────────────────────────────────

function sendCalendar(res: Response, name: string, body: string): void {
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileStem(name)}.ics"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
}

router.get("/grants/applications/:id/deadline.ics", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, owned.app.opportunityId)).limit(1);
  if (!opp?.closeDate) return fail(res, 409, "This opportunity has no closing date on record. Check the official notice.");
  sendCalendar(res, `${owned.applicant.name} ${opp.number ?? "deadline"}`, buildDeadlineCalendar(`${owned.applicant.name}: grant deadlines`, [{
    uid: `application-${owned.app.id}`,
    date: opp.closeDate,
    summary: `Grant due: ${owned.app.title}`,
    description: `${owned.applicant.name} · ${opp.agency ?? "Funder not recorded"}${opp.number ? ` · ${opp.number}` : ""}\nOfficial listing: ${opp.officialUrl}`,
    url: opp.officialUrl,
  }]));
});

router.get("/grants/opportunities/:id/deadline.ics", async (req, res): Promise<void> => {
  const [opp] = await db.select().from(grantOpportunitiesTable).where(and(eq(grantOpportunitiesTable.id, param(req, "id")), eq(grantOpportunitiesTable.publishable, true))).limit(1);
  if (!opp) return fail(res, 404, "Opportunity not found");
  if (!opp.closeDate) return fail(res, 409, "This opportunity has no closing date on record. Check the official notice.");
  sendCalendar(res, opp.number ?? opp.title, buildDeadlineCalendar("Grant deadlines", [{
    uid: `opportunity-${opp.id}`,
    date: opp.closeDate,
    summary: `Grant closes: ${opp.title}`,
    description: `${opp.agency ?? "Funder not recorded"}${opp.number ? ` · ${opp.number}` : ""}\nOfficial listing: ${opp.officialUrl}`,
    url: opp.officialUrl,
  }]));
});

router.get("/grants/calendar.ics", async (req, res): Promise<void> => {
  const rows = await db
    .select({ app: grantApplicationsTable, applicant: grantApplicantsTable, opp: grantOpportunitiesTable })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .innerJoin(grantOpportunitiesTable, eq(grantApplicationsTable.opportunityId, grantOpportunitiesTable.id))
    .where(eq(grantApplicantsTable.userId, req.session.userId!));
  const deadlines = rows
    .filter(({ app, opp }) => app.status !== "exported" && !app.outcome && opp.closeDate && (daysUntil(opp.closeDate) ?? -1) >= 0)
    .map(({ app, applicant, opp }) => ({
      uid: `application-${app.id}`,
      date: opp.closeDate!,
      summary: `Grant due: ${app.title} (${applicant.name})`,
      description: `${applicant.name} · ${opp.agency ?? "Funder not recorded"}${opp.number ? ` · ${opp.number}` : ""}\nOfficial listing: ${opp.officialUrl}`,
      url: opp.officialUrl,
    }));
  sendCalendar(res, "grant-deadlines", buildDeadlineCalendar("Grant deadlines", deadlines));
});

export default router;
