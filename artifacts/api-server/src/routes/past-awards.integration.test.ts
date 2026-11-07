/**
 * Past federal awards end to end, against the real test database and a local
 * stand-in for api.usaspending.gov that serves the synthetic fixtures (every
 * recipient, award id and amount invented; the real API is not reachable from
 * the build environment). The first view reads the listing through the
 * `usaspending_awards` job; later views read only the cache; an expired copy
 * is shown while a refresh is queued; an unreachable API is reported plainly
 * and keeps the last good copy; state programs and opportunities without a
 * listing say why there is nothing to show. In-state awards use only the
 * caller's own organization.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray, like } from "drizzle-orm";
import { db, grantApplicantsTable, grantOpportunitiesTable, jobsTable, usaspendingAwardCacheTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import pastAwardsRouter from "./past-awards";
import { prune } from "../lib/grants/pastAwards";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../lib/grants/__fixtures__/usaspending");
const AWARDS = readFileSync(join(DIR, "spending_by_award.json"), "utf8");
const COUNT = readFileSync(join(DIR, "spending_by_award_count.json"), "utf8");
const OWNER = `pa-owner-${randomUUID()}`;
const OTHER = `pa-other-${randomUUID()}`;
const FED = `pa-fed-${randomUUID()}`;
const STATE_OPP = `pa-state-${randomUUID()}`;
const NO_LISTING = `pa-none-${randomUUID()}`;
// Synthetic Assistance Listing numbers (the 99. prefix is not a real agency).
const P1 = "99.901";
const P2 = "99.902";
let app: Server;
let stub: Server;
let base = "";
let mode: "up" | "down" = "up";
const calls: { url: string; body: any }[] = [];
let orgNc = "";
let orgOther = "";

function client(userId: string | null) {
  let cookie = "";
  return async (path: string) => {
    if (userId && !cookie) {
      const res = await fetch(`${base}/test/login-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    }
    const res = await fetch(`${base}/api${path}`, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: res.status, data: (await res.json().catch(() => null)) as any };
  };
}

function opportunity(id: string, overrides: Record<string, unknown>) {
  return {
    id, source: "grants_gov", sourceRef: `test-${id}`, title: "Synthetic literacy program", agency: "Synthetic Agency", status: "posted", closeDate: "2099-01-01",
    officialUrl: `https://www.grants.gov/search-results-detail/${id}`, fetchedAt: new Date(), detailFetchedAt: new Date(), checksum: "seed", connectorVersion: "test",
    publishable: true, gateMissing: [], eligibilityCodes: ["12"], categories: [], assistanceListings: [], costSharing: false, ...overrides,
  };
}

beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url ?? "", body: body ? JSON.parse(body) : null });
      if (mode === "down") {
        res.writeHead(503).end("{}");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(req.url?.includes("_count") ? COUNT : AWARDS);
    });
  }).listen(0);
  process.env.USASPENDING_API_BASE = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  await db.insert(usersTable).values([
    { id: OWNER, username: `pa-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `pa-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  const [nc] = await db.insert(grantApplicantsTable).values({ id: randomUUID(), userId: OWNER, name: "Synthetic Readers (test)", applicantType: "nonprofit_501c3", state: "NC" }).returning();
  const [other] = await db.insert(grantApplicantsTable).values({ id: randomUUID(), userId: OTHER, name: "Other Workspace Org (test)", applicantType: "nonprofit_501c3", state: "CO" }).returning();
  orgNc = nc.id;
  orgOther = other.id;
  await db.insert(grantOpportunitiesTable).values([
    opportunity(FED, { assistanceListings: [P1, "not a number", P1] }),
    opportunity(STATE_OPP, { source: "ca_grants_portal", jurisdiction: "CA", assistanceListings: [] }),
    opportunity(NO_LISTING, { assistanceListings: [] }),
  ]);

  const web = express();
  web.use(express.json());
  web.use(session({ secret: "past-awards-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  web.post("/test/login-as", (req, res) => {
    req.session.userId = (req.body as { userId: string }).userId;
    req.session.authenticated = true;
    res.json({ ok: true });
  });
  web.use("/api", requireAuth, requirePermission, pastAwardsRouter);
  app = web.listen(0);
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  app?.close();
  stub?.close();
  delete process.env.USASPENDING_API_BASE;
  delete process.env.USASPENDING_DISABLED;
  await db.delete(jobsTable).where(like(jobsTable.dedupeKey, "usaspending:99.%"));
  await db.delete(usaspendingAwardCacheTable).where(like(usaspendingAwardCacheTable.programNumber, "99.%"));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, [FED, STATE_OPP, NO_LISTING]));
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

describe("past federal awards", () => {
  it("requires sign-in", async () => {
    expect((await client(null)(`/grants/opportunities/${FED}/past-awards`)).status).toBe(401);
  });

  it("reads a listing on first view through the job, then serves the cache", async () => {
    const api = client(OWNER);
    const first = await api(`/grants/opportunities/${FED}/past-awards?applicantId=${orgNc}`);
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ applicable: true, state: "NC", source: { name: "USAspending.gov" } });
    expect(first.data.label).toMatch(/not a promise of future awards/);
    // The duplicate and the malformed listing number are dropped.
    expect(first.data.listings.map((l: any) => l.programNumber)).toEqual([P1]);
    const l = first.data.listings[0];
    expect(l.status).toBe("ready");
    expect(l.summary).toMatchObject({ totalAwards: 6, sampleSize: 5, amounts: { median: 250000, min: 60000, max: 900000 } });
    expect(l.summary.recent[0]).toMatchObject({ recipient: "PIEDMONT SYNTHETIC LITERACY COUNCIL", amountUsd: 250000, fiscalYear: 2026, state: "NC", url: "https://www.usaspending.gov/award/ASST_NON_SYN240001_9999" });
    expect(l.summary.inState).toMatchObject({ state: "NC", count: 2, usd: 375000 });
    expect(calls.map((c) => c.url)).toEqual(["/api/v2/search/spending_by_award/", "/api/v2/search/spending_by_award_count/"]);
    expect(calls[0].body.filters).toMatchObject({ program_numbers: [P1], award_type_codes: ["02", "03", "04", "05"] });
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.dedupeKey, `usaspending:${P1}`));
    expect(job).toMatchObject({ kind: "usaspending_awards", status: "succeeded" });

    // Later views do not call USAspending.
    const again = await api(`/grants/opportunities/${FED}/past-awards`);
    expect(again.data.listings[0].status).toBe("ready");
    expect(again.data.state).toBeNull();
    expect(again.data.listings[0].summary.inState).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("uses only the caller's own organization for in-state awards", async () => {
    const res = await client(OWNER)(`/grants/opportunities/${FED}/past-awards?applicantId=${orgOther}`);
    expect(res.data.state).toBeNull();
    expect(res.data.listings[0].summary.inState).toBeNull();
  });

  it("shows an expired copy while a refresh is queued, and keeps it when USAspending is down", async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await db.update(usaspendingAwardCacheTable).set({ fetchedAt: old, attemptedAt: old }).where(eq(usaspendingAwardCacheTable.programNumber, P1));
    await db.delete(jobsTable).where(eq(jobsTable.dedupeKey, `usaspending:${P1}`));
    const stale = (await client(OWNER)(`/grants/opportunities/${FED}/past-awards`)).data.listings[0];
    expect(stale.status).toBe("stale");
    expect(stale.message).toMatch(/fresh copy is on its way/);
    expect(stale.summary.totalAwards).toBe(6);
    const [queued] = await db.select().from(jobsTable).where(eq(jobsTable.dedupeKey, `usaspending:${P1}`));
    expect(queued.status).toBe("queued");

    // The queued refresh runs while the API is down: the error is recorded and the old copy kept.
    mode = "down";
    const { refreshListing } = await import("../lib/grants/pastAwards");
    await expect(refreshListing(P1)).rejects.toThrow(/USAspending answered 503/);
    const [row] = await db.select().from(usaspendingAwardCacheTable).where(eq(usaspendingAwardCacheTable.programNumber, P1));
    expect(row).toMatchObject({ status: "error", lastError: "USAspending answered 503", totalAwards: 6 });
    const down = (await client(OWNER)(`/grants/opportunities/${FED}/past-awards`)).data.listings[0];
    expect(down.status).toBe("stale");
    expect(down.message).toMatch(/could not be reached just now/);
    expect(down.summary.sampleSize).toBe(5);
  });

  it("says plainly when a listing has never been read because USAspending is down", async () => {
    mode = "down";
    await db.update(grantOpportunitiesTable).set({ assistanceListings: [P2] }).where(eq(grantOpportunitiesTable.id, NO_LISTING));
    const before = calls.length;
    const res = (await client(OWNER)(`/grants/opportunities/${NO_LISTING}/past-awards`)).data.listings[0];
    expect(res).toMatchObject({ programNumber: P2, status: "unavailable", summary: null });
    expect(res.message).toMatch(/could not be reached/);
    // The failure is not retried on every view.
    await client(OWNER)(`/grants/opportunities/${NO_LISTING}/past-awards`);
    expect(calls.length - before).toBe(1);
    await db.update(grantOpportunitiesTable).set({ assistanceListings: [] }).where(eq(grantOpportunitiesTable.id, NO_LISTING));
    mode = "up";
  });

  it("explains why state programs and listings without a number show nothing", async () => {
    const api = client(OWNER);
    const state = (await api(`/grants/opportunities/${STATE_OPP}/past-awards`)).data;
    expect(state).toMatchObject({ applicable: false, listings: [] });
    expect(state.reason).toMatch(/state program/);
    const none = (await api(`/grants/opportunities/${NO_LISTING}/past-awards`)).data;
    expect(none.reason).toMatch(/no Assistance Listing number/);
    expect((await api(`/grants/opportunities/missing-${randomUUID()}/past-awards`)).status).toBe(404);
  });

  it("can be turned off, and prunes listings nobody asks for", async () => {
    process.env.USASPENDING_DISABLED = "true";
    const off = (await client(OWNER)(`/grants/opportunities/${FED}/past-awards`)).data.listings[0];
    expect(off).toMatchObject({ status: "off", summary: null });
    delete process.env.USASPENDING_DISABLED;
    await db.update(usaspendingAwardCacheTable).set({ requestedAt: new Date(Date.now() - 100 * 24 * 60 * 60_000) }).where(eq(usaspendingAwardCacheTable.programNumber, P2));
    await prune(500);
    expect(await db.select().from(usaspendingAwardCacheTable).where(eq(usaspendingAwardCacheTable.programNumber, P2))).toEqual([]);
  });
});
