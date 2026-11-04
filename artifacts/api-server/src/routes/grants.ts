import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, ilike, inArray, or, sql, count } from "drizzle-orm";
import {
  db,
  grantApplicantsTable,
  grantApplicationsTable,
  grantApprovalsTable,
  grantBudgetLinesTable,
  grantFactsTable,
  grantSnippetsTable,
  grantOpportunitiesTable,
  grantReadinessItemsTable,
  grantRequirementsTable,
  grantSectionsTable,
  grantSyncRunsTable,
  usersTable,
  type GrantApplicant,
  type GrantApplication,
  type GrantFact,
  type GrantSnippet,
  type GrantOpportunity,
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
import { TEMPLATES, chooseTemplate, isTemplateKey, type TemplateKey } from "../lib/grants/templates";
import { summarizeBudget, lineTotal } from "../lib/grants/budget";
import { checkLimit, htmlToText } from "../lib/grants/text";
import { OUTCOMES, isOutcome, outcomeTransitionError, summarizePipeline } from "../lib/grants/pipeline";
import { evaluateCompliance } from "../lib/grants/compliance";
import { draftSection, extractRequirements, reviewSection, type DraftContext } from "../lib/grants/ai";
import { buildApplicationPackage } from "../lib/grants/packageExport";
import { refreshOpportunityDetail } from "../lib/grants/ingest";
import { enqueue } from "../lib/jobs/registry";
import { GRANT_SYNC_KEY, grantSyncJob } from "../lib/jobs/definitions";
import { activeJob } from "../lib/jobs/queue";
import { currentWorker } from "../lib/jobs/worker";
import { daysUntil } from "../lib/grants/gate";
import { buildDeadlineCalendar, fileStem } from "../lib/grants/calendar";
import { CA_SOURCE } from "../lib/grants/california";
import { FACT_CATEGORIES, SECTION_FACT_CATEGORIES, factLine, factsForSection, isFactCategory } from "../lib/grants/facts";

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

/** Any edit after approval reopens the package for approval, until a submission is recorded: then the record stands. */
async function invalidatePackage(applicationId: string): Promise<void> {
  const [app] = await db.select({ outcome: grantApplicationsTable.outcome }).from(grantApplicationsTable).where(eq(grantApplicationsTable.id, applicationId)).limit(1);
  if (app?.outcome) return;
  await db.delete(grantApprovalsTable).where(and(eq(grantApprovalsTable.applicationId, applicationId), eq(grantApprovalsTable.scope, "package")));
  await db.update(grantApplicationsTable).set({ status: "draft" }).where(and(eq(grantApplicationsTable.id, applicationId), inArray(grantApplicationsTable.status, ["approved", "exported"])));
}

function applicantSummary(applicant: GrantApplicant) {
  return { ...applicant, applicantTypeLabel: APPLICANT_TYPES[applicant.applicantType as ApplicantType]?.label ?? applicant.applicantType };
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

router.get("/grants/meta", async (_req, res): Promise<void> => {
  const [opps] = await db.select({ total: count() }).from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.publishable, true));
  const bySource = await db.select({ source: grantOpportunitiesTable.source, n: count() }).from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.publishable, true)).groupBy(grantOpportunitiesTable.source);
  const [lastRun] = await db.select().from(grantSyncRunsTable).orderBy(desc(grantSyncRunsTable.startedAt)).limit(1);
  const sync = await activeJob(GRANT_SYNC_KEY);
  res.json({
    applicantTypes: Object.entries(APPLICANT_TYPES).map(([key, v]) => ({ key, label: v.label, kind: v.kind })),
    readinessKinds: Object.entries(READINESS_KINDS).map(([key, v]) => ({ key, label: v.label, blocking: v.blocking })),
    readinessStatuses: READINESS_STATUSES,
    budgetCategories: Object.entries(BUDGET_CATEGORIES).map(([key, label]) => ({ key, label })),
    templates: Object.values(TEMPLATES).map((t) => ({ key: t.key, label: t.label })),
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

const APPLICANT_FIELDS = ["name", "applicantType", "ein", "uei", "state", "serviceArea", "mission", "focusAreas", "naicsCodes", "annualBudget", "maxCostSharePercent"] as const;

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
  if (body.template !== undefined && !isTemplateKey(body.template)) return fail(res, 400, "Unknown template");
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
  const templateKey: TemplateKey = (body.template as TemplateKey) ?? chooseTemplate(applicant.applicantType as ApplicantType, opp.title, opp.jurisdiction);
  const template = TEMPLATES[templateKey];
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

async function workspace(app: GrantApplication, applicant: GrantApplicant) {
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, app.opportunityId)).limit(1);
  const [requirements, sections, lines, approvals, readiness] = await Promise.all([
    db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, app.id)).orderBy(asc(grantRequirementsTable.position), asc(grantRequirementsTable.createdAt)),
    db.select().from(grantSectionsTable).where(eq(grantSectionsTable.applicationId, app.id)).orderBy(asc(grantSectionsTable.position)),
    db.select().from(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.applicationId, app.id)).orderBy(asc(grantBudgetLinesTable.position), asc(grantBudgetLinesTable.createdAt)),
    db.select().from(grantApprovalsTable).where(eq(grantApprovalsTable.applicationId, app.id)).orderBy(asc(grantApprovalsTable.createdAt)),
    db.select().from(grantReadinessItemsTable).where(eq(grantReadinessItemsTable.applicantId, applicant.id)),
  ]);
  const libraryFacts = await db.select().from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id)).orderBy(desc(grantFactsTable.updatedAt));
  const budget = summarizeBudget(lines, app.indirectRatePercent, opp.awardCeiling);
  const packageApproved = approvals.some((a) => a.scope === "package");
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
  });
  return {
    application: app,
    applicant: { ...applicantSummary(applicant), readiness: readinessView(applicant, readiness) },
    opportunity: opportunityView(opp),
    templateLabel: TEMPLATES[app.template as TemplateKey]?.label ?? app.template,
    requirements,
    sections: sections.map((s) => ({ ...s, limitCheck: checkLimit(s.content, s.limitType, s.limitValue) })),
    budgetLines: lines.map((l) => ({ ...l, total: lineTotal(l) })),
    budget,
    approvals,
    compliance,
    aiDemo: getActiveProvider().name === "demo",
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
  const body = pick(req.body, ["title", "requestedAmount", "indirectRatePercent", "noticeText"]);
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
  if (Object.keys(values).length) {
    await db.update(grantApplicationsTable).set(values).where(eq(grantApplicationsTable.id, owned.app.id));
    if (values.requestedAmount !== undefined || values.indirectRatePercent !== undefined) await invalidatePackage(owned.app.id);
  }
  const [app] = await db.select().from(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id)).limit(1);
  res.json(await workspace(app, owned.applicant));
});

