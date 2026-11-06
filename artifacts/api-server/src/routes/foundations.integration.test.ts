/**
 * Foundations end to end, against the real test database: the import job
 * reads the committed synthetic funder-graph fixture (every name, EIN and
 * amount invented) into per-funder aggregates, then the routes search funders,
 * read a profile with its source and label, and suggest funders for an
 * organization. Sign-in is required, suggestions are only for the workspace
 * that owns the organization, and only an admin-unlocked owner or admin can
 * queue an import.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { db, foundationFundersTable, foundationImportRunsTable, grantApplicantsTable, jobsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import foundationsRouter from "./foundations";
import { runFoundationImport } from "../lib/foundations/importer";
import { FOUNDATION_IMPORT_KEY } from "../lib/jobs/definitions";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../lib/foundations/__fixtures__/funder-graph");
const OWNER = `fdn-owner-${randomUUID()}`;
const OTHER = `fdn-other-${randomUUID()}`;
const ALDER = "000000101";
const BIRCH = "000000202";
let server: Server;
let base = "";
let orgId = "";

function client(userId: string | null, opts: { role?: string; admin?: boolean } = {}) {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    if (userId && !cookie) {
      const res = await fetch(`${base}/test/login-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, ...opts }) });
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    }
    const res = await fetch(`${base}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, data: (await res.json().catch(() => null)) as any };
  };
}

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: OWNER, username: `fdn-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `fdn-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "foundations-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.post("/test/login-as", (req, res) => {
    const body = req.body as { userId: string; role?: string; admin?: boolean };
    req.session.userId = body.userId;
    req.session.authenticated = true;
    if (body.role) req.session.role = body.role;
    req.session.isAdmin = body.admin === true;
    res.json({ ok: true });
  });
  app.use("/api", requireAuth, requirePermission, foundationsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(jobsTable).where(eq(jobsTable.dedupeKey, FOUNDATION_IMPORT_KEY));
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
  await db.delete(foundationFundersTable).where(inArray(foundationFundersTable.ein, [ALDER, BIRCH]));
});

describe("foundation giving history", () => {
  it("adds no new funder below the minimum giving setting", async () => {
    const result = await runFoundationImport({ config: { baseUrl: FIXTURE, years: [2024, 2025], minNewFunderUsd: 1_000_000_000 } });
    expect(result.stats).toMatchObject({ funders_below_minimum: 3 });
    expect(await db.select().from(foundationFundersTable).where(inArray(foundationFundersTable.ein, [ALDER, BIRCH]))).toEqual([]);
  });

  it("imports the fixture into aggregates, and a second run counts nothing twice", async () => {
    const config = { baseUrl: FIXTURE, years: [2024, 2025, 2026], windowRows: 1000, batchFunders: 10 };
    const progress: unknown[] = [];
    const first = await runFoundationImport({ config, onProgress: (p) => void progress.push(p) });
    expect(first).toMatchObject({ status: "succeeded", yearsDone: [2025, 2024], missingYears: [2026] });
    expect(first.stats).toMatchObject({ read: 13, kept: 9, individual: 1, not_paid: 1, no_amount: 1, other_form: 1, filings_counted: 4, filings_superseded: 1 });
    expect(first.note).toMatch(/2026/);
    expect(progress.length).toBeGreaterThan(0);
    const [run] = await db.select().from(foundationImportRunsTable).where(eq(foundationImportRunsTable.id, first.runId));
    expect(run).toMatchObject({ status: "succeeded", minConfidence: 0.9, baseUrl: FIXTURE });
    expect(run.bytesUsed).toBeGreaterThan(0);

    const [alder] = await db.select().from(foundationFundersTable).where(eq(foundationFundersTable.ein, ALDER));
    expect(Number(alder.totalPaidUsd)).toBe(267500);

    const second = await runFoundationImport({ config });
    expect(second.stats).toMatchObject({ filings_counted: 0, filings_already_counted: 4 });
    const [again] = await db.select().from(foundationFundersTable).where(eq(foundationFundersTable.ein, ALDER));
    expect(Number(again.totalPaidUsd)).toBe(267500);
  });

  it("stops at the storage budget with a partial result", async () => {
    const result = await runFoundationImport({ config: { baseUrl: FIXTURE, years: [2024], maxDbBytes: 1, batchFunders: 10 } });
    expect(result.status).toBe("partial");
    expect(result.note).toMatch(/storage budget/);
  });

  it("fails, and records why, when no year can be read", async () => {
    await expect(runFoundationImport({ config: { baseUrl: join(FIXTURE, "missing"), years: [2024] } })).rejects.toThrow(/No filing year could be read/);
    const [run] = await db.select().from(foundationImportRunsTable).where(eq(foundationImportRunsTable.baseUrl, join(FIXTURE, "missing")));
    expect(run).toMatchObject({ status: "failed" });
  });

  it("requires sign-in", async () => {
    const anon = client(null);
    expect((await anon("GET", "/grants/foundations")).status).toBe(401);
    expect((await anon("GET", `/grants/foundations/${ALDER}`)).status).toBe(401);
    expect((await anon("POST", "/grants/foundations/import")).status).toBe(401);
  });

  it("searches funders by name, state, giving state and cause, each labelled as history", async () => {
    const api = client(OWNER);
    const byName = (await api("GET", "/grants/foundations?q=alder synthetic")).data;
    expect(byName.label).toBe("Funding history from tax filings, not an open call");
    expect(byName.funders.map((f: any) => f.ein)).toEqual([ALDER]);
    expect(byName.funders[0]).toMatchObject({ einFormatted: "00-0000101", totalPaidUsd: 267500, label: "Funding history from tax filings, not an open call" });

    const givesInCa = (await api("GET", "/grants/foundations?givesIn=CA&q=synthetic")).data;
    expect(givesInCa.funders.map((f: any) => f.ein)).toEqual([BIRCH]);
    const env = (await api("GET", "/grants/foundations?cause=C&q=synthetic")).data;
    expect(env.funders.map((f: any) => f.ein)).toEqual([BIRCH]);
    const basedNc = (await api("GET", "/grants/foundations?state=NC&q=synthetic")).data;
    expect(basedNc.funders.map((f: any) => f.ein)).toEqual([ALDER]);
    // LIKE wildcards in the search are literal.
    expect((await api("GET", "/grants/foundations?q=%25")).data.total).toBe(0);
    expect((await api("GET", "/grants/foundations?state=North")).status).toBe(400);
    expect((await api("GET", "/grants/foundations?cause=Z")).status).toBe(400);
  });

  it("reads a profile with its source, filing and label", async () => {
    const api = client(OWNER);
    const res = await api("GET", "/grants/foundations/00-0000101");
    expect(res.status).toBe(200);
    const p = res.data;
    expect(p.label).toBe("Funding history from tax filings, not an open call");
    expect(p.source).toMatchObject({ name: "funder-graph", latestTaxYear: 2024, latestTaxPeriodEnd: "2024-12-31", filing: { objectId: "OBJ-A-2024" } });
    expect(p.source.license).toMatch(/not been reviewed/);
    expect(p.givingByYear).toEqual([{ year: 2024, usd: 120000 }, { year: 2023, usd: 95000 }, { year: 2022, usd: 52500 }]);
    expect(p.givingByState[0]).toMatchObject({ key: "NC", usd: 265000 });
    expect(p.givingByCause[0]).toMatchObject({ key: "B", label: "Education" });
    expect(p.grantSize).toMatchObject({ count: 5, min: 2500, max: 120000 });
    expect(p.recentGrants[0]).toMatchObject({ recipientName: "PIEDMONT SYNTHETIC LITERACY COUNCIL", amountUsd: 120000, taxYear: 2024, objectId: "OBJ-A-2024", recipientEin: "90-0000001" });
    expect(p.filings.map((f: any) => f.objectId)).toEqual(["OBJ-A-2024", "OBJ-A-2023-AMEND", "OBJ-A-2022"]);
    // No individual is ever listed.
    expect(JSON.stringify(p)).not.toContain("SYNTHETIC PERSON ONE");
    expect((await api("GET", "/grants/foundations/999999999")).status).toBe(404);
    expect((await api("GET", "/grants/foundations/not-an-ein")).status).toBe(404);
    expect((await api("GET", "/grants/foundations/meta")).data).toMatchObject({ label: "Funding history from tax filings, not an open call", lastImport: { minConfidence: 0.9 } });
  });

  it("suggests funders for the workspace's own organization, with reasons, and hides it from others", async () => {
    const [org] = await db
      .insert(grantApplicantsTable)
      .values({ id: randomUUID(), userId: OWNER, name: "Synthetic Readers (test)", applicantType: "nonprofit_501c3", state: "NC", focusAreas: ["literacy"], mission: "Every reader at grade level." })
      .returning();
    orgId = org.id;
    const api = client(OWNER);
    const res = await api("GET", `/grants/applicants/${orgId}/foundation-suggestions`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ label: "Funding history from tax filings, not an open call", state: "NC" });
    expect(res.data.note).toMatch(/not an eligibility decision and not an open call/);
    expect(res.data.causes.map((c: any) => c.key)).toEqual(["B"]);
    const alder = res.data.suggestions.find((s: any) => s.ein === ALDER);
    expect(alder.reasons[0]).toMatch(/^Paid \$265,000 to recipients in NC/);
    expect(alder.reasons.some((r: string) => /education recipients/.test(r))).toBe(true);
    // Birch gave in NC only to an unknown-type recipient for museum programs: not an education funder.
    expect(res.data.suggestions.find((s: any) => s.ein === BIRCH)).toBeUndefined();

    // Another workspace cannot read this organization's suggestions.
    expect((await client(OTHER)("GET", `/grants/applicants/${orgId}/foundation-suggestions`)).status).toBe(404);

    await db.update(grantApplicantsTable).set({ state: null }).where(eq(grantApplicantsTable.id, orgId));
    const noState = (await api("GET", `/grants/applicants/${orgId}/foundation-suggestions`)).data;
    expect(noState.suggestions).toEqual([]);
    expect(noState.missing).toMatch(/state/);
  });

  it("lets only an admin-unlocked owner or admin queue an import, one at a time", async () => {
    expect((await client(OWNER, { role: "viewer", admin: true })("POST", "/grants/foundations/import")).data).toMatchObject({ code: "forbidden_by_role", needs: "workspace.configure" });
    expect((await client(OWNER, { role: "writer", admin: true })("POST", "/grants/foundations/import")).status).toBe(403);
    expect((await client(OWNER)("POST", "/grants/foundations/import")).status).toBe(403);
    const admin = client(OWNER, { admin: true });
    // Off until the owner turns it on.
    const off = await admin("POST", "/grants/foundations/import");
    expect(off.status).toBe(409);
    expect(off.data.error).toMatch(/FOUNDATIONS_IMPORT_ENABLED/);
    process.env.FOUNDATIONS_IMPORT_ENABLED = "true";
    const first = await admin("POST", "/grants/foundations/import");
    expect(first.status).toBe(202);
    expect(first.data.status).toBe("queued");
    const second = await admin("POST", "/grants/foundations/import");
    expect(second.data.jobId).toBe(first.data.jobId);
    const meta = (await admin("GET", "/grants/foundations/meta")).data;
    expect(meta.importJob).toMatchObject({ id: first.data.jobId, status: "queued" });
    delete process.env.FOUNDATIONS_IMPORT_ENABLED;
  });

  it("refuses to run the job while the import is off", async () => {
    delete process.env.FOUNDATIONS_IMPORT_ENABLED;
    const { foundationImportJob } = await import("../lib/jobs/definitions");
    const ctx = { jobId: "x", payload: {}, attempt: 1, signal: new AbortController().signal, progress: async () => {} };
    await expect(foundationImportJob.run(ctx)).rejects.toMatchObject({ permanent: true });
  });
});
