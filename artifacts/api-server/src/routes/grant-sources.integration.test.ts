/**
 * The source registry end to end, against the real test database and the
 * real router with real sessions (docs/SOURCE_REGISTRY.md):
 * - the two existing feeds are registered by the migration, unchanged;
 * - only the agency workspace's owners and admins, with admin access
 *   unlocked, can read or change sources and drafts; writers, viewers and a
 *   client workspace's owner get 403 (tenant and role checks);
 * - registry CRUD with validation and the terms rule;
 * - a watched page is checked (built-in fetcher, faked), its text extracted
 *   (AI answer mocked), drafts reach the review queue and never publish
 *   until a person approves them through the publication gate;
 * - demo output without an AI provider is labelled and cannot be approved;
 * - freshness and staleness;
 * - the changedetection.io webhook checks its shared secret.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, grantOpportunitiesTable, grantSourceChecksTable, grantSourceDraftsTable, grantSourcesTable, jobsTable, membersTable, usersTable, workspacesTable } from "@workspace/db";
import { router } from "./index";
import { checkSource, extractFromCheck } from "../lib/grants/sources/service";
import type { FetchedPage } from "../lib/grants/sources/fetcher";

const STAMP = Date.now();
const WS_NAME = `Source registry client ${STAMP}`;
const KEY_PREFIX = `itest_${STAMP}`;
const PASSWORD = "Sources are rows not releases 7";
const SECRET = "integration-test-watcher-secret-0123456789";
/** Each test file signs in from its own documentation-range address (see permissions.integration.test.ts). */
const CLIENT_ADDRESS = "198.51.100.31";
const email = (role: string) => `${role}-${STAMP}@sources.example`;
let server: Server;
let base = "";

function person() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "X-Forwarded-For": CLIENT_ADDRESS, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, data: (type.includes("json") ? await res.json() : await res.text()) as any };
  };
}
type Person = ReturnType<typeof person>;
const people: Record<string, Person> = {};

const PAGE_URL = `https://www.prairie-${STAMP}.example.org/grants/open`;
const page = (deadline: string, extra = "") => `<html><body><h1>Open calls</h1>
<h2>Rural Health Access Fund</h2><p>The Prairie Community Foundation invites proposals from nonprofits. Awards range from $10,000 to $50,000. Applications are due ${deadline}.</p>
<p><a href="/grants/rural-health">Guidelines</a></p>${extra}</body></html>`;

function inDays(days: number): { iso: string; text: string } {
  const d = new Date(Date.now() + days * 86_400_000);
  const iso = d.toISOString().slice(0, 10);
  const text = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { iso, text };
}

