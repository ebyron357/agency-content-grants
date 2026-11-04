/**
 * Application templates end to end, against the real test database: a
 * workspace duplicates a built-in template, edits it, and new applications
 * start from it (chosen automatically by its rules, or by hand). Editing it
 * later never changes an application already started; archived templates are
 * not offered; another workspace can neither see nor use it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, grantApplicantsTable, grantOpportunitiesTable, grantSectionsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import grantsRouter from "./grants";
import grantTemplatesRouter from "./grant-templates";

const OWNER = `tpl-owner-${randomUUID()}`;
const OTHER = `tpl-other-${randomUUID()}`;
const ARTS_OPP = randomUUID();
const PLAIN_OPP = randomUUID();
let server: Server;
let base = "";

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function opportunity(id: string, title: string) {
  return {
    id, source: "grants_gov", sourceRef: `test-${id}`, title, agency: "Test Agency", status: "posted", closeDate: inDays(60),
    officialUrl: `https://www.grants.gov/search-results-detail/${id}`, fetchedAt: new Date(), detailFetchedAt: new Date(), checksum: "seed",
    connectorVersion: "test", publishable: true, gateMissing: [], eligibilityCodes: ["12"], categories: [], assistanceListings: [], costSharing: false,
  };
}

function client(userId: string) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    if (!cookie) {
      const res = await fetch(`${base}/test/login-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    }
    const res = await fetch(`${base}/api${path}`, { method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, data: (await res.json().catch(() => null)) as any };
  };
}

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: OWNER, username: `tpl-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `tpl-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  await db.insert(grantOpportunitiesTable).values([opportunity(ARTS_OPP, "Community Arts Access"), opportunity(PLAIN_OPP, "Rural Literacy Support")]);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "template-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.post("/test/login-as", (req, res) => {
    req.session.userId = (req.body as any).userId;
    req.session.authenticated = true;
    res.json({ ok: true });
  });
  app.use("/api", requireAuth, grantTemplatesRouter, grantsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [ARTS_OPP, PLAIN_OPP]));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

describe("application templates", () => {
  it("lists built-in templates read only, and makes an editable copy", async () => {
    const api = client(OWNER);
    const list = (await api("GET", "/grants/templates")).data;
    expect(list.templates.filter((t: any) => t.builtIn).map((t: any) => t.key)).toEqual(["federal_nonprofit", "federal_business", "sbir_sttr", "state_nonprofit", "state_business"]);
    expect(list.options.requirementKinds).toContain("attachment");
    expect((await api("PUT", "/grants/templates/federal_nonprofit", {})).status).toBe(409);
    expect((await api("POST", "/grants/templates/federal_nonprofit/archive")).status).toBe(409);

    const copy = await api("POST", "/grants/templates/federal_nonprofit/duplicate", { label: "Arts council application" });
    expect(copy.status).toBe(201);
    expect(copy.data).toMatchObject({ key: expect.stringMatching(/^custom:/), label: "Arts council application", builtIn: false, basedOn: "federal_nonprofit", version: 1 });
    const builtIn = (await api("GET", "/grants/templates/federal_nonprofit")).data;
    expect(copy.data.sections.map((s: any) => s.key)).toEqual(builtIn.sections.map((s: any) => s.key));
  });

  it("validates edits, guards against overwriting, and is used for new applications", async () => {
    const api = client(OWNER);
    const key = (await api("GET", "/grants/templates")).data.templates.find((t: any) => t.label === "Arts council application").key;
    const t = (await api("GET", `/grants/templates/${key}`)).data;

    const bad = await api("PUT", `/grants/templates/${key}`, { ...t, sections: [...t.sections, { key: t.sections[0].key, title: "Second abstract", limitType: "words", limitValue: 10 }] });
    expect(bad.status).toBe(400);
    expect(bad.data.errors[0]).toMatch(/another section already uses the key/);

    const edited = {
      ...t,
      appliesTo: { applicantKind: "nonprofit", jurisdiction: "federal", titleIncludes: "arts" },
      sections: [{ title: "Artistic merit", guidance: "Describe the work and the artists.", limitType: "words", limitValue: 600 }, ...t.sections],
      requirements: [{ kind: "attachment", label: "Work samples", detail: "Up to 10 images", sectionKey: "artistic_merit" }, ...t.requirements],
      version: 1,
    };
    const saved = await api("PUT", `/grants/templates/${key}`, edited);
    expect(saved.status).toBe(200);
    expect(saved.data.version).toBe(2);
    // A save based on an older version is refused instead of overwriting.
    expect((await api("PUT", `/grants/templates/${key}`, { ...edited, version: 1 })).status).toBe(409);

    // The workspace's template is offered and chosen automatically when its rules fit.
    expect((await api("GET", "/grants/meta")).data.templates.map((x: any) => x.key)).toContain(key);
    const org = (await api("POST", "/grants/applicants", { name: "Riverbend Arts Collective", applicantType: "nonprofit_501c3" })).data;
    const arts = await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: ARTS_OPP, eligibilityConfirmed: true });
    expect(arts.status).toBe(201);
    const artsApp = (await api("GET", `/grants/applications/${arts.data.id}`)).data;
    expect(artsApp.application.template).toBe(key);
    expect(artsApp.templateLabel).toBe("Arts council application");
    expect(artsApp.sections[0]).toMatchObject({ key: "artistic_merit", title: "Artistic merit", limitValue: 600 });
    expect(artsApp.requirements.map((r: any) => r.label)).toContain("Work samples");
    // Its title rule does not fit this one, so the built-in choice applies.
    const plain = await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: PLAIN_OPP, eligibilityConfirmed: true });
    expect((await api("GET", `/grants/applications/${plain.data.id}`)).data.application.template).toBe("federal_nonprofit");

    // Editing the template later leaves the started application as it was.
    const current = (await api("GET", `/grants/templates/${key}`)).data;
    await api("PUT", `/grants/templates/${key}`, { ...current, sections: current.sections.slice(1), requirements: current.requirements.filter((r: any) => r.sectionKey !== "artistic_merit") });
    const sections = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.applicationId, arts.data.id));
    expect(sections.map((s) => s.key)).toContain("artistic_merit");

    // Archived templates are not offered and cannot be chosen.
    expect((await api("POST", `/grants/templates/${key}/archive`)).data.status).toBe("archived");
    expect((await api("GET", "/grants/meta")).data.templates.map((x: any) => x.key)).not.toContain(key);
    await api("DELETE", `/grants/applications/${plain.data.id}`);
    expect((await api("POST", "/grants/applications", { applicantId: org.id, opportunityId: PLAIN_OPP, eligibilityConfirmed: true, template: key })).status).toBe(400);
    expect((await api("POST", `/grants/templates/${key}/restore`)).data.status).toBe("active");
  });

  it("keeps each workspace's templates to itself", async () => {
    const owner = client(OWNER);
    const other = client(OTHER);
    const key = (await owner("GET", "/grants/templates")).data.templates.find((t: any) => !t.builtIn).key;
    expect((await other("GET", `/grants/templates/${key}`)).status).toBe(404);
    expect((await other("PUT", `/grants/templates/${key}`, {})).status).toBe(404);
    expect((await other("POST", `/grants/templates/${key}/duplicate`)).status).toBe(404);
    expect((await other("GET", "/grants/templates")).data.templates.every((t: any) => t.builtIn)).toBe(true);
    const org = (await other("POST", "/grants/applicants", { name: "Other org", applicantType: "nonprofit_501c3" })).data;
    expect((await other("POST", "/grants/applications", { applicantId: org.id, opportunityId: ARTS_OPP, eligibilityConfirmed: true, template: key })).status).toBe(400);
  });
});
