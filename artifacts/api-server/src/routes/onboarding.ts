import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { randomUUID } from "crypto";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { db, grantApplicantsTable, grantApplicationsTable, grantFactsTable, invitesTable, membershipsTable, workspacesTable } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { checkNewOrganization, limitResponse } from "../lib/billing/service";
import { APPLICANT_TYPES, isApplicantType } from "../lib/grants/eligibility";
import { focusCatalog, suggestedFocusAreas } from "../lib/onboarding/focusAreas";
import { cachedRecord, lookupOrganization } from "../lib/onboarding/lookup";
import { PROPUBLICA_SOURCE, formatEin, fullAddress, normalizeEin, revenueBand, type NonprofitRecord } from "../lib/onboarding/propublica";
import { upgradeLegacySession } from "../lib/workspaces";

/**
 * Onboarding (docs/SELF_SIGNUP.md §4): the getting-started checklist and the
 * setup wizard, from EIN to first match. Mounted behind requireAuth and
 * requirePermission; every read and write is scoped to the signed-in
 * workspace (its principal, `session.userId`).
 *
 * The wizard's last step reuses Grant Studio's own matching
 * (GET /grants/applicants/:id/matches) and foundation suggestions
 * (GET /grants/applicants/:id/foundation-suggestions). Matches are guidance,
 * never an eligibility decision.
 */
const router: IRouter = Router();

router.use("/onboarding", (req, _res, next) => {
  upgradeLegacySession(req.session).then(() => next(), next);
});

/** EIN lookups: 30 per 10 minutes per workspace, so the wizard cannot be used to scrape ProPublica. */
const lookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId ?? ipKeyGenerator(req.ip ?? "unknown"),
  message: { error: "Too many lookups. Wait a few minutes, or enter the details yourself." },
});

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

async function currentWorkspace(req: Request) {
  if (!req.session.workspaceId) return null;
  const [w] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, req.session.workspaceId)).limit(1);
  return w ?? null;
}

/** GET /onboarding: the getting-started checklist for this workspace. */
router.get("/onboarding", async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const workspace = await currentWorkspace(req);
  const orgs = await db.select({ id: grantApplicantsTable.id, name: grantApplicantsTable.name, seen: grantApplicantsTable.matchesSeenAt }).from(grantApplicantsTable).where(eq(grantApplicantsTable.userId, userId)).orderBy(asc(grantApplicantsTable.createdAt));
  const [apps] = await db.select({ n: count() }).from(grantApplicationsTable).innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id)).where(eq(grantApplicantsTable.userId, userId));
  let people = 0;
  if (workspace) {
    const [m] = await db.select({ n: count() }).from(membershipsTable).where(eq(membershipsTable.workspaceId, workspace.id));
    const [i] = await db.select({ n: count() }).from(invitesTable).where(and(eq(invitesTable.workspaceId, workspace.id), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt), gt(invitesTable.expiresAt, new Date())));
    people = Number(m.n) + Number(i.n);
  }
  const first = orgs[0] ?? null;
  const orgHref = first ? `/grant-studio/organizations/${first.id}` : "/onboarding";
  const steps = [
    { key: "organization", title: "Set up your organization", description: "Enter your EIN and confirm what the IRS records say, or enter your details yourself.", done: orgs.length > 0, href: "/onboarding" },
    { key: "matches", title: "Review your first matches", description: "Federal and state opportunities and foundations that fit your profile. Matches are guidance, not an eligibility decision.", done: orgs.some((o) => o.seen !== null), href: orgHref },
    { key: "application", title: "Start your first application", description: "Open a match and choose Start application. Grant Studio sets up the sections, budget and checklist.", done: Number(apps.n) > 0, href: orgHref },
    { key: "team", title: "Invite your team", description: "Add a writer, reviewer or finance lead. Each person gets their own sign-in and role.", done: people > 1, href: "/settings" },
  ];
  res.json({
    workspace: workspace ? { name: workspace.name, createdVia: workspace.createdVia } : null,
    dismissed: workspace?.onboardingDismissedAt != null,
    complete: steps.every((s) => s.done),
    steps,
    organizations: orgs.map((o) => ({ id: o.id, name: o.name })),
    applicantTypes: Object.entries(APPLICANT_TYPES).map(([key, v]) => ({ key, label: v.label, kind: v.kind })),
    focusAreas: focusCatalog(),
    lookup: { available: process.env.NONPROFIT_LOOKUP_DISABLED !== "true", source: PROPUBLICA_SOURCE },
  });
});

/** PUT /onboarding/dismissed { dismissed }: hide or show the checklist. The wizard stays at /onboarding. */
router.put("/onboarding/dismissed", async (req, res): Promise<void> => {
  if (typeof req.body?.dismissed !== "boolean") return fail(res, 400, "dismissed must be true or false");
  if (!req.session.workspaceId) return fail(res, 400, "No workspace is selected.");
  await db.update(workspacesTable).set({ onboardingDismissedAt: req.body.dismissed ? new Date() : null }).where(eq(workspacesTable.id, req.session.workspaceId));
  res.json({ dismissed: req.body.dismissed });
});

