/**
 * Federal forms in the package and the unsupported-claim check, against the
 * real test database: a person fills SF-424, SF-424A, SF-424B and SF-LLL
 * (prefilled where GrantCrest holds the data), the forms reach the package,
 * and an open claim flag blocks approval on the server until a person links a
 * confirmed fact, edits the text, or dismisses it with a reason. Another
 * workspace reaches none of it. Synthetic data only; nothing is sent anywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { inflateRawSync } from "zlib";
import { eq, inArray, like } from "drizzle-orm";
import { db, grantApplicantsTable, grantClaimFlagsTable, grantOpportunitiesTable, membersTable, usersTable, workspacesTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import grantsRouter from "./grants";
import { router as fullRouter } from "./index";

const OWNER = `forms-owner-${randomUUID()}`;
const OTHER = `forms-other-${randomUUID()}`;
const FED_OPP = randomUUID();
const STATE_OPP = randomUUID();

let server: Server;
let base = "";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "forms-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
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
    sourceRef: `forms-${id}`,
    title: "Community Literacy Grants",
    number: "ED-FORMS-2026-01",
    agency: "Department of Education",
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
    assistanceListings: ["84.123"],
    costSharing: false,
    awardCeiling: 150000,
    ...overrides,
  };
}

function readZipEntry(zip: Buffer, name: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = zip.readUInt32LE(eocd + 16);
  const entries = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + nameLength + extra;
  }
  throw new Error(`${name} not in zip`);
}

/** What a person enters on the SF-424 that GrantCrest cannot prefill (synthetic). */
const SF424_PERSON = {
  submission_type: "Application",
  application_type: "New",
  "applicant.street1": "101 Main Street",
  "applicant.city": "Durham",
  "applicant.zip_code": "277010001",
  "contact_person.first_name": "Ana",
  "contact_person.last_name": "Diaz",
  phone_number: "919-555-0100",
  email: "ana@example.org",
  congressional_district_applicant: "NC-004",
  congressional_district_program_project: "NC-004",
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
  authorized_representative_phone_number: "919-555-0101",
  authorized_representative_email: "sam@example.org",
};

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: OWNER, username: `fm-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `fm-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  await db.insert(grantOpportunitiesTable).values([
    opportunity(FED_OPP, {}),
    opportunity(STATE_OPP, { source: "california", title: "California Literacy Grants", number: null, agency: "California State Library", jurisdiction: "CA", assistanceListings: [] }),
  ]);
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [FED_OPP, STATE_OPP]));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

async function startApplication(api: ReturnType<typeof client>, opportunityId: string) {
  const org = await api("POST", "/grants/applicants", { name: "Read & Rise Literacy", applicantType: "nonprofit_501c3", state: "NC", ein: "12-3456789", uei: "ABCDEFGHJKL1" });
  expect(org.status).toBe(201);
  const started = await api("POST", "/grants/applications", { applicantId: org.data.id, opportunityId, eligibilityConfirmed: true });
  expect(started.status).toBe(201);
  return { applicantId: org.data.id as string, appId: started.data.id as string };
}

const field = (form: any, id: string) => form.sections.flatMap((s: any) => s.fields).find((f: any) => f.id === id);
const formOf = (res: any, key: string) => res.data.forms.find((f: any) => f.key === key);