let pageBody = "";
const fetchPage = async (url: string): Promise<FetchedPage> => ({ url, status: 200, contentType: "text/html; charset=utf-8", body: pageBody });
const settings = { backend: "builtin" as const, mode: "poll" as const, changeDetection: null, problem: null };

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use(session({ secret: "sources-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The agency operator (team password), unlocked and not.
  const operator = person();
  await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
  people.locked = operator;
  const admin = person();
  await admin("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
  expect((await admin("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD })).status).toBe(200);
  people.admin = admin;

  // A client workspace: its owner (unlocked too), a writer and a viewer.
  const created = await admin("POST", "/workspaces", { name: WS_NAME, ownerEmail: email("owner") });
  const owner = person();
  await owner("POST", `/auth/invites/${created.data.invitePath.replace("/invite/", "")}/accept`, { name: "Client Owner", password: PASSWORD });
  await owner("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
  people.clientOwner = owner;
  for (const role of ["writer", "viewer"]) {
    const invite = await owner("POST", "/workspace/invites", { email: email(role), role });
    const p = person();
    expect((await p("POST", `/auth/invites/${invite.data.invitePath.replace("/invite/", "")}/accept`, { name: `Test ${role}`, password: PASSWORD })).status).toBe(201);
    people[role] = p;
  }
}, 60_000);

afterAll(async () => {
  server?.close();
  const rows = await db.select({ id: grantSourcesTable.id, key: grantSourcesTable.key }).from(grantSourcesTable).where(like(grantSourcesTable.key, `${KEY_PREFIX}%`));
  if (rows.length) {
    await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.source, rows.map((r) => `page:${r.key}`)));
    await db.delete(grantSourcesTable).where(inArray(grantSourcesTable.id, rows.map((r) => r.id)));
  }
  await db.delete(jobsTable).where(inArray(jobsTable.kind, ["source_check", "source_extract"]));
  const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, WS_NAME));
  await db.delete(membersTable).where(like(membersTable.email, `%-${STAMP}@sources.example`));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
  }
});

const pageSource = (suffix: string, over: Record<string, unknown> = {}) => ({
  key: `${KEY_PREFIX}_${suffix}`,
  name: `Prairie Community Foundation ${suffix}`,
  jurisdictionKind: "foundation",
  connectorType: "watched_page",
  urls: [PAGE_URL],
  scheduleHours: 24,
  owner: "ebyron357",
  termsNote: "Synthetic test page; terms recorded for the test.",
  termsChecked: true,
  termsPermitAutomation: true,
  status: "active",
  ...over,
});

describe("source registry", () => {
  it("registers the two existing feeds without changing them", async () => {
    const list = (await people.admin("GET", "/grant-sources")).data;
    const feeds = list.sources.filter((s: any) => s.connectorType === "feed");
    expect(feeds.map((s: any) => [s.key, s.connector, s.jurisdictionKind, s.jurisdictionCode, s.status, s.termsChecked, s.running])).toEqual(expect.arrayContaining([
      ["grants_gov", "grants_gov", "federal", null, "active", true, true],
      ["ca_grants_portal", "ca_grants_portal", "state", "CA", "active", true, true],
    ]));
    expect(feeds.find((s: any) => s.key === "grants_gov").termsNote).toMatch(/not endorsed or certified by the U\.S\. Department of Health and Human Services/);
    expect(list.watcher).toMatchObject({ backend: "builtin" });
    expect(list.options.connectorTypes).toEqual(["feed", "portal_page", "watched_page"]);
    // A feed's connector fields are locked, and it cannot be deleted.
    const gg = feeds.find((s: any) => s.key === "grants_gov");
    expect((await people.admin("PATCH", `/grant-sources/${gg.id}`, { urls: ["https://example.org/feed"] })).status).toBe(400);
    expect((await people.admin("DELETE", `/grant-sources/${gg.id}`)).status).toBe(409);
    expect((await people.admin("POST", `/grant-sources/${gg.id}/check`)).status).toBe(409);
    // The owner field can be kept current.
    expect((await people.admin("PATCH", `/grant-sources/${gg.id}`, { owner: "ebyron357" })).status).toBe(200);
  });

  it("is only for the agency workspace's owners and admins, with admin access unlocked", async () => {
    const paths: [string, string, unknown?][] = [["GET", "/grant-sources"], ["POST", "/grant-sources", pageSource("denied")], ["GET", "/grant-source-drafts"], ["POST", "/grant-source-drafts/missing/approve", { confirmChecked: true }]];
    for (const [m, p, body] of paths) {
      // Writers and viewers lack workspace.configure: refused before the handler.
      for (const role of ["writer", "viewer"]) {
        const r = await people[role](m, p, body);
        expect(r.status, `${role} ${m} ${p}`).toBe(403);
        expect(r.data.code).toBe("forbidden_by_role");
      }
      // The operator without admin unlock.
      expect((await people.locked(m, p, body)).status, `locked ${m} ${p}`).toBe(403);
      // A client workspace's owner, even unlocked: sources are not tenant data.
      const c = await people.clientOwner(m, p, body);
      expect(c.status, `client owner ${m} ${p}`).toBe(403);
      expect(c.data.error).toBe("Grant sources are managed from the agency workspace.");
    }
    // Unauthenticated: 401.
    expect((await person()("GET", "/grant-sources")).status).toBe(401);
    // Nothing was created by the refused requests.
    expect(await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.key, `${KEY_PREFIX}_denied`))).toEqual([]);
  });

  it("creates, validates, updates and deletes page sources", async () => {
    const api = people.admin;
    const bad = await api("POST", "/grant-sources", pageSource("bad", { termsChecked: false, termsPermitAutomation: false, urls: ["http://10.0.0.1/"] }));
    expect(bad.status).toBe(400);
    expect(bad.data.errors).toEqual(expect.arrayContaining(["URL 1 must use https.", "A source stays disabled until its terms of use are checked."]));
    expect((await api("POST", "/grant-sources", { ...pageSource("feed"), connectorType: "feed", connector: "grants_gov" })).status).toBe(400);

    // A state portal row, as week 2's states will be: disabled until its terms are checked.
    const il = await api("POST", "/grant-sources", pageSource("il", { name: "Illinois GATA test portal", jurisdictionKind: "state", jurisdictionCode: "IL", connectorType: "portal_page", status: "disabled", termsChecked: false, termsPermitAutomation: false, termsNote: null }));
    expect(il.status).toBe(201);
    expect(il.data).toMatchObject({ jurisdictionCode: "IL", status: "disabled", running: false, freshness: { state: "not_running" } });
    expect((await api("POST", "/grant-sources", pageSource("il"))).status).toBe(409);
    // Turning it on without checking the terms is refused.
    expect((await api("PATCH", `/grant-sources/${il.data.id}`, { status: "active" })).data.errors).toContain("A source stays disabled until its terms of use are checked.");
    const on = await api("PATCH", `/grant-sources/${il.data.id}`, { status: "active", termsChecked: true, termsPermitAutomation: true, termsNote: "Synthetic: terms allow automated access." });
    expect(on.status).toBe(200);
    expect(on.data).toMatchObject({ status: "active", running: true, termsCheckedBy: "operator", freshness: { state: "never" } });
    expect(on.data.termsCheckedAt).toBeTruthy();
    expect((await api("PATCH", `/grant-sources/${il.data.id}`, { connectorType: "feed" })).status).toBe(400);
    expect((await api("GET", `/grant-sources/${il.data.id}`)).data.checks).toEqual([]);
    expect((await api("DELETE", `/grant-sources/${il.data.id}`)).status).toBe(204);
    expect((await api("GET", `/grant-sources/${il.data.id}`)).status).toBe(404);
  });

  it("turns a changed page into drafts that wait for review and never publish on their own", async () => {
    const api = people.admin;
    const src = (await api("POST", "/grant-sources", pageSource("prairie"))).data;
    const due = inDays(40);
    pageBody = page(due.text);
    const answer = JSON.stringify([
      { title: "Rural Health Access Fund", funder: "Prairie Community Foundation", status: "posted", deadline: due.iso, amountMin: 10000, amountMax: 50000, eligibilitySummary: "Nonprofits.", applicantKinds: ["nonprofit"], officialUrl: `https://www.prairie-${STAMP}.example.org/grants/rural-health`, evidence: "invites proposals from nonprofits" },
      { title: "Invented Program", funder: "Someone Else", deadline: inDays(90).iso, amountMax: 999999, officialUrl: "https://elsewhere.example.com/" },
    ]);
    const generate = async () => ({ content: answer, provider: "openai" });

    // First check: a baseline is a change (new page), so it is extracted.
    const first = await checkSource(src.id, { fetchPage, settings });
    expect(first).toMatchObject({ outcome: "changed", extract: true });
    const ex = await extractFromCheck(first.checkId!, { generate });
    expect(ex).toMatchObject({ drafts: 2, created: 2, demo: false, provider: "openai" });

    // Unchanged page: freshness updates, no new check text, no extraction.
    const again = await checkSource(src.id, { fetchPage, settings });
    expect(again).toMatchObject({ outcome: "unchanged" });
    const [check2] = await db.select().from(grantSourceChecksTable).where(eq(grantSourceChecksTable.id, again.checkId!));
    expect(check2.pageText).toBeNull();

    // Nothing is published: the drafts are only in the queue.
    expect(await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.source, `page:${src.key}`))).toEqual([]);
    const queue = (await api("GET", `/grant-source-drafts?sourceId=${src.id}`)).data.drafts;
    expect(queue).toHaveLength(2);
    const good = queue.find((d: any) => d.title === "Rural Health Access Fund");
    const invented = queue.find((d: any) => d.title === "Invented Program");
    expect(good).toMatchObject({ status: "pending", deadline: due.iso, amountMin: 10000, amountMax: 50000, sourceUrl: PAGE_URL, demo: false, gate: { ok: true } });
    expect(good.checkedAt).toBeTruthy();
    // Invented fields were left empty, never guessed, and the gate shows what is missing.
    expect(invented).toMatchObject({ funder: null, deadline: null, amountMax: null, officialUrl: null, gate: { ok: false } });
    expect(invented.gate.problems).toEqual(expect.arrayContaining(["The publication gate needs: official https source.", "The publication gate needs: closing date."]));

    // Approval needs the reviewer's confirmation, and the gate.
    expect((await api("POST", `/grant-source-drafts/${good.id}/approve`, {})).status).toBe(400);
    const refused = await api("POST", `/grant-source-drafts/${invented.id}/approve`, { confirmChecked: true });
    expect(refused.status).toBe(409);
    expect(refused.data.errors).toContain("The publication gate needs: official https source.");

    // A reviewer may fix a draft from the page, then approve it.
    expect((await api("PATCH", `/grant-source-drafts/${invented.id}`, { deadline: "soon" })).status).toBe(400);
    const approved = await api("POST", `/grant-source-drafts/${good.id}/approve`, { confirmChecked: true, note: "Matches the page." });
    expect(approved.status).toBe(200);
    expect(approved.data).toMatchObject({ ok: true, publishable: true });
    const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, approved.data.opportunityId));
    expect(opp).toMatchObject({ source: `page:${src.key}`, title: "Rural Health Access Fund", agency: "Prairie Community Foundation", closeDate: due.iso, awardCeiling: 50000, publishable: true, jurisdiction: null, eligibilityCodes: ["12", "13"] });
    expect((await api("POST", `/grant-source-drafts/${good.id}/approve`, { confirmChecked: true })).status).toBe(409);
    expect((await api("POST", `/grant-source-drafts/${invented.id}/reject`, { note: "Not on the page." })).status).toBe(200);
    expect((await api("GET", `/grant-source-drafts?sourceId=${src.id}`)).data.drafts).toEqual([]);
    expect((await api("GET", `/grant-source-drafts?status=approved&sourceId=${src.id}`)).data.drafts[0]).toMatchObject({ reviewedBy: "operator", reviewNote: "Matches the page." });

    // A later change keeps the reviewer's decision on drafts already reviewed.
    pageBody = page(due.text, "<p>New: Evening office hours.</p>");
    const changed = await checkSource(src.id, { fetchPage, settings });
    expect(changed.outcome).toBe("changed");
    expect((await extractFromCheck(changed.checkId!, { generate })).created).toBe(0);
    const [still] = await db.select().from(grantSourceDraftsTable).where(eq(grantSourceDraftsTable.id, good.id));
    expect(still.status).toBe("approved");

    // A source with approved opportunities is disabled, not deleted.
    expect((await api("DELETE", `/grant-sources/${src.id}`)).status).toBe(409);
  });

  it("labels demo output without an AI key, and never approves it", async () => {
    const api = people.admin;
    const src = (await api("POST", "/grant-sources", pageSource("demo", { urls: [`https://demo-${STAMP}.example.org/calls`] }))).data;
    pageBody = page(inDays(30).text);
    const check = await checkSource(src.id, { fetchPage, settings });
    const ex = await extractFromCheck(check.checkId!, { generate: async () => ({ content: "[DEMO OUTPUT]", provider: "demo" }) });
    expect(ex).toMatchObject({ drafts: 1, demo: true, provider: "demo" });
    const [d] = (await api("GET", `/grant-source-drafts?sourceId=${src.id}`)).data.drafts;
    expect(d).toMatchObject({ demo: true, funder: null, deadline: null, amountMax: null, officialUrl: null });
    expect(d.title).toMatch(/^DEMO: /);
    expect((await api("PATCH", `/grant-source-drafts/${d.id}`, { title: "Real now" })).status).toBe(409);
    const refused = await api("POST", `/grant-source-drafts/${d.id}/approve`, { confirmChecked: true });
    expect(refused.status).toBe(409);
    expect(refused.data.errors[0]).toMatch(/^Demo output cannot be approved/);
  });

  it("records failures, and marks a source stale after its window", async () => {
    const api = people.admin;
    const src = (await api("POST", "/grant-sources", pageSource("stale", { urls: [`https://stale-${STAMP}.example.org/`], staleAfterDays: 2 }))).data;
    const failed = await checkSource(src.id, { fetchPage: async (url) => ({ url, status: 503, contentType: "text/html", body: "down" }), settings });
    expect(failed).toMatchObject({ outcome: "failed", error: "The page answered HTTP 503." });
    let view = (await api("GET", `/grant-sources/${src.id}`)).data;
    expect(view).toMatchObject({ lastError: "The page answered HTTP 503.", freshness: { state: "never" } });
    expect(view.checks[0]).toMatchObject({ outcome: "failed", httpStatus: 503 });

    await db.update(grantSourcesTable).set({ lastSuccessAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(grantSourcesTable.id, src.id));
    view = (await api("GET", `/grant-sources/${src.id}`)).data;
    expect(view.freshness).toMatchObject({ state: "stale", ageDays: 3, staleAfterDays: 2 });
    const list = (await api("GET", "/grant-sources")).data;
    expect(list.counts.stale).toBeGreaterThanOrEqual(1);

    // A paused source is not checked at all.
    await api("PATCH", `/grant-sources/${src.id}`, { status: "paused" });
    expect((await checkSource(src.id, { fetchPage, settings })).outcome).toBe("skipped");
    expect((await api("POST", `/grant-sources/${src.id}/check`)).status).toBe(409);
  });

  it("checks a source on request through the job queue", async () => {
    // The route uses the real fetcher, which cannot reach this synthetic host: the failure is recorded, not thrown.
    const api = people.admin;
    const src = (await api("POST", "/grant-sources", pageSource("now", { urls: [`https://now-${STAMP}.invalid.example.org/`] }))).data;
    const r = await api("POST", `/grant-sources/${src.id}/check`);
    expect(r.status).toBe(200);
    expect(r.data.result).toMatchObject({ outcome: "failed" });
    const view = (await api("GET", `/grant-sources/${src.id}`)).data;
    expect(view.lastError).toBeTruthy();
    expect(view.checks[0]).toMatchObject({ outcome: "failed", backend: "builtin" });
  });
});