function prefillOf(record: NonprofitRecord) {
  return {
    name: record.name,
    principalAddress: fullAddress(record),
    state: record.state,
    ntee: record.nteeCode ? `${record.nteeCode}${record.nteeLabel ? ` (${record.nteeLabel})` : ""}` : null,
    revenue: record.revenue,
    revenueBand: revenueBand(record.revenue),
    revenueYear: record.revenueYear,
    applicantType: record.subsectionCode === 3 ? "nonprofit_501c3" : "nonprofit_other",
    subsection: record.subsectionCode !== null ? `501(c)(${record.subsectionCode})` : null,
  };
}

/**
 * GET /onboarding/lookup/:ein: the organization the IRS records list under an EIN.
 * Always 200 with `status`: "found", "not_found" or "unavailable" (ProPublica could
 * not be reached), so the wizard can offer manual entry in every case.
 */
router.get("/onboarding/lookup/:ein", lookupLimiter, async (req, res): Promise<void> => {
  const ein = normalizeEin(String(req.params.ein));
  if (!ein) return fail(res, 400, "Enter the 9-digit EIN, for example 12-3456789.");
  const outcome = await lookupOrganization(ein);
  if (outcome.kind === "not_found") {
    res.json({ status: "not_found", ein, einFormatted: formatEin(ein), message: `No organization with EIN ${formatEin(ein)} is in ProPublica's copy of the IRS records. New nonprofits can take a few months to appear. Check the number, or enter your details yourself.`, source: PROPUBLICA_SOURCE });
    return;
  }
  if (outcome.kind === "unavailable") {
    res.json({ status: "unavailable", ein, einFormatted: formatEin(ein), message: `${outcome.reason} Try again in a minute, or enter your details yourself.`, source: PROPUBLICA_SOURCE });
    return;
  }
  const { record } = outcome;
  res.json({
    status: "found",
    ein,
    einFormatted: formatEin(ein),
    cached: outcome.cached,
    fetchedAt: outcome.fetchedAt,
    organization: record,
    prefill: prefillOf(record),
    suggestedFocusAreas: suggestedFocusAreas(record.nteeGroup),
    source: PROPUBLICA_SOURCE,
  });
});

const CONFIRMABLE = ["name", "address", "state", "ntee", "revenue", "subsection"] as const;
type Confirmable = (typeof CONFIRMABLE)[number];

function text(value: unknown, max: number): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const t = value.trim().slice(0, max);
  return t || null;
}

/**
 * POST /onboarding/organization: creates the Grant Studio organization from the wizard.
 * { applicantType, name, ein?, state?, principalAddress?, annualBudget?, mission?, focusAreas?, confirmations? }
 *
 * When an EIN was looked up, each value the IRS records gave is also saved as a
 * fact with its source. A fact is confirmed only when the person ticked it and
 * kept the value; a value they did not confirm is never written into the profile.
 */