describe("federal forms", () => {
  it("prefills, takes a person's entries, validates, and goes into the package; never for another workspace", async () => {
    const api = client(await login(OWNER));
    const other = client(await login(OTHER));
    const { appId } = await startApplication(api, FED_OPP);
    await api("POST", `/grants/applications/${appId}/budget-lines`, { category: "personnel", description: "Program director", quantity: 1, unitCost: 90000, justification: "Leads the program" });

    let forms = await api("GET", `/grants/applications/${appId}/forms`);
    expect(forms.status).toBe(200);
    expect(forms.data.federal).toBe(true);
    expect(forms.data.source).toMatchObject({ repository: "https://github.com/HHS/simpler-grants-gov", path: "api/src/form_schema/forms/" });
    expect(forms.data.forms.map((f: any) => f.key)).toEqual(["sf424", "sf424a", "sf424b", "sflll"]);
    const sf424 = formOf(forms, "sf424");
    expect(field(sf424, "organization_name")).toMatchObject({ value: "Read & Rise Literacy", origin: "prefill", source: "Organization profile" });
    expect(field(sf424, "funding_opportunity_number")).toMatchObject({ value: "ED-FORMS-2026-01", origin: "prefill" });
    expect(field(sf424, "federal_estimated_funding")).toMatchObject({ value: "90000.00", origin: "prefill" });
    expect(field(sf424, "project_start_date")).toMatchObject({ value: null, errors: ["Required."] });
    expect(forms.data.check.ok).toBe(false);

    // The workspace view lists the forms' status, and the package check fails until they are done.
    let ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.federalForms.map((f: any) => f.label)).toEqual(["SF-424", "SF-424A", "SF-424B", "SF-LLL"]);
    expect(ws.compliance.checks.find((c: any) => c.id === "federal_forms")).toMatchObject({ ok: false });

    // Only fields a person fills, with values of the right type.
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf999`, { values: {} })).status).toBe(404);
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { total_estimated_funding: "1.00" } })).status).toBe(400);
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { date_received: "2026-01-01" } })).status).toBe(400);
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { delinquent_federal_debt: "no" } })).status).toBe(400);
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: [] })).status).toBe(400);
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: {}, extra: 1 })).status).toBe(400);
    // Reviewing an incomplete form is refused.
    expect((await api("POST", `/grants/applications/${appId}/forms/sf424/review`)).status).toBe(409);

    forms = await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { ...SF424_PERSON, email: "not-an-email" } });
    expect(forms.status).toBe(200);
    expect(field(formOf(forms, "sf424"), "email").errors).toEqual(["Enter an email address."]);
    forms = await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { email: "ana@example.org" } });
    expect(formOf(forms, "sf424")).toMatchObject({ status: "ready_to_review", errorCount: 0 });
    expect(field(formOf(forms, "sf424"), "total_estimated_funding")).toMatchObject({ value: "90000.00", origin: "computed" });
    // SF-424B copies the representative's title from the SF-424.
    expect(field(formOf(forms, "sf424b"), "title")).toMatchObject({ value: "Executive Director", origin: "prefill" });

    // A person's value wins over the prefill; resetting it brings the prefill back.
    forms = await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { organization_name: "Read and Rise Literacy, Inc." } });
    expect(field(formOf(forms, "sf424"), "organization_name")).toMatchObject({ value: "Read and Rise Literacy, Inc.", origin: "entered" });
    forms = await api("PUT", `/grants/applications/${appId}/forms/sf424`, { reset: ["organization_name"] });
    expect(field(formOf(forms, "sf424"), "organization_name")).toMatchObject({ value: "Read & Rise Literacy", origin: "prefill" });

    forms = await api("POST", `/grants/applications/${appId}/forms/sf424/review`);
    expect(formOf(forms, "sf424")).toMatchObject({ status: "complete", reviewedBy: expect.any(String), reviewCurrent: true });
    // A later budget change reaches the prefilled amount and needs a new review.
    await api("POST", `/grants/applications/${appId}/budget-lines`, { category: "supplies", description: "Books", quantity: 100, unitCost: 10, justification: "Books for participants" });
    forms = await api("GET", `/grants/applications/${appId}/forms`);
    expect(field(formOf(forms, "sf424"), "federal_estimated_funding").value).toBe("91000.00");
    expect(formOf(forms, "sf424").status).toBe("ready_to_review");
    forms = await api("POST", `/grants/applications/${appId}/forms/sf424/review`);
    expect(formOf(forms, "sf424").status).toBe("complete");

    forms = await api("PUT", `/grants/applications/${appId}/forms/sf424a`, { values: { "activity_line_items.0.activity_title": "Summer tutoring", confirmation: true } });
    expect(formOf(forms, "sf424a").errorCount).toBe(0);
    await api("POST", `/grants/applications/${appId}/forms/sf424a/review`);
    await api("POST", `/grants/applications/${appId}/forms/sf424b/review`);

    // Only the SF-LLL can be not applicable, and only with a reason.
    expect((await api("POST", `/grants/applications/${appId}/forms/sf424/applicability`, { notApplicable: true, reason: "Does not apply to us at all." })).status).toBe(400);
    expect((await api("POST", `/grants/applications/${appId}/forms/sflll/applicability`, { notApplicable: true, reason: "no" })).status).toBe(400);
    forms = await api("POST", `/grants/applications/${appId}/forms/sflll/applicability`, { notApplicable: true, reason: "No one is paid to lobby for this award." });
    expect(formOf(forms, "sflll")).toMatchObject({ status: "not_applicable", notApplicableReason: "No one is paid to lobby for this award." });
    expect(forms.data.check.ok).toBe(true);
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.compliance.checks.find((c: any) => c.id === "federal_forms").ok).toBe(true);

    // The final forms come with the approved package; a draft is always available.
    expect((await api("GET", `/grants/applications/${appId}/forms.json`)).status).toBe(409);
    const json = await api("GET", `/grants/applications/${appId}/forms.json?draft=1`);
    expect(json.status).toBe(200);
    expect(json.headers.get("content-disposition")).toMatch(/_forms\.json/);
    expect(json.data).toMatchObject({ draft: true, notice: expect.stringContaining("does not submit") });
    expect(json.data.forms.find((f: any) => f.key === "sf424").data).toMatchObject({ organization_name: "Read & Rise Literacy", submission_type: "Application", total_estimated_funding: "91000.00" });
    expect(json.data.forms.find((f: any) => f.key === "sflll")).toMatchObject({ notApplicable: true, data: null });
    const pdf = await api("GET", `/grants/applications/${appId}/forms.pdf?draft=1`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((pdf.data as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

    // The package DOCX carries the readable forms.
    const docx = await api("GET", `/grants/applications/${appId}/package.docx?draft=1`);
    expect(docx.status).toBe(200);
    const xml = readZipEntry(docx.data as Buffer, "word/document.xml");
    expect(xml).toContain("Federal forms");
    expect(xml).toContain("SF-424: Application for Federal Assistance");
    expect(xml).toContain("Summer tutoring");
    expect(xml).toContain("No one is paid to lobby for this award.");

    // Another workspace can neither read nor change any of it.
    expect((await other("GET", `/grants/applications/${appId}/forms`)).status).toBe(404);
    expect((await other("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { email: "x@example.org" } })).status).toBe(404);
    expect((await other("POST", `/grants/applications/${appId}/forms/sf424/review`)).status).toBe(404);
    expect((await other("POST", `/grants/applications/${appId}/forms/sflll/applicability`, { notApplicable: false })).status).toBe(404);
    expect((await other("GET", `/grants/applications/${appId}/forms.json?draft=1`)).status).toBe(404);
    expect((await other("GET", `/grants/applications/${appId}/forms.pdf?draft=1`)).status).toBe(404);
    const after = await api("GET", `/grants/applications/${appId}/forms`);
    expect(field(formOf(after, "sf424"), "email").value).toBe("ana@example.org");
  }, 60_000);

  it("leaves a state program's forms to its own portal", async () => {
    const api = client(await login(OWNER));
    const { appId } = await startApplication(api, STATE_OPP);
    const forms = await api("GET", `/grants/applications/${appId}/forms`);
    expect(forms.data).toMatchObject({ federal: false, forms: [], check: null });
    expect((await api("PUT", `/grants/applications/${appId}/forms/sf424`, { values: { email: "a@example.org" } })).status).toBe(409);
    expect((await api("GET", `/grants/applications/${appId}/forms.json?draft=1`)).status).toBe(404);
    const ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.federalForms).toBeNull();
    expect(ws.compliance.checks.some((c: any) => c.id === "federal_forms")).toBe(false);
  }, 30_000);
});

describe("unsupported-claim check", () => {
  it("blocks approval on the server until each flag is linked, edited away or dismissed with a reason", async () => {
    const api = client(await login(OWNER));
    const other = client(await login(OTHER));
    const { applicantId, appId } = await startApplication(api, FED_OPP);
    let ws = (await api("GET", `/grants/applications/${appId}`)).data;
    const section = ws.sections.find((s: any) => s.key === "capacity") ?? ws.sections[0];
    await api("PATCH", `/grants/sections/${section.id}`, {
      content: "<p>Founded in 2009, we served 1,240 students last year.</p><p>We partner with the Durham County Library.</p><p>Our tutors are certified reading specialists.</p>",
    });

    // The flags show on the section, with the reason and the method.
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    let claims = ws.sections.find((s: any) => s.id === section.id).claims;
    expect(claims.method).toMatch(/Rule check \(no AI\)/);
    const claimText = claims.flags.map((f: any) => `${f.kind}:${f.claim}`);
    expect(claimText).toEqual(expect.arrayContaining(["date:2009", "number:1,240", "partner:Durham County Library", "credential:certified"]));
    expect(claims.flags.every((f: any) => f.status === "open" && f.reason.length > 10 && f.method === "Rule check (no AI)")).toBe(true);
    expect(ws.compliance.checks.find((c: any) => c.id === "claims_supported")).toMatchObject({ ok: false });

    // The server refuses approval while any flag is open, and lists them.
    const refused = await api("POST", `/grants/sections/${section.id}/approve`);
    expect(refused.status).toBe(409);
    expect(refused.data.error).toMatch(/unsupported claims are open/);
    expect(refused.data.openClaims.length).toBe(claims.open);
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.sections.find((s: any) => s.id === section.id).status).not.toBe("approved");
    expect(ws.approvals.filter((a: any) => a.subjectId === section.id)).toEqual([]);

    const flag = (kind: string) => claims.flags.find((f: any) => f.kind === kind && f.status === "open");

    // Link: only a confirmed fact from this organization's library.
    const unconfirmed = await api("POST", `/grants/applicants/${applicantId}/facts`, { category: "history", label: "Founding", body: "Founded in 2009 in Durham, NC.", source: "Articles of incorporation" });
    expect((await api("POST", `/grants/claim-flags/${flag("date").id}/resolve`, { action: "link", factId: unconfirmed.data.id })).status).toBe(400);
    const otherOrg = await other("POST", "/grants/applicants", { name: "Other Org", applicantType: "nonprofit_501c3" });
    const foreignFact = await other("POST", `/grants/applicants/${otherOrg.data.id}/facts`, { category: "history", label: "Founding", body: "Founded in 2009.", confirmed: true });
    expect((await api("POST", `/grants/claim-flags/${flag("date").id}/resolve`, { action: "link", factId: foreignFact.data.id })).status).toBe(400);
    const reach = await api("POST", `/grants/applicants/${applicantId}/facts`, { category: "programs", label: "Students served", body: "We served 1,240 students in the 2025-26 school year.", source: "Attendance records", confirmed: true });
    const linked = await api("POST", `/grants/claim-flags/${flag("date").id}/resolve`, { action: "link", factId: reach.data.id });
    expect(linked.status).toBe(200);
    expect(linked.data.claims.flags.find((f: any) => f.kind === "date")).toMatchObject({ status: "resolved", resolution: "linked", factId: reach.data.id });
    claims = linked.data.claims;
    // The confirmed fact backs 1,240 on its own: the rules close that flag as now supported.
    expect(claims.flags.find((f: any) => f.claim === "1,240")).toMatchObject({ status: "resolved", resolution: "now_supported" });

    // Dismiss: needs a recorded reason.
    expect((await api("POST", `/grants/claim-flags/${flag("credential").id}/resolve`, { action: "dismiss", reason: "fine" })).status).toBe(400);
    expect((await api("POST", `/grants/claim-flags/${flag("credential").id}/resolve`, { action: "approve" })).status).toBe(400);
    const dismissed = await api("POST", `/grants/claim-flags/${flag("credential").id}/resolve`, { action: "dismiss", reason: "Each tutor holds a state reading certification; copies are in the HR file." });
    expect(dismissed.data.claims.flags.find((f: any) => f.kind === "credential")).toMatchObject({ status: "resolved", resolution: "dismissed", dismissReason: expect.stringContaining("HR file"), resolvedBy: expect.any(String) });
    expect((await api("POST", `/grants/claim-flags/${flag("credential").id}/resolve`, { action: "dismiss", reason: "Twice is not allowed here." })).status).toBe(409);

    // Edit: taking the claim out of the text closes its flag.
    expect((await api("POST", `/grants/sections/${section.id}/approve`)).status).toBe(409);
    await api("PATCH", `/grants/sections/${section.id}`, { content: "<p>Founded in 2009, we served 1,240 students last year.</p><p>We work with our local library.</p><p>Our tutors are certified reading specialists.</p>" });
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    claims = ws.sections.find((s: any) => s.id === section.id).claims;
    expect(claims.flags.find((f: any) => f.kind === "partner")).toMatchObject({ status: "resolved", resolution: "edited" });
    expect(claims.flags.find((f: any) => f.kind === "credential")).toMatchObject({ status: "resolved", resolution: "dismissed" });
    expect(claims.open).toBe(0);

    // Another workspace cannot see, check, resolve or reopen these flags.
    const anyFlag = claims.flags[0];
    expect((await other("POST", `/grants/claim-flags/${anyFlag.id}/reopen`)).status).toBe(404);
    expect((await other("POST", `/grants/claim-flags/${flag("credential")?.id ?? anyFlag.id}/resolve`, { action: "dismiss", reason: "Not my organization at all." })).status).toBe(404);
    expect((await other("POST", `/grants/sections/${section.id}/claims/check`)).status).toBe(404);
    expect((await other("POST", `/grants/sections/${section.id}/approve`)).status).toBe(404);

    // With every flag resolved, a person approves; nothing is approved automatically.
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.sections.find((s: any) => s.id === section.id).status).not.toBe("approved");
    const approved = await api("POST", `/grants/sections/${section.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.data.status).toBe("approved");

    // A resolved flag on an approved section cannot be reopened until the section is.
    const dismissedFlag = claims.flags.find((f: any) => f.resolution === "dismissed");
    expect((await api("POST", `/grants/claim-flags/${dismissedFlag.id}/reopen`)).status).toBe(409);

    // Withdrawing the linked fact's confirmation reopens the flag, and the package check fails again.
    await api("PATCH", `/grants/facts/${reach.data.id}`, { confirmed: false });
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    claims = ws.sections.find((s: any) => s.id === section.id).claims;
    expect(claims.flags.find((f: any) => f.kind === "date")).toMatchObject({ status: "open", reason: expect.stringContaining("no longer confirmed") });
    expect(ws.compliance.checks.find((c: any) => c.id === "claims_supported").ok).toBe(false);

    // Re-checking on demand works for the owner; rows stay with this application.
    const rechecked = await api("POST", `/grants/sections/${section.id}/claims/check`);
    expect(rechecked.status).toBe(200);
    expect(rechecked.data.claims.open).toBeGreaterThan(0);
    const rows = await db.select().from(grantClaimFlagsTable).where(eq(grantClaimFlagsTable.sectionId, section.id));
    expect(rows.every((r) => r.applicationId === appId)).toBe(true);
  }, 60_000);
});