describe("changedetection.io webhook", () => {
  const anon = () => person();

  it("answers 503 when no secret is configured", async () => {
    delete process.env.CHANGEDETECTION_WEBHOOK_SECRET;
    expect((await anon()("POST", "/watch-events/changedetection", { watch_uuid: "095be615-a8ad-4c33-8e9c-c7612fbf6c9f" }, { "x-watcher-secret": "anything-at-all-long-enough-0000" })).status).toBe(503);
  });

  it("verifies the shared secret, then queues a check for the named watch", async () => {
    process.env.CHANGEDETECTION_WEBHOOK_SECRET = SECRET;
    try {
      const src = (await people.admin("POST", "/grant-sources", pageSource("hook", { urls: [`https://hook-${STAMP}.example.org/`] }))).data;
      const watchId = "7c9e6b8d-f2a1-4e5c-9d3b-8a7f6e4c2d1a";
      await db.update(grantSourcesTable).set({ watchId }).where(eq(grantSourcesTable.id, src.id));
      const body = { event: "watch.changed", watch_uuid: watchId, watch_url: `https://hook-${STAMP}.example.org/` };
      expect((await anon()("POST", "/watch-events/changedetection", body)).status).toBe(401);
      expect((await anon()("POST", "/watch-events/changedetection", body, { "x-watcher-secret": `${SECRET}-wrong` })).status).toBe(401);
      expect((await anon()("POST", "/watch-events/changedetection", { watch_uuid: "nope" }, { "x-watcher-secret": SECRET })).status).toBe(400);
      expect((await anon()("POST", "/watch-events/changedetection", { watch_uuid: "095be615-a8ad-4c33-8e9c-c7612fbf6c9f" }, { "x-watcher-secret": SECRET })).status).toBe(404);
      const ok = await anon()("POST", "/watch-events/changedetection", body, { "x-watcher-secret": SECRET });
      expect(ok.status).toBe(202);
      expect(ok.data).toMatchObject({ accepted: true, created: true });
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, ok.data.jobId));
      expect(job).toMatchObject({ kind: "source_check", requestedBy: "changedetection.io", payload: { sourceId: src.id } });
      // A second notification while that check is queued joins it.
      const dup = await anon()("POST", "/watch-events/changedetection", body, { "x-watcher-secret": SECRET });
      expect(dup.data).toMatchObject({ jobId: ok.data.jobId, created: false });
      // A paused source accepts nothing.
      await db.update(grantSourcesTable).set({ status: "paused" }).where(eq(grantSourcesTable.id, src.id));
      expect((await anon()("POST", "/watch-events/changedetection", body, { "x-watcher-secret": SECRET })).data).toMatchObject({ accepted: false });
    } finally {
      delete process.env.CHANGEDETECTION_WEBHOOK_SECRET;
    }
  });
});