router.post("/onboarding/organization", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!isApplicantType(body.applicantType)) return fail(res, 400, `applicantType must be one of: ${Object.keys(APPLICANT_TYPES).join(", ")}`);
  const name = text(body.name, 200);
  const state = text(body.state, 20);
  const principalAddress = text(body.principalAddress, 300);
  const mission = text(body.mission, 4000);
  if (name === false || state === false || principalAddress === false || mission === false) return fail(res, 400, "name, state, principalAddress and mission must be text");
  if (state && !/^[A-Za-z]{2}$/.test(state)) return fail(res, 400, "state must be the two-letter state code, for example NC");
  let ein: string | null = null;
  if (body.ein !== undefined && body.ein !== null && body.ein !== "") {
    ein = normalizeEin(body.ein);
    if (!ein) return fail(res, 400, "ein must look like 12-3456789");
  }
  let annualBudget: number | null = null;
  if (body.annualBudget !== undefined && body.annualBudget !== null && body.annualBudget !== "") {
    const n = Number(body.annualBudget);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) return fail(res, 400, "annualBudget must be a positive number");
    annualBudget = Math.round(n);
  }
  const focusAreas: string[] = [];
  if (body.focusAreas !== undefined) {
    if (!Array.isArray(body.focusAreas) || body.focusAreas.some((a: unknown) => typeof a !== "string")) return fail(res, 400, "focusAreas must be a list of text");
    for (const a of body.focusAreas as string[]) {
      const t = a.trim().slice(0, 80);
      if (t && !focusAreas.some((f) => f.toLowerCase() === t.toLowerCase())) focusAreas.push(t);
    }
    if (focusAreas.length > 25) return fail(res, 400, "Choose at most 25 focus areas.");
  }
  const confirmations: Partial<Record<Confirmable, boolean>> = {};
  if (body.confirmations && typeof body.confirmations === "object") for (const k of CONFIRMABLE) if (body.confirmations[k] === true) confirmations[k] = true;

  // What the IRS records said, if this EIN was looked up (from the cache, not from the request).
  const looked = ein ? await cachedRecord(ein) : null;
  const prefill = looked ? prefillOf(looked.record) : null;
  const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  /** A value that came from the records but was not confirmed is not used. A value the person typed is theirs. */
  const usable = (field: Confirmable, value: unknown, recorded: unknown) => !prefill || recorded === null || recorded === undefined || !same(value, recorded) || confirmations[field] === true;

  if (!name) return fail(res, 400, "Enter the organization's legal name.");
  if (!usable("name", name, prefill?.name)) return fail(res, 400, "Confirm the organization's name, or correct it.");
  const profile = {
    name,
    state: state && usable("state", state, prefill?.state) ? state.toUpperCase() : null,
    principalAddress: principalAddress && usable("address", principalAddress, prefill?.principalAddress) ? principalAddress : null,
    annualBudget: annualBudget !== null && usable("revenue", annualBudget, prefill?.revenue) ? annualBudget : null,
  };

  const allowed = await checkNewOrganization(req.session);
  if (!allowed.allowed) {
    res.status(402).json(limitResponse(allowed));
    return;
  }

  const actor = req.session.actorName ?? "operator";
  const [applicant] = await db
    .insert(grantApplicantsTable)
    .values({ id: randomUUID(), userId: req.session.userId!, name: profile.name, applicantType: body.applicantType, ein: ein ? formatEin(ein) : null, state: profile.state, principalAddress: profile.principalAddress, annualBudget: profile.annualBudget, mission, focusAreas })
    .returning();

  let confirmedFacts = 0;
  let unconfirmedFacts = 0;
  if (looked && prefill) {
    const retrieved = looked.fetchedAt.toISOString().slice(0, 10);
    const source = `${PROPUBLICA_SOURCE.name} (IRS filings), EIN ${formatEin(ein!)}, retrieved ${retrieved}: ${looked.record.profileUrl}`;
    const facts: { field: Confirmable; category: string; label: string; body: string; kept: unknown; recorded: unknown }[] = [];
    const push = (field: Confirmable, category: string, label: string, value: string | null, kept: unknown, recorded: unknown) => {
      if (value) facts.push({ field, category, label, body: value, kept, recorded });
    };
    push("name", "history", "Legal name on IRS records", prefill.name, name, prefill.name);
    push("address", "other", "Address on IRS records", prefill.principalAddress, principalAddress, prefill.principalAddress);
    push("state", "other", "State on IRS records", prefill.state, state, prefill.state);
    push("subsection", "history", "IRS tax-exempt subsection", prefill.subsection, prefill.subsection, prefill.subsection);
    push("ntee", "programs", "NTEE classification", prefill.ntee, prefill.ntee, prefill.ntee);
    push(
      "revenue",
      "finances",
      `Total revenue${prefill.revenueYear ? ` (tax year ${prefill.revenueYear})` : ""}`,
      prefill.revenue !== null ? `$${prefill.revenue.toLocaleString("en-US")} (${prefill.revenueBand})` : null,
      annualBudget,
      prefill.revenue,
    );
    const now = new Date();
    const rows = facts.map((f) => {
      // Confirmed only when ticked and the value was kept as the records state it.
      const confirmed = confirmations[f.field] === true && same(f.kept, f.recorded);
      if (confirmed) confirmedFacts += 1;
      else unconfirmedFacts += 1;
      return { id: randomUUID(), applicantId: applicant.id, category: f.category, label: f.label, body: f.body, source, asOf: retrieved, ...(confirmed ? { confirmedBy: actor, confirmedAt: now } : {}) };
    });
    if (rows.length) await db.insert(grantFactsTable).values(rows);
  }
  await logActivity("grant_applicant_created", `Organization "${applicant.name}" added to Grant Studio with the setup wizard${looked ? ` (EIN ${formatEin(ein!)} looked up; ${confirmedFacts} of ${confirmedFacts + unconfirmedFacts} facts confirmed)` : " (entered by hand)"}`, { userId: req.session.userId, actorName: req.session.actorName }).catch(() => {});
  res.status(201).json({
    applicant: { id: applicant.id, name: applicant.name, applicantType: applicant.applicantType, ein: applicant.ein, state: applicant.state, principalAddress: applicant.principalAddress, annualBudget: applicant.annualBudget, focusAreas: applicant.focusAreas },
    facts: { confirmed: confirmedFacts, unconfirmed: unconfirmedFacts },
    lookedUp: Boolean(looked),
  });
});

export default router;