describe("forms and claim routes by role", () => {
  type Api = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;
  const STAMP = Date.now();
  const WS_NAME = `Forms roles workspace ${STAMP}`;
  const email = (role: string) => `${role}-${STAMP}@forms.example`;
  let fullServer: Server;
  let fullBase = "";
  const people: Record<string, Api> = {};

  function person(): Api {
    let cookie = "";
    return async (method, path, body) => {
      const res = await fetch(`${fullBase}/api${path}`, {
        method,
        headers: { "X-Forwarded-For": "198.51.100.36", ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  }

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", "loopback");
    app.use(express.json());
    app.use(session({ secret: "forms-roles-secret", resave: false, saveUninitialized: false, name: "sid" }));
    app.use("/api", fullRouter);
    fullServer = app.listen(0);
    fullBase = `http://127.0.0.1:${(fullServer.address() as AddressInfo).port}`;
    const operator = person();
    await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
    const created = await operator("POST", "/workspaces", { name: WS_NAME, ownerEmail: email("owner") });
    const owner = person();
    await owner("POST", `/auth/invites/${created.data.invitePath.replace("/invite/", "")}/accept`, { name: "Nora Owner", password: "Forms roles are separated 7" });
    for (const role of ["writer", "reviewer", "viewer"]) {
      const invite = await owner("POST", "/workspace/invites", { email: email(role), role });
      const p = person();
      await p("POST", `/auth/invites/${invite.data.invitePath.replace("/invite/", "")}/accept`, { name: `Test ${role}`, password: "Forms roles are separated 7" });
      people[role] = p;
    }
  }, 60_000);

  afterAll(async () => {
    fullServer?.close();
    const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, WS_NAME));
    await db.delete(membersTable).where(like(membersTable.email, `%-${STAMP}@forms.example`));
    if (ws.length) {
      await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, ws.map((w) => w.principalUserId)));
      await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
      await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
    }
  });

  it("lets writers fill forms; writers and reviewers resolve flags and mark forms reviewed; viewers only read", async () => {
    const writes = [
      ["PUT", "/grants/applications/missing/forms/sf424", "write"],
      ["POST", "/grants/applications/missing/forms/sflll/applicability", "write"],
      ["POST", "/grants/applications/missing/forms/sf424/review", "review"],
      ["POST", "/grants/sections/missing/claims/check", "review"],
      ["POST", "/grants/claim-flags/missing/resolve", "review"],
      ["POST", "/grants/claim-flags/missing/reopen", "review"],
    ] as const;
    for (const role of ["writer", "reviewer", "viewer"]) {
      for (const [method, path, kind] of writes) {
        const allowed = role === "writer" || (role === "reviewer" && kind === "review");
        const res = await people[role](method, path, {});
        if (allowed) expect(res.status, `${role} ${method} ${path}`).toBe(404);
        else {
          expect(res.status, `${role} ${method} ${path}`).toBe(403);
          expect(res.data.code).toBe("forbidden_by_role");
        }
      }
      // Every role reads the forms (404 here: the application does not exist).
      expect((await people[role]("GET", "/grants/applications/missing/forms")).status, `${role} read`).toBe(404);
    }
  });
});