router.delete("/grants/applications/:id", async (req, res): Promise<void> => {
  const owned = await ownedApplication(param(req, "id"), req.session.userId!, res);
  if (!owned) return;
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
  const [row] = await db.insert(grantRequirementsTable).values({ id: randomUUID(), applicationId: owned.app.id, origin: "manual", confirmed: true, position: Number(max) + 1, ...(values as any) }).returning();
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
  const [row] = await db.update(grantRequirementsTable).set(values).where(eq(grantRequirementsTable.id, owned.row.id)).returning();
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
  await db.update(grantRequirementsTable).set({ confirmed: true }).where(eq(grantRequirementsTable.applicationId, owned.app.id));
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
  const outcome = await extractRequirements(notice);
  if (outcome.value.length) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${grantRequirementsTable.position}), 0)` }).from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, owned.app.id));
    await db.insert(grantRequirementsTable).values(outcome.value.map((r, i) => ({
      id: randomUUID(),
      applicationId: owned.app.id,
      kind: r.kind,
      label: r.label,
      detail: r.detail,
      sourceRef: r.sourceRef,
      points: r.points,
      origin: "extracted",
      confirmed: false,
      position: Number(max) + 1 + i,
    })));
    await invalidatePackage(owned.app.id);
  }
  const [app] = await db.select().from(grantApplicationsTable).where(eq(grantApplicationsTable.id, owned.app.id)).limit(1);
  res.json({ added: outcome.value.length, demo: outcome.demo, message: outcome.message ?? null, workspace: await workspace(app, owned.applicant) });
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

async function draftContext(sectionId: string, app: GrantApplication, applicant: GrantApplicant): Promise<DraftContext> {
  const [section] = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.id, sectionId)).limit(1);
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, app.opportunityId)).limit(1);
  const reqs = await db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, app.id));
  const relevant = reqs.filter((r) => r.sectionKey === section.key || (r.kind === "criterion" && !r.sectionKey));
  const library = await db.select().from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id));
  // Up to two saved texts for the same section, newest first, as plain text (about 6,000 characters in all).
  const savedWriting = (await db.select().from(grantSnippetsTable).where(and(eq(grantSnippetsTable.applicantId, applicant.id), eq(grantSnippetsTable.sectionKey, section.key))).orderBy(desc(grantSnippetsTable.updatedAt)).limit(2))
    .map((w) => ({ title: w.title, text: htmlToText(w.content).slice(0, 3000) }));
  const facts = [
    applicant.annualBudget ? `Annual budget: $${applicant.annualBudget.toLocaleString("en-US")}` : null,
    applicant.ein ? `EIN on file: ${applicant.ein}` : null,
    app.requestedAmount ? `Amount requested: $${app.requestedAmount.toLocaleString("en-US")}` : null,
    ...factsForSection(library, section.key).map(factLine),
  ].filter((f): f is string => Boolean(f));
  return {
    applicant: {
      name: applicant.name,
      applicantTypeLabel: APPLICANT_TYPES[applicant.applicantType as ApplicantType]?.label ?? applicant.applicantType,
      mission: applicant.mission,
      serviceArea: applicant.serviceArea,
      state: applicant.state,
      focusAreas: applicant.focusAreas,
    },
    opportunity: { title: opp.title, agency: opp.agency, description: opp.description },
    section: { title: section.title, guidance: section.guidance, limitType: section.limitType, limitValue: section.limitValue, content: section.content },
    requirements: relevant.map((r) => ({ label: r.label, detail: r.detail, points: r.points })),
    facts,
    savedWriting,
  };
}

router.post("/grants/sections/:sid/draft", aiLimiter, async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const ctx = await draftContext(owned.row.id, owned.app, owned.applicant);
  const outcome = await draftSection(ctx);
  const [row] = await db
    .update(grantSectionsTable)
    .set({ content: outcome.value, demoContent: outcome.demo, status: "drafting", approvedBy: null, approvedAt: null, reviewScore: null, reviewNotes: [] })
    .where(eq(grantSectionsTable.id, owned.row.id))
    .returning();
  await invalidatePackage(owned.app.id);
  res.json({ section: { ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) }, demo: outcome.demo, provider: outcome.provider, message: outcome.message ?? null });
});

router.post("/grants/sections/:sid/review", aiLimiter, async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const ctx = await draftContext(owned.row.id, owned.app, owned.applicant);
  const outcome = await reviewSection(ctx);
  const [row] = await db
    .update(grantSectionsTable)
    .set({ reviewScore: outcome.value.score, reviewNotes: outcome.value.notes })
    .where(eq(grantSectionsTable.id, owned.row.id))
    .returning();
  res.json({ section: { ...row, limitCheck: checkLimit(row.content, row.limitType, row.limitValue) }, demo: outcome.demo, message: outcome.message ?? null });
});

router.post("/grants/sections/:sid/approve", async (req, res): Promise<void> => {
  const owned = await ownedChild(grantSectionsTable, param(req, "sid"), req.session.userId!, res);
  if (!owned) return;
  const limit = checkLimit(owned.row.content, owned.row.limitType, owned.row.limitValue);
  if (!limit.words) return fail(res, 409, "Write the section before approving it.");
  if (owned.row.demoContent) return fail(res, 409, "Replace the demo scaffold with your own writing before approving.");
  if (limit.over) return fail(res, 409, `The section is over its limit (${limit.used} of ${limit.limit} ${limit.unit}).`);
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
    generatedAt: new Date(),
  });
  if (!draft) {
    await db.update(grantApplicationsTable).set({ status: "exported", exportedAt: new Date() }).where(eq(grantApplicationsTable.id, owned.app.id));
    await logActivity("grant_package_exported", `Package exported: ${owned.app.title}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  }
  const name = `${owned.applicant.name}-${ws.opportunity.number ?? "application"}${draft ? "-DRAFT" : ""}`.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 120);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.docx"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
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
    Object.assign(values, { submittedOn: day, submittedAmount: ws.budget.requested || owned.app.requestedAmount || null, trackingNumber: tracking ?? owned.app.trackingNumber ?? null, awardedAmount: null });
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
    ? { outcome: null, outcomeDate: null, submittedOn: null, submittedAmount: null, trackingNumber: null, awardedAmount: null, outcomeNote: null, outcomeRecordedBy: null }
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
  res.json(summarizePipeline(rows.map(({ app, opp }) => ({
    status: app.status,
    outcome: app.outcome,
    requested: app.submittedAmount,
    awardedAmount: app.awardedAmount,
    daysLeft: daysUntil(opp.closeDate),
  }))));
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
