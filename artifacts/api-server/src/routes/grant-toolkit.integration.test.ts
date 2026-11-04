/**
 * Place designations and the writing toolkit against the real test database:
 * a person records designations and they reach matching and drafting; an
 * application's format profile, logic model and letters of support reach the
 * compliance checks and the exported file; another operator reaches none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { db, grantApplicantsTable, grantOpportunitiesTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import grantsRouter from "./grants";

const OWNER = `toolkit-owner-${randomUUID()}`;
const OTHER = `toolkit-other-${randomUUID()}`;
const OZ_OPP = randomUUID();
const PLAIN_OPP = randomUUID();

let server: Server;
let base = "";

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "toolkit-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
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
    sourceRef: `toolkit-${id}`,
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
    eligibilityCodes: ["23"],
    categories: [],
    assistanceListings: [],
    costSharing: false,
    ...overrides,
  };
}

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: OWNER, username: `tk-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `tk-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  await db.insert(grantOpportunitiesTable).values([
    opportunity(OZ_OPP, { title: "Main Street Growth Grants", description: "Priority points for small businesses located in a Qualified Opportunity Zone or a HUBZone.", awardCeiling: 50000 }),
    opportunity(PLAIN_OPP, { title: "Main Street Equipment Grants", description: "Equipment for small businesses.", awardCeiling: 50000 }),
  ]);
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [OZ_OPP, PLAIN_OPP]));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

describe("place designations", () => {
  it("records a person's finding, uses it in matching, and keeps it private", async () => {
    const api = client(await login(OWNER));
    const other = client(await login(OTHER));
    const created = await api("POST", "/grants/applicants", {
      name: "Main Street Bakery",
      applicantType: "small_business",
      state: "NC",
      principalAddress: "101 Main St, Durham, NC 27701",
      censusTract: "37063001503",
      countyFips: "37063",
    });
    expect(created.status).toBe(201);
    const id = created.data.id;
    expect(created.data.places.map((p: any) => p.key)).toEqual(["opportunity_zone", "hubzone", "qct", "dda", "persistent_poverty", "usda_rural"]);
    expect(created.data.places.every((p: any) => p.effectiveStatus === "unknown")).toBe(true);
    expect((await api("PATCH", `/grants/applicants/${id}`, { censusTract: "37063" })).status).toBe(400);
    expect((await api("PATCH", `/grants/applicants/${id}`, { countyFips: "3706" })).status).toBe(400);

    // Validation: a finding needs the date checked; geography matches the designation; no future dates.
    expect((await api("PUT", `/grants/applicants/${id}/places/opportunity_zone`, { status: "in" })).status).toBe(400);
    expect((await api("PUT", `/grants/applicants/${id}/places/opportunity_zone`, { status: "in", checkedOn: today(), geoRef: "37063" })).status).toBe(400);
    expect((await api("PUT", `/grants/applicants/${id}/places/opportunity_zone`, { status: "in", checkedOn: inDays(3) })).status).toBe(400);
    expect((await api("PUT", `/grants/applicants/${id}/places/opportunity_zone`, { status: "maybe", checkedOn: today() })).status).toBe(400);
    expect((await api("PUT", `/grants/applicants/${id}/places/enterprise_zone`, { status: "in", checkedOn: today() })).status).toBe(404);

    // Without a finding, the notice's mention is a gap.
    let matches = await api("GET", `/grants/applicants/${id}/matches`);
    const before = matches.data.matches.find((m: any) => m.opportunity.id === OZ_OPP).match;
    expect(before.placeKinds).toEqual(["opportunity_zone", "hubzone"]);
    expect(before.gaps.join(" ")).toMatch(/Record whether your location is in one/);

    const recorded = await api("PUT", `/grants/applicants/${id}/places/opportunity_zone`, { status: "in", place: "Principal office", geoRef: "37063001503", checkedOn: today(), note: "CDFI Fund list, 2018 designations" });
    expect(recorded.status).toBe(200);
    const oz = recorded.data.places.find((p: any) => p.key === "opportunity_zone");
    expect(oz).toMatchObject({ effectiveStatus: "in", needsRecheck: false, record: { status: "in", recordedBy: expect.any(String), geoRef: "37063001503" } });
    expect((await api("PUT", `/grants/applicants/${id}/places/hubzone`, { status: "not_in", checkedOn: today() })).status).toBe(200);

    matches = await api("GET", `/grants/applicants/${id}/matches`);
    const after = matches.data.matches.find((m: any) => m.opportunity.id === OZ_OPP).match;
    const plain = matches.data.matches.find((m: any) => m.opportunity.id === PLAIN_OPP).match;
    expect(after.score).toBe(before.score + 5);
    expect(after.reasons.join(" ")).toMatch(/Qualified Opportunity Zones, and you recorded that Principal office is in one/);
    expect(after.gaps.join(" ")).toMatch(/HUBZones; you recorded that your location is not in one/);
    expect(plain.placeKinds).toEqual([]);
    // On equal terms otherwise, the zone opportunity now ranks first.
    expect(matches.data.matches[0].opportunity.id).toBe(OZ_OPP);

    // Opportunity detail shows the same.
    const detail = await api("GET", `/grants/opportunities/${OZ_OPP}?applicantId=${id}`);
    expect(detail.data.match.placeKinds).toEqual(["opportunity_zone", "hubzone"]);

    // Clearing a finding removes it.
    const cleared = await api("PUT", `/grants/applicants/${id}/places/hubzone`, { status: "unknown" });
    expect(cleared.data.places.find((p: any) => p.key === "hubzone").record).toBeNull();

    // Another operator can neither read nor write it.
    expect((await other("PUT", `/grants/applicants/${id}/places/opportunity_zone`, { status: "not_in", checkedOn: today() })).status).toBe(404);
    expect((await other("GET", `/grants/applicants/${id}`)).status).toBe(404);
    const meta = await api("GET", "/grants/meta");
    expect(meta.data.placeDesignations).toHaveLength(6);
    expect(meta.data.placeDesignations[0].lookupUrl).toMatch(/^https:\/\//);
  });
});

describe("writing toolkit", () => {
  it("checks writing, fits the format, tracks letters and exports in the notice's format", async () => {
    const api = client(await login(OWNER));
    const other = client(await login(OTHER));
    const org = await api("POST", "/grants/applicants", { name: "Read & Rise Literacy", applicantType: "small_business", state: "NC" });
    const started = await api("POST", "/grants/applications", { applicantId: org.data.id, opportunityId: PLAIN_OPP, eligibilityConfirmed: true });
    expect(started.status).toBe(201);
    const appId = started.data.id;
    let ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.format).toMatchObject({ set: false, wordsPerPage: 500, profile: { font: "Times New Roman", sizePt: 12 } });
    expect(ws.compliance.checks.some((c: any) => c.id === "format")).toBe(false);
    expect(ws.logicModel.gaps.length).toBeGreaterThan(0);

    // Writing checks on a section: placeholders and objectives.
    const objectives = ws.sections.find((s: any) => s.key === "objectives") ?? ws.sections[0];
    const saved = await api("PATCH", `/grants/sections/${objectives.id}`, { content: "<ul><li>Improve literacy.</li><li>Enroll 120 youth by March 2027, up from 80 today.</li></ul><p>We serve [Add: county] families.</p>" });
    expect(saved.status).toBe(200);
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    const checked = ws.sections.find((s: any) => s.id === objectives.id);
    expect(checked.writingChecks.placeholders).toEqual(["[Add: county]"]);
    if (checked.key === "objectives") expect(checked.writingChecks.objectives[0].measurable).toBe(false);
    expect(ws.compliance.checks.find((c: any) => c.id === "no_placeholders").ok).toBe(false);

    // Format profile: validation, then page estimates follow it.
    expect((await api("PATCH", `/grants/applications/${appId}`, { formatProfile: { font: "Comic Sans" } })).status).toBe(400);
    expect((await api("PATCH", `/grants/applications/${appId}`, { formatProfile: { fileName: "Narrative/Final.pdf" } })).status).toBe(400);
    ws = (await api("PATCH", `/grants/applications/${appId}`, { formatProfile: { font: "Arial", sizePt: 11, lineSpacing: 2, marginsIn: 1, pageLimit: 1, fileName: "ReadRise_Narrative" } })).data;
    expect(ws.format).toMatchObject({ set: true, profile: { font: "Arial", lineSpacing: 2, pageLimit: 1, fileName: "ReadRise_Narrative" } });
    expect(ws.format.wordsPerPage).toBeLessThan(300);
    await api("PATCH", `/grants/sections/${objectives.id}`, { content: `<p>${"word ".repeat(500)}</p>` });
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.compliance.checks.find((c: any) => c.id === "format")).toMatchObject({ ok: false, detail: expect.stringContaining("1-page limit") });
    ws = (await api("PATCH", `/grants/applications/${appId}`, { formatProfile: { font: "Arial", sizePt: 11, lineSpacing: 2, marginsIn: 1, pageLimit: 40, fileName: "ReadRise_Narrative" } })).data;
    expect(ws.compliance.checks.find((c: any) => c.id === "format").ok).toBe(true);

    // Logic model: saved, then inserted into a section, which reopens it.
    expect((await api("PATCH", `/grants/applications/${appId}`, { logicModel: { inputs: "tutors" } })).status).toBe(400);
    ws = (await api("PATCH", `/grants/applications/${appId}`, { logicModel: { inputs: ["Two tutors"], activities: ["Weekly sessions"], outputs: ["120 youth served"], shortTerm: ["80% gain one reading level"], longTerm: ["Grade-level readers"] } })).data;
    expect(ws.logicModel.gaps).toEqual([]);
    const target = ws.sections.find((s: any) => s.key === "logic_model") ?? ws.sections[1];
    await api("PATCH", `/grants/sections/${target.id}`, { content: "<p>Intro.</p>" });
    expect((await api("POST", `/grants/sections/${target.id}/approve`)).status).toBe(200);
    expect((await api("POST", `/grants/sections/${target.id}/insert-logic-model`, { mode: "append" })).status).toBe(409);
    await api("POST", `/grants/sections/${target.id}/reopen`);
    const inserted = await api("POST", `/grants/sections/${target.id}/insert-logic-model`, { mode: "append" });
    expect(inserted.status).toBe(200);
    expect(inserted.data.content).toBe("<p>Intro.</p><h3>Inputs</h3><ul><li>Two tutors</li></ul><h3>Activities</h3><ul><li>Weekly sessions</li></ul><h3>Outputs</h3><ul><li>120 youth served</li></ul><h3>Short-term outcomes</h3><ul><li>80% gain one reading level</li></ul><h3>Long-term impact</h3><ul><li>Grade-level readers</li></ul>");
    expect(inserted.data.status).toBe("drafting");
    expect((await api("POST", `/grants/sections/${target.id}/insert-logic-model`, { mode: "merge" })).status).toBe(400);

    // Letters of support: validation, status and the compliance check.
    expect((await api("POST", `/grants/applications/${appId}/letters`, { organization: "No name" })).status).toBe(400);
    expect((await api("POST", `/grants/applications/${appId}/letters`, { name: "Dr. Lee", email: "not-an-email" })).status).toBe(400);
    expect((await api("POST", `/grants/applications/${appId}/letters`, { name: "Dr. Lee", requirementId: randomUUID() })).status).toBe(400);
    const requirementId = ws.requirements[0].id;
    const letter = await api("POST", `/grants/applications/${appId}/letters`, { name: "Dr. Lee", organization: "Durham Public Schools", purpose: "Hosts sessions", email: "lee@example.org", status: "requested", dueOn: inDays(20), requirementId });
    expect(letter.status).toBe(201);
    expect(letter.data).toMatchObject({ status: "requested", requestedOn: today(), statusLabel: "Requested", requirementId });
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.letters).toHaveLength(1);
    expect(ws.compliance.checks.find((c: any) => c.id === "letters")).toMatchObject({ ok: false, detail: expect.stringContaining("Dr. Lee (Durham Public Schools)") });
    const received = await api("PATCH", `/grants/letters/${letter.data.id}`, { status: "received" });
    expect(received.data).toMatchObject({ status: "received", receivedOn: today() });
    ws = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(ws.compliance.checks.find((c: any) => c.id === "letters").ok).toBe(true);

    // Another operator cannot touch letters, the profile or the logic model.
    expect((await other("PATCH", `/grants/letters/${letter.data.id}`, { status: "declined" })).status).toBe(404);
    expect((await other("DELETE", `/grants/letters/${letter.data.id}`)).status).toBe(404);
    expect((await other("POST", `/grants/applications/${appId}/letters`, { name: "X" })).status).toBe(404);
    expect((await other("PATCH", `/grants/applications/${appId}`, { formatProfile: {} })).status).toBe(404);
    expect((await other("POST", `/grants/sections/${target.id}/insert-logic-model`, { mode: "replace" })).status).toBe(404);

    // The draft export uses a Grants.gov-safe default name.
    const draft = await api("GET", `/grants/applications/${appId}/package.docx?draft=1`);
    expect(draft.status).toBe(200);
    const name = /filename="([^"]+)"/.exec(draft.headers.get("content-disposition") ?? "")![1];
    expect(name).toMatch(/^[A-Za-z0-9_-]+_DRAFT\.docx$/);
    expect(name.length).toBeLessThanOrEqual(50);

    expect((await api("DELETE", `/grants/letters/${letter.data.id}`)).status).toBe(204);
    // Clearing the profile returns to the default and removes the format check.
    ws = (await api("PATCH", `/grants/applications/${appId}`, { formatProfile: null })).data;
    expect(ws.format.set).toBe(false);
    expect(ws.compliance.checks.some((c: any) => c.id === "format")).toBe(false);
  });
});
