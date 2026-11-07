/**
 * Onboarding from EIN to first match, against the real test database and the
 * real router (docs/SELF_SIGNUP.md §4). ProPublica is answered by a synthetic
 * fixture in the documented response shape; every name, EIN and opportunity is
 * invented.
 *
 * The happy path is timed from the sign-up request to the first match: the
 * product goal is under 5 minutes for a person, and the server's share must be
 * a small fraction of that.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import { db, grantFactsTable, grantOpportunitiesTable, membersTable, membershipsTable, nonprofitLookupsTable, pendingSignupsTable, usersTable, workspacesTable } from "@workspace/db";
import { router } from "./index";
import { setEmailTransportForTests, type EmailMessage } from "../lib/email/transport";
import { setNonprofitFetchForTests } from "../lib/onboarding/propublica";
import { hashPassword } from "../lib/password";
import { invalidateMembershipCache } from "../middleware/requireAuth";

let server: Server;
let base = "";
const PASSWORD = "Correct horse battery staple 42";
const STAMP = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DOMAIN = `onboarding-${STAMP}.example`;
/** A word no other suite uses, so these synthetic opportunities never change another suite's matches. */
const TOPIC = "quillmoor";
const outbox: EmailMessage[] = [];
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "onboarding", "__fixtures__", "propublica-organization.json"), "utf8"));
/** Synthetic EINs for this run (the fixture's EIN is rewritten to each), so cached rows never collide across runs. */
const einFor = (n: number) => `9${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${n}${n}`.slice(0, 9);
const FOUND_EIN = einFor(1);
const UNKNOWN_EIN = einFor(2);
const DOWN_EIN = einFor(3);
const OPP_FEDERAL = `onb-fed-${STAMP}`;
const OPP_STATE = `onb-nc-${STAMP}`;
const OPP_OTHER_STATE = `onb-ca-${STAMP}`;
let fetches: string[] = [];
const freshAddress = () => `198.19.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
const savedEnv = { SELF_SIGNUP_ENABLED: process.env.SELF_SIGNUP_ENABLED, APP_BASE_URL: process.env.APP_BASE_URL };

function buildApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "onboarding-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  return app;
}

function person(address = freshAddress()) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "X-Forwarded-For": address, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data: data as any };
  };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function opportunity(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    source: "grants_gov",
    sourceRef: `test-${id}`,
    title: "Synthetic opportunity",
    agency: "Synthetic Agency",
    status: "posted",
    closeDate: inDays(45),
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

/** Signs up, opens the emailed link, and returns the signed-in owner. */
async function newOwner(label: string) {
  const email = `${label}@${DOMAIN}`;
  const owner = person();
  const sent = await owner("POST", "/auth/signup", { name: `${label} Synthetic`, organizationName: `Onboarding ${label} ${STAMP}`, email, password: PASSWORD });
  expect(sent.status).toBe(202);
  const message = [...outbox].reverse().find((m) => m.to === email)!;
  const token = /#token=([A-Za-z0-9_-]+)/.exec(message.text)![1];
  const done = await owner("POST", "/auth/signup/verify", { token });
  expect(done.status).toBe(201);
  return { owner, email, workspaceId: done.data.workspace.id as string };
}

beforeAll(async () => {
  process.env.SELF_SIGNUP_ENABLED = "true";
  process.env.APP_BASE_URL = "https://grantcrest.test";
  setEmailTransportForTests({ name: "test", send: async (m) => void outbox.push(m) });
  await db.insert(grantOpportunitiesTable).values([
    opportunity(OPP_FEDERAL, { title: `Federal ${TOPIC} literacy program`, description: `Supports ${TOPIC} literacy for youth.`, awardFloor: 50000, awardCeiling: 250000 }),
    opportunity(OPP_STATE, { source: "nc_test", title: `North Carolina ${TOPIC} literacy grants`, description: `State funds for ${TOPIC} literacy.`, jurisdiction: "NC", awardCeiling: 75000 }),
    opportunity(OPP_OTHER_STATE, { source: "ca_test", title: `California ${TOPIC} literacy grants`, description: `State funds for ${TOPIC} literacy.`, jurisdiction: "CA", awardCeiling: 75000 }),
  ]);
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  setNonprofitFetchForTests(null);
});

afterAll(async () => {
  server?.close();
  setEmailTransportForTests(null);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [OPP_FEDERAL, OPP_STATE, OPP_OTHER_STATE]));
  await db.delete(nonprofitLookupsTable).where(inArray(nonprofitLookupsTable.ein, [FOUND_EIN, UNKNOWN_EIN, DOWN_EIN]));
  await db.delete(pendingSignupsTable).where(like(pendingSignupsTable.email, `%@${DOMAIN}`));
  const members = await db.select().from(membersTable).where(like(membersTable.email, `%@${DOMAIN}`));
  if (members.length) await db.delete(membersTable).where(inArray(membersTable.id, members.map((m) => m.id)));
  const ws = await db.select().from(workspacesTable).where(like(workspacesTable.name, `%${STAMP}%`));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

/** ProPublica stand-in: the fixture for FOUND_EIN, 404 for UNKNOWN_EIN, no network for DOWN_EIN. */
function propublica() {
  fetches = [];
  setNonprofitFetchForTests(async (url) => {
    fetches.push(url);
    if (url.endsWith(`/${FOUND_EIN}.json`)) return { status: 200, ok: true, json: async () => ({ ...fixture, organization: { ...fixture.organization, ein: Number(FOUND_EIN) } }) };
    if (url.endsWith(`/${DOWN_EIN}.json`)) throw new Error("ECONNRESET");
    return { status: 404, ok: false, json: async () => ({}) };
  });
}

describe("onboarding: from EIN to first match", () => {
  it("a new organization reaches its first match well under 5 minutes", async () => {
    propublica();
    const started = performance.now();
    const { owner } = await newOwner("happy");

    const checklist = (await owner("GET", "/onboarding")).data;
    expect(checklist.steps.map((s: any) => [s.key, s.done])).toEqual([["organization", false], ["matches", false], ["application", false], ["team", false]]);
    expect(checklist.dismissed).toBe(false);
    expect(checklist.lookup.source.name).toBe("ProPublica Nonprofit Explorer API v2");

    const found = await owner("GET", `/onboarding/lookup/${FOUND_EIN.slice(0, 2)}-${FOUND_EIN.slice(2)}`);
    expect(found.status).toBe(200);
    expect(found.data).toMatchObject({
      status: "found",
      ein: FOUND_EIN,
      cached: false,
      prefill: { name: "Piedmont Synthetic Literacy Council Inc", state: "NC", principalAddress: "100 Example St, Durham, NC 27701-0000", ntee: "B92 (Education)", revenue: 412500, revenueBand: "$250,000 to $999,999", revenueYear: 2023, applicantType: "nonprofit_501c3", subsection: "501(c)(3)" },
    });
    expect(found.data.suggestedFocusAreas.slice(0, 2)).toEqual(["education", "literacy"]);

    const created = await owner("POST", "/onboarding/organization", {
      applicantType: "nonprofit_501c3",
      ein: FOUND_EIN,
      name: found.data.prefill.name,
      state: "NC",
      principalAddress: found.data.prefill.principalAddress,
      annualBudget: 412500,
      focusAreas: [`${TOPIC} literacy`, "education"],
      confirmations: { name: true, address: true, state: true, ntee: true, revenue: true, subsection: true },
    });
    expect(created.status).toBe(201);
    expect(created.data.facts).toEqual({ confirmed: 6, unconfirmed: 0 });
    const id = created.data.applicant.id;

    const matches = await owner("GET", `/grants/applicants/${id}/matches?relevantOnly=1&limit=5`);
    expect(matches.status).toBe(200);
    const elapsedMs = performance.now() - started;
    const ids = matches.data.matches.map((m: any) => m.opportunity.id);
    // Federal and the organization's own state; never another state's program.
    expect(ids).toEqual(expect.arrayContaining([OPP_FEDERAL, OPP_STATE]));
    expect(ids).not.toContain(OPP_OTHER_STATE);
    expect(matches.data.matches[0].match.reasons.join(" ")).toMatch(/focus area/i);
    console.info(`[onboarding timing] sign-up to first match through the API: ${Math.round(elapsedMs)} ms`);
    expect(elapsedMs).toBeLessThan(30_000);

    // Foundation suggestions use the same profile; labelled as history, never an open call.
    const suggestions = (await owner("GET", `/grants/applicants/${id}/foundation-suggestions`)).data;
    expect(suggestions.label).toMatch(/not an open call/i);
    expect(suggestions.note).toMatch(/not an eligibility decision/i);

    expect((await owner("POST", `/grants/applicants/${id}/matches/seen`, {})).status).toBe(200);
    const after = (await owner("GET", "/onboarding")).data;
    expect(after.steps.filter((s: any) => s.done).map((s: any) => s.key)).toEqual(["organization", "matches"]);
    expect(after.steps[1].href).toBe(`/grant-studio/organizations/${id}`);

    // The profile and its facts, with their source.
    const facts = (await owner("GET", `/grants/applicants/${id}/facts`)).data.facts;
    expect(facts).toHaveLength(6);
    expect(facts.every((f: any) => f.confirmed && f.source.includes("ProPublica Nonprofit Explorer API v2") && f.source.includes(FOUND_EIN.slice(2)))).toBe(true);
    const profile = (await owner("GET", `/grants/applicants/${id}`)).data;
    expect(profile).toMatchObject({ state: "NC", annualBudget: 412500, ein: `${FOUND_EIN.slice(0, 2)}-${FOUND_EIN.slice(2)}` });

    // A second lookup of the same EIN is served from the cache.
    const again = await owner("GET", `/onboarding/lookup/${FOUND_EIN}`);
    expect(again.data.cached).toBe(true);
    expect(fetches).toHaveLength(1);
  });

  it("never writes a value the person did not confirm, and keeps it as an unconfirmed fact", async () => {
    propublica();
    const { owner } = await newOwner("partial");
    await owner("GET", `/onboarding/lookup/${FOUND_EIN}`);
    // Name confirmed; state, address and revenue sent as the records state them but not confirmed.
    const created = await owner("POST", "/onboarding/organization", {
      applicantType: "nonprofit_501c3",
      ein: FOUND_EIN,
      name: "Piedmont Synthetic Literacy Council Inc",
      state: "NC",
      principalAddress: "100 Example St, Durham, NC 27701-0000",
      annualBudget: 412500,
      confirmations: { name: true },
    });
    expect(created.status).toBe(201);
    expect(created.data.facts).toEqual({ confirmed: 1, unconfirmed: 5 });
    const profile = (await owner("GET", `/grants/applicants/${created.data.applicant.id}`)).data;
    expect(profile).toMatchObject({ state: null, principalAddress: null, annualBudget: null });
    const [stateFact] = await db.select().from(grantFactsTable).where(eq(grantFactsTable.label, "State on IRS records"));
    expect(stateFact).toBeTruthy();

    // An unconfirmed name cannot be used at all.
    const refused = await owner("POST", "/onboarding/organization", { applicantType: "nonprofit_501c3", ein: FOUND_EIN, name: "Piedmont Synthetic Literacy Council Inc" });
    expect(refused.status).toBe(400);
    expect(refused.data.error).toMatch(/Confirm the organization's name/);

    // A corrected value is the person's own: it is used, and the records' value stays unconfirmed.
    const corrected = await owner("POST", "/onboarding/organization", { applicantType: "nonprofit_501c3", ein: FOUND_EIN, name: "Piedmont Literacy Council", state: "VA" });
    expect(corrected.status).toBe(201);
    expect(corrected.data.applicant).toMatchObject({ name: "Piedmont Literacy Council", state: "VA" });
    expect(corrected.data.facts.confirmed).toBe(0);
  });

  it("handles an unknown EIN, ProPublica being unreachable, and a malformed EIN", async () => {
    propublica();
    const { owner } = await newOwner("failures");
    const unknown = await owner("GET", `/onboarding/lookup/${UNKNOWN_EIN}`);
    expect(unknown.status).toBe(200);
    expect(unknown.data.status).toBe("not_found");
    expect(unknown.data.message).toMatch(/enter your details yourself/);
    // Unknown EINs are cached briefly.
    await owner("GET", `/onboarding/lookup/${UNKNOWN_EIN}`);
    expect(fetches.filter((u) => u.includes(UNKNOWN_EIN))).toHaveLength(1);

    const down = await owner("GET", `/onboarding/lookup/${DOWN_EIN}`);
    expect(down.data.status).toBe("unavailable");
    expect(down.data.message).toMatch(/could not be reached/);
    // A failure is never cached: the next try asks again.
    await owner("GET", `/onboarding/lookup/${DOWN_EIN}`);
    expect(fetches.filter((u) => u.includes(DOWN_EIN))).toHaveLength(2);
    expect(await db.select().from(nonprofitLookupsTable).where(eq(nonprofitLookupsTable.ein, DOWN_EIN))).toEqual([]);

    expect((await owner("GET", "/onboarding/lookup/12-345")).status).toBe(400);
    expect((await owner("POST", "/onboarding/organization", { applicantType: "nonprofit_501c3", name: "X", ein: "nope" })).status).toBe(400);
    expect((await owner("POST", "/onboarding/organization", { applicantType: "space_agency", name: "X" })).status).toBe(400);
    expect((await owner("POST", "/onboarding/organization", { applicantType: "small_business", name: "X", state: "North Carolina" })).status).toBe(400);
  });

  it("lets an organization without an EIN set up by hand and reach a match", async () => {
    const { owner } = await newOwner("manual");
    const created = await owner("POST", "/onboarding/organization", { applicantType: "nonprofit_501c3", name: `New Synthetic Readers ${STAMP}`, state: "nc", focusAreas: [`${TOPIC} literacy`], mission: "Brand-new nonprofit with no IRS record yet." });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ lookedUp: false, facts: { confirmed: 0, unconfirmed: 0 }, applicant: { state: "NC", ein: null } });
    const matches = (await owner("GET", `/grants/applicants/${created.data.applicant.id}/matches?relevantOnly=1`)).data;
    expect(matches.matches.map((m: any) => m.opportunity.id)).toContain(OPP_FEDERAL);
    // A business without an EIN too.
    expect((await owner("POST", "/onboarding/organization", { applicantType: "small_business", name: `Synthetic Widgets LLC ${STAMP}` })).status).toBe(201);
  });

  it("keeps every workspace's organizations and checklist to itself, and enforces roles", async () => {
    const a = await newOwner("tenant-a");
    const b = await newOwner("tenant-b");
    const org = (await a.owner("POST", "/onboarding/organization", { applicantType: "small_business", name: `Tenant A Org ${STAMP}` })).data.applicant;
    expect((await b.owner("GET", `/grants/applicants/${org.id}`)).status).toBe(404);
    expect((await b.owner("GET", `/grants/applicants/${org.id}/matches`)).status).toBe(404);
    expect((await b.owner("GET", "/onboarding")).data.organizations).toEqual([]);
    expect((await a.owner("GET", "/onboarding")).data.organizations.map((o: any) => o.id)).toEqual([org.id]);

    // A viewer in workspace A can read the checklist but cannot add an organization or hide the checklist.
    const viewerEmail = `viewer@${DOMAIN}`;
    const [viewer] = await db.insert(membersTable).values({ id: randomUUID(), email: viewerEmail, name: "Vera Viewer", passwordHash: await hashPassword(PASSWORD) }).returning();
    await db.insert(membershipsTable).values({ id: randomUUID(), memberId: viewer.id, workspaceId: a.workspaceId, role: "viewer" });
    invalidateMembershipCache(viewer.id);
    const v = person();
    expect((await v("POST", "/auth/login", { email: viewerEmail, password: PASSWORD })).status).toBe(200);
    expect((await v("GET", "/onboarding")).status).toBe(200);
    expect((await v("POST", "/onboarding/organization", { applicantType: "small_business", name: "Nope" })).status).toBe(403);
    expect((await v("PUT", "/onboarding/dismissed", { dismissed: true })).status).toBe(403);
    // The team step counts the second person.
    expect((await a.owner("GET", "/onboarding")).data.steps.find((s: any) => s.key === "team").done).toBe(true);
  });

  it("hides the checklist when asked and brings it back, while the wizard stays reachable", async () => {
    const { owner } = await newOwner("dismiss");
    expect((await owner("GET", "/auth/me")).data.workspace.firstRun).toBe(true);
    expect((await owner("PUT", "/onboarding/dismissed", { dismissed: "yes" })).status).toBe(400);
    expect((await owner("PUT", "/onboarding/dismissed", { dismissed: true })).data).toEqual({ dismissed: true });
    expect((await owner("GET", "/auth/me")).data.workspace.firstRun).toBe(false);
    expect((await owner("GET", "/onboarding")).data.dismissed).toBe(true);
    expect((await owner("PUT", "/onboarding/dismissed", { dismissed: false })).data).toEqual({ dismissed: false });
    expect((await owner("GET", "/auth/me")).data.workspace.firstRun).toBe(true);
  });

  it("is not a first run for operator-created workspaces", async () => {
    const operator = person();
    expect((await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD })).status).toBe(200);
    expect((await operator("GET", "/auth/me")).data.workspace.firstRun).toBe(false);
    expect((await operator("GET", "/onboarding")).status).toBe(200);
    expect((await person()("GET", "/onboarding")).status).toBe(401);
  });
});
