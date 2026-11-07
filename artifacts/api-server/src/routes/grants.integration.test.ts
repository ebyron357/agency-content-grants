/**
 * Grant Studio end to end against the real test database (reset and migrated
 * by globalSetup): a nonprofit and a business each go from profile to match to
 * application to exported package, and a second operator can reach none of it.
 *
 * No network: opportunities are seeded with a fresh detail record (so no
 * detail refresh is attempted) and the sync test injects a fake Grants.gov.
 * No AI key is configured, so the demo provider runs and must be labelled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, grantApplicantsTable, grantApplicationsTable, grantOpportunitiesTable, grantSyncRunsTable, usersTable, webhookEventsTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import grantsRouter from "./grants";
import { syncCalifornia, syncGrantsGov } from "../lib/grants/ingest";
import type { CaFetchLike } from "../lib/grants/california";
import { alertSummaryStats, emitDeadlineReminders, emitMatchAlerts, resetAlertSummaryCache } from "../lib/grants/alerts";
import type { FetchLike } from "../lib/grants/grantsgov";

const OWNER = `grant-owner-${randomUUID()}`;
const OTHER = `grant-other-${randomUUID()}`;
const NONPROFIT_OPP = randomUUID();
const BUSINESS_OPP = randomUUID();
const CLOSED_OPP = randomUUID();
const FRESH_OPP = randomUUID();
const DUE_OPP = randomUUID();

let server: Server;
let base = "";

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "grant-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.post("/test/login-as", (req, res) => {
    req.session.userId = (req.body as any).userId;
    req.session.authenticated = true;
    res.json({ ok: true });
  });
  app.use("/api", requireAuth, grantsRouter);
  return app;
}

async function login(userId: string): Promise<string> {
  const res = await fetch(`${base}/test/login-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
  return res.headers.get("set-cookie")!.split(";")[0];
}

function client(cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as any, headers: res.headers };
  };
}

function opportunity(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    source: "grants_gov",
    sourceRef: `test-${id}`,
    title: "Test opportunity",
    agency: "Test Agency",
    status: "posted",
    closeDate: inDays(60),
    officialUrl: `https://www.grants.gov/search-results-detail/${id}`,
    fetchedAt: new Date(),
    detailFetchedAt: new Date(),
    checksum: "seed",
    connectorVersion: "test",
    publishable: true,
    gateMissing: [],
    eligibilityCodes: ["12"],
    categories: [],
    assistanceListings: [],
    costSharing: false,
    ...overrides,
  };
}

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: OWNER, username: `owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  await db.insert(grantOpportunitiesTable).values([
    opportunity(NONPROFIT_OPP, { title: "Community Literacy for Youth", number: "TEST-LIT-2026-01", assistanceListings: ["84.000"], description: "Supports youth literacy programs in rural communities.", eligibilityCodes: ["12", "13"], awardCeiling: 150000, awardFloor: 25000 }),
    opportunity(BUSINESS_OPP, { title: "Small Business Water Quality Innovation", description: "Supports water quality technology from small businesses.", eligibilityCodes: ["23"], awardCeiling: 100000 }),
    opportunity(CLOSED_OPP, { title: "Closed literacy grant", eligibilityCodes: ["12"], status: "closed", publishable: false, gateMissing: ["open status (posted or forecasted)"] }),
  ]);
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [NONPROFIT_OPP, BUSINESS_OPP, CLOSED_OPP, FRESH_OPP, DUE_OPP]));
  await db.delete(webhookEventsTable).where(inArray(webhookEventsTable.userId, [OWNER, OTHER]));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

describe("Grant Studio end to end", () => {
  it("rejects requests without a session", async () => {
    const res = await fetch(`${base}/api/grants/applicants`);
    expect(res.status).toBe(401);
  });

  it("takes a nonprofit from profile to exported package, and keeps it private", async () => {
    const api = client(await login(OWNER));

    // Profile, with validation.
    expect((await api("POST", "/grants/applicants", { name: "Bad", applicantType: "charity" })).status).toBe(400);
    expect((await api("POST", "/grants/applicants", { name: "Bad", applicantType: "nonprofit_501c3", ein: "12" })).status).toBe(400);
    expect((await api("POST", "/grants/applicants", { name: "X", applicantType: "nonprofit_501c3", userId: OTHER })).status).toBe(400);
    const created = await api("POST", "/grants/applicants", {
      name: "Readers Rising",
      applicantType: "nonprofit_501c3",
      ein: "12-3456789",
      uei: "abcd1234efgh",
      state: "NC",
      mission: "Youth literacy in rural North Carolina",
      focusAreas: ["literacy", "youth"],
      annualBudget: 300000,
    });
    expect(created.status).toBe(201);
    expect(created.data.uei).toBe("ABCD1234EFGH");
    expect(created.data.readiness.blockingOpen).toBe(3);
    const applicantId = created.data.id;

    // Readiness.
    for (const kind of ["sam_registration", "grants_gov_aor", "irs_determination"]) {
      const res = await api("PUT", `/grants/applicants/${applicantId}/readiness/${kind}`, { status: "ready", expiresOn: kind === "sam_registration" ? inDays(400) : null });
      expect(res.status).toBe(200);
    }
    expect((await api("PUT", `/grants/applicants/${applicantId}/readiness/capability_statement`, { status: "ready" })).status).toBe(400);

    // Matches: the nonprofit opportunity, not the business-only or closed one.
    const matches = await api("GET", `/grants/applicants/${applicantId}/matches`);
    expect(matches.status).toBe(200);
    const ids = matches.data.matches.map((m: any) => m.opportunity.id);
    expect(ids).toContain(NONPROFIT_OPP);
    expect(ids).not.toContain(BUSINESS_OPP);
    expect(ids).not.toContain(CLOSED_OPP);
    const match = matches.data.matches.find((m: any) => m.opportunity.id === NONPROFIT_OPP).match;
    expect(match.matchedTopics).toEqual(["literacy", "youth"]);
    expect(match.gaps).toEqual([]);
    expect(match.relevant).toBe(true);
    expect(matches.data.relevantTotal).toBeGreaterThanOrEqual(1);
    const onTopic = await api("GET", `/grants/applicants/${applicantId}/matches?relevantOnly=1`);
    expect(onTopic.data.relevantOnly).toBe(true);
    expect(onTopic.data.matches.every((m: any) => m.match.relevant)).toBe(true);
    expect(onTopic.data.matches.map((m: any) => m.opportunity.id)).toContain(NONPROFIT_OPP);

    // Opportunity detail with this applicant's match.
    const detail = await api("GET", `/grants/opportunities/${NONPROFIT_OPP}?applicantId=${applicantId}`);
    expect(detail.data.match.eligible).toBe(true);
    expect(detail.data.existingApplicationId).toBeNull();

    // Starting requires confirmed eligibility and an open opportunity.
    expect((await api("POST", "/grants/applications", { applicantId, opportunityId: NONPROFIT_OPP })).status).toBe(400);
    expect((await api("POST", "/grants/applications", { applicantId, opportunityId: CLOSED_OPP, eligibilityConfirmed: true })).status).toBe(409);
    const started = await api("POST", "/grants/applications", { applicantId, opportunityId: NONPROFIT_OPP, eligibilityConfirmed: true, eligibilityNote: "501(c)(3), rural NC" });
    expect(started.status).toBe(201);
    const appId = started.data.id;
    expect((await api("POST", "/grants/applications", { applicantId, opportunityId: NONPROFIT_OPP, eligibilityConfirmed: true })).data).toEqual({ id: appId, existing: true });

    let ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.application.template).toBe("federal_nonprofit");
    expect(ws.sections.map((s: any) => s.key)).toContain("need");
    expect(ws.requirements.length).toBeGreaterThan(10);
    expect(ws.compliance.readyForApproval).toBe(false);
    expect(ws.aiDemo).toBe(true);

    // Extraction without an AI provider adds nothing and says so.
    const extract = await api("POST", `/grants/applications/${appId}/requirements/extract`, { noticeText: "Applicants must submit a project narrative. ".repeat(10) });
    expect(extract.status).toBe(200);
    expect(extract.data).toMatchObject({ added: 0, demo: true });

    // A manual requirement; then confirm the matrix.
    const added = await api("POST", `/grants/applications/${appId}/requirements`, { kind: "criterion", label: "Need for the project", points: 25, sourceRef: "Section V.1", sectionKey: "need" });
    expect(added.status).toBe(201);
    ws = (await api("POST", `/grants/applications/${appId}/requirements/confirm-all`)).data;
    expect(ws.requirements.every((r: any) => r.confirmed)).toBe(true);

    // Drafting with the demo provider gives a labelled scaffold that cannot be approved.
    const need = ws.sections.find((s: any) => s.key === "need");
    const drafted = await api("POST", `/grants/sections/${need.id}/draft`);
    expect(drafted.data.demo).toBe(true);
    expect(drafted.data.section.demoContent).toBe(true);
    expect(drafted.data.section.content).toMatch(/Demo scaffold/);
    expect((await api("POST", `/grants/sections/${need.id}/approve`)).status).toBe(409);

    // Over-limit text cannot be approved; content is sanitized.
    await api("PATCH", `/grants/sections/${need.id}`, { limitType: "words", limitValue: 5 });
    const long = await api("PATCH", `/grants/sections/${need.id}`, { content: '<p onclick="x()">one two three four five six seven</p><script>alert(1)</script>' });
    expect(long.data.content).not.toMatch(/script|onclick/);
    expect(long.data.limitCheck.over).toBe(true);
    expect((await api("POST", `/grants/sections/${need.id}/approve`)).status).toBe(409);

    // Review always runs the rule checks.
    const review = await api("POST", `/grants/sections/${need.id}/review`);
    expect(review.data.section.reviewNotes.join(" ")).toMatch(/Over the limit/);

    // Write and approve every section.
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    for (const section of ws.sections) {
      await api("PATCH", `/grants/sections/${section.id}`, { limitType: null, limitValue: null, content: `<p>${section.title} written by the applicant.</p>` });
      expect((await api("POST", `/grants/sections/${section.id}/approve`)).status).toBe(200);
    }

    // Budget, with the ceiling enforced.
    expect((await api("POST", `/grants/applications/${appId}/budget-lines`, { category: "snacks", description: "x" })).status).toBe(400);
    const big = await api("POST", `/grants/applications/${appId}/budget-lines`, { category: "personnel", description: "Program director", quantity: 1, unitCost: 200000, justification: "Leads the program" });
    expect(big.status).toBe(201);
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.budget.issues.join(" ")).toMatch(/above the award ceiling/);
    await api("PATCH", `/grants/budget-lines/${big.data.id}`, { unitCost: 90000 });
    await api("POST", `/grants/applications/${appId}/budget-lines`, { category: "supplies", description: "Books", quantity: 300, unitCost: 20, matchPercent: 50, justification: "Books for participants" });
    await api("PATCH", `/grants/applications/${appId}`, { indirectRatePercent: 10 });

    // The budget justification is generated from the lines and must be re-approved.
    const justification = await api("POST", `/grants/applications/${appId}/budget-justification`);
    expect(justification.data.content).toMatch(/Program director/);
    // It leaves the indirect-rate basis for the applicant to state; an unfilled placeholder blocks the package.
    expect(justification.data.content).toMatch(/\[Add: the basis for the rate/);
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.compliance.checks.find((c: any) => c.id === "no_placeholders")).toMatchObject({ ok: false, detail: expect.stringContaining("Budget justification") });
    const filled = justification.data.content.replace(/\[Add: the basis for the rate[^\]]*\]/, "The rate is the 10% de minimis rate the notice allows.");
    await api("PATCH", `/grants/sections/${justification.data.id}`, { content: filled });
    expect((await api("POST", `/grants/sections/${justification.data.id}/approve`)).status).toBe(200);

    // Every matrix row covered.
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    for (const req of ws.requirements) await api("PATCH", `/grants/requirements/${req.id}`, { status: "covered" });

    // The federal forms: the rest of the SF-424 and SF-424A by a person, SF-424B copied from the SF-424,
    // SF-LLL not applicable with a reason; each reviewed (the full flow is in grant-forms-claims.integration.test.ts).
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.compliance.checks.find((c: any) => c.id === "federal_forms").ok).toBe(false);
    const sf424 = await api("PUT", `/grants/applications/${appId}/forms/sf424`, {
      values: {
        submission_type: "Application",
        application_type: "New",
        "applicant.street1": "1 Library Lane",
        "applicant.city": "Wilson",
        "applicant.zip_code": "278930001",
        "contact_person.first_name": "Ana",
        "contact_person.last_name": "Diaz",
        phone_number: "252-555-0100",
        email: "ana@example.org",
        congressional_district_applicant: "NC-001",
        congressional_district_program_project: "NC-001",
        project_start_date: "2027-07-01",
        project_end_date: "2028-06-30",
        state_estimated_funding: "0.00",
        local_estimated_funding: "0.00",
        other_estimated_funding: "0.00",
        program_income_estimated_funding: "0.00",
        state_review: "c. Program is not covered by E.O. 12372.",
        delinquent_federal_debt: false,
        certification_agree: true,
        "authorized_representative.first_name": "Sam",
        "authorized_representative.last_name": "Lee",
        authorized_representative_title: "Executive Director",
        authorized_representative_phone_number: "252-555-0101",
        authorized_representative_email: "sam@example.org",
      },
    });
    expect(sf424.data.forms.find((f: any) => f.key === "sf424").errorCount).toBe(0);
    await api("PUT", `/grants/applications/${appId}/forms/sf424a`, { values: { "activity_line_items.0.activity_title": "Readers Rising tutoring", confirmation: true } });
    await api("POST", `/grants/applications/${appId}/forms/sflll/applicability`, { notApplicable: true, reason: "No one is paid to lobby for this award." });
    for (const form of ["sf424", "sf424a", "sf424b"]) expect((await api("POST", `/grants/applications/${appId}/forms/${form}/review`)).status).toBe(200);

    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.budget.requested).toBe(102300);
    expect(ws.compliance.checks.filter((c: any) => !c.ok).map((c: any) => c.id)).toEqual(["package_approval"]);
    expect(ws.compliance.readyForApproval).toBe(true);

    // Final export needs the authorized representative; draft export is always available.
    expect((await api("GET", `/grants/applications/${appId}/package.docx`)).status).toBe(409);
    const draft = await api("GET", `/grants/applications/${appId}/package.docx?draft=1`);
    expect(draft.status).toBe(200);
    expect(draft.headers.get("content-disposition")).toMatch(/DRAFT\.docx/);
    expect((draft.data as Buffer).subarray(0, 2).toString()).toBe("PK");
    expect((await api("POST", `/grants/applications/${appId}/approve-package`, {})).status).toBe(400);
    ws = (await api("POST", `/grants/applications/${appId}/approve-package`, { confirmAuthorized: true })).data;
    expect(ws.compliance.readyToExport).toBe(true);
    const final = await api("GET", `/grants/applications/${appId}/package.docx`);
    expect(final.status).toBe(200);
    expect((await api("GET", `/grants/applications/${appId}`)).data.application.status).toBe("exported");

    // Any edit after approval reopens the package.
    await api("PATCH", `/grants/applications/${appId}`, { requestedAmount: 100000 });
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.compliance.readyToExport).toBe(false);
    expect(ws.application.status).toBe("draft");

    // Another operator can reach none of it, and cannot tell it exists.
    const other = client(await login(OTHER));
    expect((await other("GET", "/grants/applicants")).data).toEqual([]);
    expect((await other("GET", `/grants/applicants/${applicantId}`)).status).toBe(404);
    expect((await other("GET", `/grants/applicants/${applicantId}/matches`)).status).toBe(404);
    expect((await other("GET", `/grants/applications/${appId}`)).status).toBe(404);
    expect((await other("GET", `/grants/applications/${appId}/package.docx?draft=1`)).status).toBe(404);
    expect((await other("PATCH", `/grants/sections/${need.id}`, { content: "<p>hijack</p>" })).status).toBe(404);
    expect((await other("PATCH", `/grants/budget-lines/${big.data.id}`, { unitCost: 1 })).status).toBe(404);
    expect((await other("PATCH", `/grants/requirements/${added.data.id}`, { status: "open" })).status).toBe(404);
    expect((await other("POST", "/grants/applications", { applicantId, opportunityId: NONPROFIT_OPP, eligibilityConfirmed: true })).status).toBe(404);
    expect((await other("GET", "/grants/applications")).data).toEqual([]);
    // Opportunities are public reference data, but another operator's match is not computed.
    const otherDetail = await other("GET", `/grants/opportunities/${NONPROFIT_OPP}?applicantId=${applicantId}`);
    expect(otherDetail.status).toBe(200);
    expect(otherDetail.data.match).toBeNull();
  }, 60_000);

  it("matches a small business to business opportunities, with an SBIR-aware template choice", async () => {
    const api = client(await login(OWNER));
    const created = await api("POST", "/grants/applicants", { name: "Clearwater Sensors LLC", applicantType: "small_business", focusAreas: ["water quality"], annualBudget: 800000 });
    expect(created.status).toBe(201);
    const matches = await api("GET", `/grants/applicants/${created.data.id}/matches`);
    const ids = matches.data.matches.map((m: any) => m.opportunity.id);
    expect(ids).toContain(BUSINESS_OPP);
    expect(ids).not.toContain(NONPROFIT_OPP);
    const started = await api("POST", "/grants/applications", { applicantId: created.data.id, opportunityId: BUSINESS_OPP, eligibilityConfirmed: true });
    const ws = (await api("GET", `/grants/applications/${started.data.id}`)).data;
    expect(ws.application.template).toBe("federal_business");
    expect(ws.applicant.readiness.items.map((i: any) => i.kind)).toContain("capability_statement");
    expect(ws.applicant.readiness.items.map((i: any) => i.kind)).not.toContain("irs_determination");
  }, 30_000);

  it("flags opportunities stored after an organization was added, alerts once, and clears on mark-as-seen", async () => {
    const api = client(await login(OWNER));
    const created = await api("POST", "/grants/applicants", { name: "Harbor Seed Library", applicantType: "nonprofit_501c3", focusAreas: ["seed library"], annualBudget: 120000 });
    const id = created.data.id;
    const before = await api("GET", `/grants/applicants/${id}/matches?relevantOnly=1`);
    expect(before.data.newTotal).toBe(0);

    await db.insert(grantOpportunitiesTable).values(opportunity(FRESH_OPP, { title: "Community Seed Library Grants", description: "Supports seed library programs.", closeDate: inDays(10), awardCeiling: 50000 }));
    const after = await api("GET", `/grants/applicants/${id}/matches?relevantOnly=1`);
    expect(after.data.newTotal).toBe(1);
    expect(after.data.closingSoonTotal).toBe(1);
    expect(after.data.broadTopics).toEqual([]);
    const fresh = after.data.matches.find((m: any) => m.opportunity.id === FRESH_OPP);
    expect(fresh.isNew).toBe(true);
    // Test files share one database and run in parallel, so another file may store an opportunity
    // after this organization was added; judge only this file's own opportunities.
    const ownIds = new Set([NONPROFIT_OPP, BUSINESS_OPP, CLOSED_OPP, FRESH_OPP]);
    const newOnly = (await api("GET", `/grants/applicants/${id}/matches?newOnly=1`)).data.matches.map((m: any) => m.opportunity.id);
    expect(newOnly.filter((oppId: string) => ownIds.has(oppId))).toEqual([FRESH_OPP]);
    const listed = (await api("GET", "/grants/applicants")).data.find((a: any) => a.id === id);
    expect(listed.alerts).toEqual({ newMatches: 1, closingSoon: 1 });

    // One webhook event for the new match, carrying public facts and paths only, then none on the next run.
    await emitMatchAlerts();
    const events = (await db.select().from(webhookEventsTable).where(eq(webhookEventsTable.userId, OWNER))).filter((e) => e.type === "grant.new_matches" && (e.payload as any).applicantId === id);
    expect(events).toHaveLength(1);
    const payload = events[0].payload as any;
    expect(payload.count).toBe(1);
    expect(payload.top[0]).toMatchObject({ opportunityId: FRESH_OPP, studioPath: `/grant-studio/opportunities/${FRESH_OPP}?org=${id}` });
    expect(Object.keys(payload).sort()).toEqual(["applicantId", "applicantName", "count", "matchesPath", "top"]);
    await emitMatchAlerts();
    const again = (await db.select().from(webhookEventsTable).where(eq(webhookEventsTable.userId, OWNER))).filter((e) => e.type === "grant.new_matches" && (e.payload as any).applicantId === id);
    expect(again).toHaveLength(1);

    // Mark as seen clears the new count; another operator cannot.
    expect((await client(await login(OTHER))("POST", `/grants/applicants/${id}/matches/seen`)).status).toBe(404);
    expect((await api("POST", `/grants/applicants/${id}/matches/seen`)).status).toBe(200);
    const seen = await api("GET", `/grants/applicants/${id}/matches?relevantOnly=1`);
    expect(seen.data.newTotal).toBe(0);
    expect(seen.data.matches.find((m: any) => m.opportunity.id === FRESH_OPP).isNew).toBe(false);
  }, 30_000);

  it("keeps a confirmed, sourced fact library that drafting uses and editing re-opens", async () => {
    const api = client(await login(OWNER));
    const org = (await api("POST", "/grants/applicants", { name: "Pine Street Readers", applicantType: "nonprofit_501c3", focusAreas: ["literacy"] })).data;
    const meta = await api("GET", `/grants/applicants/${org.id}/facts`);
    expect(meta.data.categories.map((c: any) => c.key)).toContain("need");
    expect((await api("POST", `/grants/applicants/${org.id}/facts`, { category: "bogus", label: "x", body: "y" })).status).toBe(400);
    expect((await api("POST", `/grants/applicants/${org.id}/facts`, { category: "need", label: "", body: "y" })).status).toBe(400);
    expect((await api("POST", `/grants/applicants/${org.id}/facts`, { category: "need", label: "x", body: "y", asOf: "soon" })).status).toBe(400);

    const confirmed = await api("POST", `/grants/applicants/${org.id}/facts`, { category: "need", label: "Third-grade reading", body: "41% of third graders read at grade level.", source: "State report card 2025", asOf: "2025-08-01", confirmed: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.data.confirmed).toBe(true);
    expect(confirmed.data.confirmedBy).toBeTruthy();
    const draftOnly = await api("POST", `/grants/applicants/${org.id}/facts`, { category: "need", label: "Unverified claim", body: "Most families lack books." });
    expect(draftOnly.data.confirmed).toBe(false);

    // Another operator can neither read nor change the library.
    const other = client(await login(OTHER));
    expect((await other("GET", `/grants/applicants/${org.id}/facts`)).status).toBe(404);
    expect((await other("PATCH", `/grants/facts/${confirmed.data.id}`, { body: "hijack" })).status).toBe(404);
    expect((await other("DELETE", `/grants/facts/${confirmed.data.id}`)).status).toBe(404);

    // Drafting (demo provider) lists confirmed facts only.
    const app = await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: NONPROFIT_OPP, eligibilityConfirmed: true });
    const ws = (await api("GET", `/grants/applications/${app.data.id}`)).data;
    expect(ws.library.total).toBe(2);
    expect(ws.library.confirmed.map((f: any) => f.id)).toEqual([confirmed.data.id]);
    expect(ws.library.sectionCategories.need).toEqual(["need"]);
    const need = ws.sections.find((sec: any) => sec.key === "need");
    const drafted = await api("POST", `/grants/sections/${need.id}/draft`);
    expect(drafted.status).toBe(200);
    const content = (await api("GET", `/grants/applications/${app.data.id}`)).data.sections.find((sec: any) => sec.key === "need").content;
    expect(content).toContain("41% of third graders read at grade level.");
    expect(content).toContain("State report card 2025");
    expect(content).not.toContain("Most families lack books.");

    // Editing a confirmed fact withdraws its confirmation; confirming again restores it.
    const edited = await api("PATCH", `/grants/facts/${confirmed.data.id}`, { body: "43% of third graders read at grade level." });
    expect(edited.data.confirmed).toBe(false);
    const reconfirmed = await api("PATCH", `/grants/facts/${confirmed.data.id}`, { confirmed: true });
    expect(reconfirmed.data.confirmed).toBe(true);
    expect((await api("DELETE", `/grants/facts/${draftOnly.data.id}`)).status).toBe(204);
    expect((await api("GET", `/grants/applicants/${org.id}/facts`)).data.facts).toHaveLength(1);
  }, 30_000);

  it("exports deadline calendars and sends each deadline reminder once", async () => {
    const api = client(await login(OWNER));
    await db.insert(grantOpportunitiesTable).values(opportunity(DUE_OPP, { title: "Due soon literacy grant", closeDate: inDays(10), eligibilityCodes: ["12"] }));
    const org = (await api("POST", "/grants/applicants", { name: "Calendar Test Readers", applicantType: "nonprofit_501c3" })).data;
    const app = (await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: DUE_OPP, eligibilityConfirmed: true })).data;

    const one = await api("GET", `/grants/applications/${app.id}/deadline.ics`);
    expect(one.status).toBe(200);
    expect(one.headers.get("content-type")).toMatch(/text\/calendar/);
    expect(one.headers.get("content-disposition")).toMatch(/attachment; filename=".+\.ics"/);
    const text = one.data.toString("utf8");
    expect(text).toContain(`DTSTART;VALUE=DATE:${inDays(10).replace(/-/g, "")}`);
    expect(text).toContain("Grant due: ");
    expect((await api("GET", `/grants/opportunities/${DUE_OPP}/deadline.ics`)).status).toBe(200);
    expect((await api("GET", `/grants/opportunities/${CLOSED_OPP}/deadline.ics`)).status).toBe(404);
    const all = (await api("GET", "/grants/calendar.ics")).data.toString("utf8");
    expect(all).toContain(`UID:application-${app.id}@grant-studio`);
    const other = client(await login(OTHER));
    expect((await other("GET", `/grants/applications/${app.id}/deadline.ics`)).status).toBe(404);
    expect((await other("GET", "/grants/calendar.ics")).data.toString("utf8")).not.toContain(app.id);

    // 10 days left: the 14-day reminder fires once; at 5 days the 7-day one fires.
    const reminders = async () => (await db.select().from(webhookEventsTable).where(eq(webhookEventsTable.userId, OWNER))).filter((e) => e.type === "grant.deadline_approaching" && (e.payload as any).applicationId === app.id);
    await emitDeadlineReminders();
    await emitDeadlineReminders();
    expect((await reminders()).map((e) => (e.payload as any).reminderDays)).toEqual([14]);
    expect((await reminders())[0].payload).toMatchObject({ daysLeft: 10, applicationPath: `/grant-studio/applications/${app.id}` });
    await db.update(grantOpportunitiesTable).set({ closeDate: inDays(5) }).where(eq(grantOpportunitiesTable.id, DUE_OPP));
    await emitDeadlineReminders();
    expect((await reminders()).map((e) => (e.payload as any).reminderDays).sort()).toEqual([14, 7]);
  }, 30_000);

  it("syncs the California Grants Portal and takes a California nonprofit to a state application", async () => {
    const close = inDays(30);
    const base = { Status: "active", AgencyDept: "CA Test Agency", Categories: "Education", Purpose: "Supports seed library programs in California.", Description: "Test listing.", ApplicantType: "Nonprofit", MatchingFunds: "Not Required", EstAmounts: "Between $5,000.00 and $50,000.00", EstAvailFunds: "$200,000.00", OpenDate: "2026-10-01 09:00:00", GrantURL: "https://grants.ca.gov/test" };
    let records: Record<string, string>[] = [
      { ...base, PortalID: "ca-test-1", Title: "California Seed Library Grants", ApplicationDeadline: `${close} 17:00:00` },
      { ...base, PortalID: "ca-test-2", Title: "California Seed Library Rolling Fund", ApplicationDeadline: "Ongoing", MatchingFunds: "25%" },
      { ...base, PortalID: "ca-test-3", Title: "California insecure link", ApplicationDeadline: `${close} 17:00:00`, GrantURL: "http://grants.ca.gov/insecure", AgencyURL: "None" },
    ];
    const urls: string[] = [];
    const fake: CaFetchLike = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ success: true, result: { records, total: records.length } }) };
    };
    const result = await syncCalifornia(fake);
    expect(result.status).toBe("succeeded");
    expect(result.fetched).toBe(3);
    expect(decodeURIComponent(urls[0])).toContain('"Status":["active","forecasted"]');
    const rows = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.source, "ca_grants_portal"));
    const byRef = new Map(rows.map((r) => [r.sourceRef, r]));
    expect(byRef.get("ca-test-1")).toMatchObject({ publishable: true, jurisdiction: "CA", closeDate: close, awardCeiling: 50000, rollingDeadline: false });
    expect(byRef.get("ca-test-2")).toMatchObject({ publishable: true, rollingDeadline: true, closeDate: null, costSharePercent: 25 });
    expect(byRef.get("ca-test-3")!.publishable).toBe(false);
    expect(byRef.get("ca-test-3")!.gateMissing).toContain("official https source");

    const api = client(await login(OWNER));
    const caOrg = (await api("POST", "/grants/applicants", { name: "Sacramento Seed Savers", applicantType: "nonprofit_501c3", state: "CA", focusAreas: ["seed library"], maxCostSharePercent: 0 })).data;
    const ncOrg = (await api("POST", "/grants/applicants", { name: "Raleigh Seed Savers", applicantType: "nonprofit_501c3", state: "NC", focusAreas: ["seed library"] })).data;
    const caMatches = (await api("GET", `/grants/applicants/${caOrg.id}/matches?relevantOnly=1`)).data.matches;
    const ids = caMatches.map((m: any) => m.opportunity.sourceRef);
    expect(ids).toContain("ca-test-1");
    // The rolling fund requires a 25% match this organization cannot commit.
    expect(ids).not.toContain("ca-test-2");
    const first = caMatches.find((m: any) => m.opportunity.sourceRef === "ca-test-1");
    expect(first.opportunity).toMatchObject({ sourceLabel: "California Grants Portal", federal: false, eligibilityLabels: ["Nonprofit"] });
    expect(first.match.gaps.join(" ")).not.toMatch(/SAM/);
    const ncIds = (await api("GET", `/grants/applicants/${ncOrg.id}/matches`)).data.matches.map((m: any) => m.opportunity.sourceRef);
    expect(ncIds).not.toContain("ca-test-1");

    // A state application: state template, no SAM row, and compliance does not ask for federal registrations.
    await api("PUT", `/grants/applicants/${caOrg.id}/readiness/irs_determination`, { status: "ready" });
    const app = (await api("POST", "/grants/applications", { applicantId: caOrg.id, opportunityId: first.opportunity.id, eligibilityConfirmed: true })).data;
    const ws = (await api("GET", `/grants/applications/${app.id}`)).data;
    expect(ws.application.template).toBe("state_nonprofit");
    expect(ws.requirements.map((r: any) => r.label).join(" ")).not.toMatch(/SAM\.gov|SF-424/);
    expect(ws.compliance.checks.find((c: any) => c.id === "readiness").ok).toBe(true);
    // Opening the opportunity does not try a Grants.gov detail refresh.
    const detail = await api("GET", `/grants/opportunities/${first.opportunity.id}?applicantId=${caOrg.id}`);
    expect(detail.status).toBe(200);
    expect(detail.data.detailError ?? null).toBeNull();

    // A record that leaves the open set is closed and unpublished.
    records = records.filter((r) => r.PortalID !== "ca-test-1");
    await syncCalifornia(fake);
    const [gone] = await db.select().from(grantOpportunitiesTable).where(and(eq(grantOpportunitiesTable.source, "ca_grants_portal"), eq(grantOpportunitiesTable.sourceRef, "ca-test-1")));
    expect(gone).toMatchObject({ status: "closed", publishable: false });

    // A failing portal is recorded, not hidden.
    const down: CaFetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const failed = await syncCalifornia(down);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/503/);
    await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.id, [caOrg.id, ncOrg.id]));
    await db.delete(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.source, "ca_grants_portal"));
  }, 30_000);

  it("reuses hub alert summaries until the organization, its readiness or the opportunity store changes", async () => {
    const api = client(await login(OWNER));
    const org = (await api("POST", "/grants/applicants", { name: "Cache Test Readers", applicantType: "nonprofit_501c3", focusAreas: ["literacy"] })).data;
    // Other test files add and close opportunities in the same database while this file runs, and any change to
    // the opportunity store rightly recomputes every summary. So a phase below counts a hub load only when the store
    // held still through it and through the load before it (which built the cached entries), and repeats otherwise.
    const storeVersion = async () =>
      JSON.stringify(
        await db
          .select({ changed: sql`max(${grantOpportunitiesTable.updatedAt})`, publishable: sql`count(*) filter (where ${grantOpportunitiesTable.publishable})` })
          .from(grantOpportunitiesTable),
      );
    let lastVersion = "";
    const hubLoad = async () => {
      const before = await storeVersion();
      const start = alertSummaryStats();
      const data = (await api("GET", "/grants/applicants")).data as any[];
      const end = alertSummaryStats();
      const after = await storeVersion();
      const consistent = after === before;
      const stable = consistent && before === lastVersion;
      lastVersion = consistent ? after : "";
      return { data, stable, hits: end.hits - start.hits, misses: end.misses - start.misses };
    };
    const ATTEMPTS = 50;

    resetAlertSummaryCache();
    const first = await hubLoad();
    const owned = first.data.length;
    expect(first).toMatchObject({ hits: 0, misses: owned });

    // Nothing changed: every summary is reused.
    let measured = false;
    for (let i = 0; i < ATTEMPTS && !measured; i++) {
      const load = await hubLoad();
      if (!load.stable) continue;
      expect(load).toMatchObject({ hits: owned, misses: 0 });
      measured = true;
    }
    expect(measured, `no hub load in ${ATTEMPTS} attempts ran without a concurrent opportunity-store change`).toBe(true);

    // A readiness change rescores only that organization.
    measured = false;
    for (let i = 0; i < ATTEMPTS && !measured; i++) {
      await api("PUT", `/grants/applicants/${org.id}/readiness/irs_determination`, { status: i % 2 === 0 ? "ready" : "in_progress" });
      const load = await hubLoad();
      if (!load.stable) continue;
      expect(load).toMatchObject({ hits: owned - 1, misses: 1 });
      measured = true;
    }
    expect(measured, `no hub load in ${ATTEMPTS} attempts ran without a concurrent opportunity-store change`).toBe(true);

    // A new opportunity changes the store, so every summary is recomputed and the new match counts.
    const extra = randomUUID();
    await db.insert(grantOpportunitiesTable).values(opportunity(extra, { title: "Literacy cache test grant", eligibilityCodes: ["12"] }));
    const changed = await hubLoad();
    expect(changed).toMatchObject({ hits: 0, misses: owned });
    expect(changed.data.find((a: any) => a.id === org.id).alerts.newMatches).toBe(1);
    await db.delete(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, extra));
    await db.delete(grantApplicantsTable).where(eq(grantApplicantsTable.id, org.id));
  }, 30_000);

  it("saves approved section text and reuses it in a later application", async () => {
    const api = client(await login(OWNER));
    const oppA = randomUUID();
    const oppB = randomUUID();
    await db.insert(grantOpportunitiesTable).values([
      opportunity(oppA, { title: "Saved writing test A", eligibilityCodes: ["12"] }),
      opportunity(oppB, { title: "Saved writing test B", eligibilityCodes: ["12"] }),
    ]);
    const org = (await api("POST", "/grants/applicants", { name: "Writing Reuse Readers", applicantType: "nonprofit_501c3" })).data;
    const appA = (await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: oppA, eligibilityConfirmed: true })).data;
    const wsA = (await api("GET", `/grants/applications/${appA.id}`)).data;
    const capA = wsA.sections.find((sec: any) => sec.key === "capacity");

    // Only approved, non-demo text can be saved.
    await api("PATCH", `/grants/sections/${capA.id}`, { content: "<p>Founded in 2009, we run reading programs at 12 schools.</p><script>x()</script>" });
    expect((await api("POST", `/grants/sections/${capA.id}/save-to-library`, {})).status).toBe(409);
    // The founding year and the count are claims: approval waits for a confirmed fact behind them.
    expect((await api("POST", `/grants/sections/${capA.id}/approve`)).status).toBe(409);
    await api("POST", `/grants/applicants/${org.id}/facts`, { category: "history", label: "History and reach", body: "Founded in 2009; reading programs at 12 schools.", confirmed: true });
    expect((await api("POST", `/grants/sections/${capA.id}/approve`)).status).toBe(200);
    const saved = await api("POST", `/grants/sections/${capA.id}/save-to-library`, {});
    expect(saved.status).toBe(201);
    expect(saved.data).toMatchObject({ sectionKey: "capacity", sourceApplicationId: appA.id, words: 10 });
    expect(saved.data.content).not.toContain("<script");
    const demoSection = wsA.sections.find((sec: any) => sec.key === "need");
    await api("POST", `/grants/sections/${demoSection.id}/draft`);
    await api("POST", `/grants/sections/${demoSection.id}/approve`);
    expect((await api("POST", `/grants/sections/${demoSection.id}/save-to-library`, {})).status).toBe(409);

    // Another operator can see or use none of it.
    const other = client(await login(OTHER));
    expect((await other("GET", `/grants/applicants/${org.id}/snippets`)).status).toBe(404);
    expect((await other("PATCH", `/grants/snippets/${saved.data.id}`, { title: "x" })).status).toBe(404);
    expect((await other("DELETE", `/grants/snippets/${saved.data.id}`)).status).toBe(404);

    // A second application: drafting sees the saved text, and inserting it replaces then appends.
    const appB = (await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: oppB, eligibilityConfirmed: true })).data;
    const capB = (await api("GET", `/grants/applications/${appB.id}`)).data.sections.find((sec: any) => sec.key === "capacity");
    await api("POST", `/grants/sections/${capB.id}/draft`);
    const drafted = (await api("GET", `/grants/applications/${appB.id}`)).data.sections.find((sec: any) => sec.key === "capacity");
    expect(drafted.content).toMatch(/Approved writing on file for this section/);
    expect((await api("POST", `/grants/sections/${capB.id}/insert-snippet`, { snippetId: saved.data.id, mode: "sideways" })).status).toBe(400);
    const replaced = await api("POST", `/grants/sections/${capB.id}/insert-snippet`, { snippetId: saved.data.id, mode: "replace" });
    expect(replaced.status).toBe(200);
    // Replacing a demo scaffold leaves only the saved text, and the section is no longer demo content.
    expect(replaced.data.content).toBe(saved.data.content);
    expect(replaced.data).toMatchObject({ demoContent: false, status: "drafting" });
    const appended = await api("POST", `/grants/sections/${capB.id}/insert-snippet`, { snippetId: saved.data.id, mode: "append" });
    expect(appended.data.content).toBe(saved.data.content + saved.data.content);
    await api("POST", `/grants/sections/${capB.id}/approve`);
    expect((await api("POST", `/grants/sections/${capB.id}/insert-snippet`, { snippetId: saved.data.id, mode: "replace" })).status).toBe(409);
    expect((await other("POST", `/grants/sections/${capB.id}/insert-snippet`, { snippetId: saved.data.id, mode: "replace" })).status).toBe(404);

    // The saved text outlives its source application; rename and delete work.
    await api("DELETE", `/grants/applications/${appA.id}`);
    const list = (await api("GET", `/grants/applicants/${org.id}/snippets`)).data;
    expect(list).toHaveLength(1);
    expect(list[0].preview).toContain("Founded in 2009");
    expect((await api("PATCH", `/grants/snippets/${saved.data.id}`, { title: "Capacity, standard" })).data.title).toBe("Capacity, standard");
    expect((await api("DELETE", `/grants/snippets/${saved.data.id}`)).status).toBe(204);
    await db.delete(grantApplicantsTable).where(eq(grantApplicantsTable.id, org.id));
    await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [oppA, oppB]));
  }, 30_000);

  it("records submission and decision outcomes and summarizes the pipeline", async () => {
    const api = client(await login(OWNER));
    const oppId = randomUUID();
    await db.insert(grantOpportunitiesTable).values(opportunity(oppId, { title: "Outcome test grant", eligibilityCodes: ["12"], closeDate: inDays(20) }));
    const org = (await api("POST", "/grants/applicants", { name: "Outcome Test Readers", applicantType: "nonprofit_501c3" })).data;
    const app = (await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: oppId, eligibilityConfirmed: true })).data;
    await api("POST", `/grants/applications/${app.id}/budget-lines`, { category: "personnel", description: "Coordinator", quantity: 1, unitCost: 40000, justification: "Runs the program." });

    expect((await api("POST", `/grants/applications/${app.id}/outcome`, { outcome: "submitted" })).status).toBe(409);
    expect((await api("POST", `/grants/applications/${app.id}/outcome`, { outcome: "won" })).status).toBe(400);
    const before = (await api("GET", `/grants/pipeline?applicantId=${org.id}`)).data;
    expect(before).toMatchObject({ inProgress: 1, dueWithin30Days: 1, awaitingDecision: 0 });

    // The final-package path itself is covered by the nonprofit test; here the package is marked exported directly.
    await db.update(grantApplicationsTable).set({ status: "exported", exportedAt: new Date() }).where(eq(grantApplicationsTable.id, app.id));
    const submitted = await api("POST", `/grants/applications/${app.id}/outcome`, { outcome: "submitted", date: "2026-11-04", trackingNumber: "GRANT12345678" });
    expect(submitted.status).toBe(200);
    expect(submitted.data.application).toMatchObject({ outcome: "submitted", submittedOn: "2026-11-04", trackingNumber: "GRANT12345678", submittedAmount: 40000 });
    // The competitiveness rating is frozen at submission (it is a rating, never a probability).
    expect(submitted.data.rating.disclaimer).toContain("not a probability of approval");
    expect(submitted.data.application.ratingAtSubmission).toBe(submitted.data.rating.score);
    expect(submitted.data.application.ratingBandAtSubmission).toBe(submitted.data.rating.band);
    expect(submitted.data.rating.components.map((c: any) => c.key)).toEqual(["fit", "review", "completeness", "readinessTime"]);
    expect((await client(await login(OTHER))("POST", `/grants/applications/${app.id}/outcome`, { outcome: "declined" })).status).toBe(404);
    // A submitted application gets no more deadline reminders and leaves the deadline calendar.
    expect((await api("GET", "/grants/calendar.ics")).data.toString("utf8")).not.toContain(app.id);
    // Editing after submission keeps the record.
    const sec = submitted.data.sections[0];
    await api("PATCH", `/grants/sections/${sec.id}`, { content: "<p>Post-submission note.</p>" });
    expect((await api("GET", `/grants/applications/${app.id}`)).data.application).toMatchObject({ status: "exported", outcome: "submitted" });

    expect((await api("POST", `/grants/applications/${app.id}/outcome`, { outcome: "awarded" })).status).toBe(400);
    const awarded = await api("POST", `/grants/applications/${app.id}/outcome`, { outcome: "awarded", awardedAmount: 35000, date: "2027-02-01", note: "Partial award" });
    expect(awarded.data.application).toMatchObject({ outcome: "awarded", awardedAmount: 35000, outcomeDate: "2027-02-01", submittedOn: "2026-11-04" });
    const pipeline = (await api("GET", `/grants/pipeline?applicantId=${org.id}`)).data;
    expect(pipeline).toMatchObject({ inProgress: 0, awarded: 1, awardedTotal: 35000, requestedSubmitted: 40000, winRate: 1 });
    // One decision is too few to state an award rate for its band.
    const band = pipeline.calibration.bands.find((b: any) => b.band === submitted.data.rating.band);
    expect(band).toMatchObject({ awarded: 1, awardRate: null });
    expect(pipeline.calibration).toMatchObject({ decided: 1, minDecisions: 5 });

    // Undo steps back: awarded → submitted → no outcome.
    expect((await api("DELETE", `/grants/applications/${app.id}/outcome`)).data.application).toMatchObject({ outcome: "submitted", awardedAmount: null, outcomeDate: "2026-11-04" });
    expect((await api("DELETE", `/grants/applications/${app.id}/outcome`)).data.application).toMatchObject({ outcome: null, submittedAmount: null, ratingAtSubmission: null, ratingBandAtSubmission: null });
    expect((await api("DELETE", `/grants/applications/${app.id}/outcome`)).status).toBe(409);
    await db.delete(grantApplicantsTable).where(eq(grantApplicantsTable.id, org.id));
    await db.delete(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, oppId));
  }, 30_000);

  it("syncs Grants.gov through the connector, merging eligibility codes and gating records", async () => {
    const close = inDays(45);
    const hits: Record<string, any[]> = {
      "12": [{ id: "910001", number: "SYNC-1", title: "Sync test: nonprofit and business", agency: "Agency A", agencyCode: "AA", openDate: "01/02/2026", closeDate: close.slice(5, 7) + "/" + close.slice(8, 10) + "/" + close.slice(0, 4), oppStatus: "posted", cfdaList: ["10.001"] }],
      "23": [{ id: "910001", number: "SYNC-1", title: "Sync test: nonprofit and business", agency: "Agency A", agencyCode: "AA", openDate: "01/02/2026", closeDate: close.slice(5, 7) + "/" + close.slice(8, 10) + "/" + close.slice(0, 4), oppStatus: "posted" },
        { id: "910002", number: "SYNC-2", title: "Sync test: no closing date", agency: "Agency B", oppStatus: "posted" }],
    };
    const calls: string[] = [];
    const fake: FetchLike = async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith("/search2")) {
        calls.push(body.eligibilities);
        const list = body.startRecordNum ? [] : hits[body.eligibilities] ?? [];
        return { ok: true, status: 200, json: async () => ({ errorcode: 0, data: { hitCount: list.length, startRecord: body.startRecordNum ?? 0, oppHits: list } }) };
      }
      return { ok: true, status: 200, json: async () => ({ errorcode: 0, data: { synopsis: { awardCeiling: "50000", costSharing: false, applicantTypes: [{ id: "12" }, { id: "23" }], synopsisDesc: "<p>Detail text</p>", responseDate: close } } }) };
    };
    const result = await syncGrantsGov(fake);
    expect(result.status).toBe("succeeded");
    expect(calls).toEqual(expect.arrayContaining(["12", "13", "22", "23", "25", "99"]));
    const [one] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.sourceRef, "910001"));
    expect(one.publishable).toBe(true);
    expect(one.awardCeiling).toBe(50000);
    expect(one.description).toBe("Detail text");
    expect([...one.eligibilityCodes].sort()).toEqual(["12", "23"]);
    const [two] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.sourceRef, "910002"));
    expect(two.publishable).toBe(false);
    expect(two.gateMissing).toContain("closing date");
    const [run] = await db.select().from(grantSyncRunsTable).where(eq(grantSyncRunsTable.id, result.runId));
    expect(run.status).toBe("succeeded");

    // A failing source is recorded, not hidden.
    const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const failed = await syncGrantsGov(down);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/503/);
    await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.sourceRef, ["910001", "910002"]));
  }, 30_000);
});
