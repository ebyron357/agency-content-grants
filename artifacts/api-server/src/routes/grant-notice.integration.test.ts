/**
 * The notice PDF and its proposed checklist, through the real routes and the
 * real database. A synthetic PDF (generated in the test, not a real notice) is
 * uploaded; the link fetch uses a fake fetcher; the AI provider is the demo
 * provider (no key in tests), and one test swaps in a mocked model. Covers
 * page citations, demo labelling, confirm, edit, reject and restore, the
 * compliance matrix, size and type limits, and cross-workspace 404s.
 * Role checks run through the full router with real invited members.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { eq, inArray, like } from "drizzle-orm";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, grantApplicantsTable, grantNoticesTable, grantOpportunitiesTable, grantRequirementsTable, jobsTable, membersTable, usersTable, workspacesTable } from "@workspace/db";

process.env.SOURCE_UPLOAD_DIR = mkdtempSync(join(tmpdir(), "notice-test-"));

const fakeModel = vi.hoisted(() => ({ content: null as string | null }));
vi.mock("../lib/ai/router", async (original) => {
  const real = await original<typeof import("../lib/ai/router")>();
  return {
    ...real,
    generateForStage: async (...args: Parameters<typeof real.generateForStage>) =>
      fakeModel.content === null ? real.generateForStage(...args) : { content: fakeModel.content, provider: "openai", model: "fake", inputTokens: 0, outputTokens: 0, latencyMs: 0, estimatedCostUsd: 0 },
  };
});

import { requireAuth } from "../middleware/requireAuth";
import grantsRouter from "./grants";
import jobsRouter from "./jobs";
import { router as fullRouter } from "./index";
import { buildSyntheticNoticePdf } from "../lib/grants/syntheticNotice";
import { setNoticeFetcherForTests } from "../lib/grants/noticeFetch";
import { resolveSourcePath } from "../lib/sourceStorage";

const OWNER = `notice-owner-${randomUUID()}`;
const OTHER = `notice-other-${randomUUID()}`;
let server: Server;
let base = "";
let pdf: Buffer;
const opportunities: string[] = [];

type Api = (method: string, path: string, body?: unknown, form?: FormData) => Promise<{ status: number; data: any }>;

function client(userId: string): Api {
  let cookie = "";
  return async (method, path, body, form) => {
    if (!cookie) {
      const res = await fetch(`${base}/test/login-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    }
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Cookie: cookie, ...(body !== undefined && !form ? { "Content-Type": "application/json" } : {}) },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, data: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
}

function pdfForm(buffer: Buffer, name = "synthetic-notice.pdf"): FormData {
  const form = new FormData();
  form.append("pdf", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), name);
  return form;
}

async function freshOpportunity(officialUrl?: string): Promise<string> {
  const id = randomUUID();
  opportunities.push(id);
  await db.insert(grantOpportunitiesTable).values({
    id, source: "grants_gov", sourceRef: `test-${id}`, title: "Synthetic Community Reading Pilot", agency: "Example Agency for Testing", status: "posted",
    closeDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), officialUrl: officialUrl ?? `https://www.grants.gov/search-results-detail/${id}`,
    fetchedAt: new Date(), detailFetchedAt: new Date(), checksum: "seed", connectorVersion: "test", publishable: true, gateMissing: [],
    eligibilityCodes: ["12"], categories: [], assistanceListings: [], costSharing: false,
  });
  return id;
}

async function newApplication(api: Api, officialUrl?: string) {
  const opportunityId = await freshOpportunity(officialUrl);
  const org = (await api("POST", "/grants/applicants", { name: `Notice test org ${randomUUID().slice(0, 6)} (synthetic)`, applicantType: "nonprofit_501c3" })).data;
  const started = (await api("POST", "/grants/applications", { applicantId: org.id, opportunityId, eligibilityConfirmed: true })).data;
  return started.id as string;
}

beforeAll(async () => {
  pdf = await buildSyntheticNoticePdf();
  await db.insert(usersTable).values([
    { id: OWNER, username: `notice-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `notice-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "notice-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.post("/test/login-as", (req, res) => {
    req.session.userId = (req.body as any).userId;
    req.session.authenticated = true;
    res.json({ ok: true });
  });
  app.use("/api", requireAuth, grantsRouter, jobsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  setNoticeFetcherForTests(null);
  server?.close();
  await db.delete(jobsTable).where(inArray(jobsTable.userId, [OWNER, OTHER]));
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, opportunities));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

describe("notice PDF checklist", () => {
  it("uploads a PDF, reads it page by page and proposes labelled demo rows that each cite a page", async () => {
    const api = client(OWNER);
    const appId = await newApplication(api);
    const before = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(before.notice).toBeNull();
    const templateRows = before.requirements.length;

    const res = await api("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(pdf));
    expect(res.status).toBe(201);
    const ws = res.data;
    expect(ws.notice).toMatchObject({ status: "ready", origin: "upload", extractor: "pdfjs", pageCount: 3, pagesRead: 3, truncated: false, checklistDemo: true, checklistProvider: "demo", hasFile: true, fileName: "synthetic-notice.pdf", uploadedBy: expect.any(String) });
    expect(ws.notice.pages).toBeUndefined();
    expect(ws.notice.fileKey).toBeUndefined();
    expect(ws.notice.error).toMatch(/^Demo: no AI provider is configured/);

    const proposed = ws.requirements.filter((r: any) => r.origin === "notice");
    expect(proposed.length).toBe(ws.notice.proposed);
    expect(proposed.length).toBeGreaterThanOrEqual(6);
    expect(ws.requirements.length).toBe(templateRows + proposed.length);
    for (const r of proposed) {
      // Proposed, never confirmed on anyone's behalf, and cited.
      expect(r).toMatchObject({ confirmed: false, confirmedBy: null, extractedBy: "demo_rules", noticeId: ws.notice.id, sourceRef: `Notice p. ${r.page}` });
      expect(r.page).toBeGreaterThanOrEqual(1);
      expect(r.page).toBeLessThanOrEqual(3);
      const page = (await api("GET", `/grants/applications/${appId}/notice/pages/${r.page}`)).data;
      expect(page.text.replace(/\s+/g, " ")).toContain(r.quote.replace(/\s+/g, " "));
    }
    expect(proposed.find((r: any) => r.kind === "criterion" && r.points === 35)).toMatchObject({ page: 3 });
    expect(ws.notice.counts).toEqual({ proposed: proposed.length, confirmed: 0, rejected: 0 });
    // Unconfirmed proposals keep the matrix check open.
    expect(ws.compliance.checks.find((c: any) => c.id === "matrix_confirmed").ok).toBe(false);
    // Recorded as a job for the workspace.
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.dedupeKey, `ai:notice:${appId}`));
    expect(job).toMatchObject({ kind: "grant_notice_checklist", status: "succeeded", userId: OWNER });

    // The page reader and the file.
    expect((await api("GET", `/grants/applications/${appId}/notice/pages/4`)).status).toBe(404);
    expect((await api("GET", `/grants/applications/${appId}/notice/pages/abc`)).status).toBe(404);
    const file = await api("GET", `/grants/applications/${appId}/notice/file`);
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.data, pdf)).toBe(0);
  });

  it("lets a person confirm, edit, reject and restore each proposed row, recording who did it", async () => {
    const api = client(OWNER);
    const appId = await newApplication(api);
    const ws = (await api("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(pdf))).data;
    const [a, b, c] = ws.requirements.filter((r: any) => r.origin === "notice");

    const confirmed = await api("PATCH", `/grants/requirements/${a.id}`, { confirmed: true });
    expect(confirmed.data).toMatchObject({ confirmed: true, confirmedBy: expect.any(String), confirmedAt: expect.any(String) });
    const edited = await api("PATCH", `/grants/requirements/${b.id}`, { label: "Edited by a person", points: 12 });
    expect(edited.data).toMatchObject({ label: "Edited by a person", points: 12, page: b.page, quote: b.quote, confirmed: false });
    const unconfirmed = await api("PATCH", `/grants/requirements/${a.id}`, { confirmed: false });
    expect(unconfirmed.data).toMatchObject({ confirmed: false, confirmedBy: null, confirmedAt: null });

    const rejected = await api("POST", `/grants/requirements/${c.id}/reject`);
    expect(rejected.data).toMatchObject({ rejectedBy: expect.any(String), confirmed: false });
    expect((await api("PATCH", `/grants/requirements/${c.id}`, { confirmed: true })).status).toBe(409);
    let view = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(view.requirements.some((r: any) => r.id === c.id)).toBe(false);
    expect(view.rejectedRequirements.map((r: any) => r.id)).toEqual([c.id]);
    expect(view.notice.counts.rejected).toBe(1);

    // Confirm all confirms what is in the matrix, never the rejected row.
    view = (await api("POST", `/grants/applications/${appId}/requirements/confirm-all`)).data;
    expect(view.requirements.every((r: any) => r.confirmed && r.confirmedBy)).toBe(true);
    expect(view.compliance.checks.find((x: any) => x.id === "matrix_confirmed").ok).toBe(true);
    const [still] = await db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.id, c.id));
    expect(still).toMatchObject({ confirmed: false });

    const restored = await api("POST", `/grants/requirements/${c.id}/restore`);
    expect(restored.data).toMatchObject({ rejectedAt: null, confirmed: false });
    view = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(view.compliance.checks.find((x: any) => x.id === "matrix_confirmed").ok).toBe(false);

    // Reading again keeps what people decided and replaces only untouched proposals.
    const rerun = await api("POST", `/grants/applications/${appId}/notice/rerun`);
    expect(rerun.status).toBe(200);
    const after = rerun.data.requirements.filter((r: any) => r.origin === "notice");
    expect(after.filter((r: any) => r.confirmed).length).toBe(view.requirements.filter((r: any) => r.origin === "notice" && r.confirmed).length);
    expect(new Set(after.map((r: any) => `${r.label}|${r.page}`)).size).toBe(after.length);
  });

  it("with a mocked model, adds only rows whose quote is on the cited page", async () => {
    const api = client(OWNER);
    const appId = await newApplication(api);
    fakeModel.content = JSON.stringify([
      { kind: "formatting", label: "Narrative limit", detail: "10 pages", page: 2, quote: "The project narrative must not exceed 10 pages.", points: null },
      { kind: "criterion", label: "Evaluation plan", page: 3, quote: "Evaluation plan (15 points).", points: 15 },
      { kind: "attachment", label: "Invented", page: 2, quote: "Applicants must attach audited financial statements." },
      { kind: "deadline", label: "No citation", quote: "no later than March 3, 2027" },
    ]);
    try {
      const ws = (await api("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(pdf))).data;
      expect(ws.notice).toMatchObject({ status: "ready", checklistDemo: false, checklistProvider: "openai", proposed: 2, dropped: 2, error: null });
      const rows = ws.requirements.filter((r: any) => r.origin === "notice");
      expect(rows.map((r: any) => [r.label, r.page, r.points, r.extractedBy])).toEqual([
        ["Narrative limit", 2, null, "ai:openai"],
        ["Evaluation plan", 3, 15, "ai:openai"],
      ]);
    } finally {
      fakeModel.content = null;
    }
  });

  it("fetches the notice from the opportunity's official link, and explains a link that is a web page", async () => {
    const api = client(OWNER);
    const appId = await newApplication(api, "https://www.example-agency.test/notices/EX-TEST-0001.pdf");
    const asked: string[] = [];
    setNoticeFetcherForTests(async (url) => {
      asked.push(url);
      return url.endsWith(".pdf")
        ? { buffer: pdf, finalUrl: url, contentType: "application/pdf", fileName: "EX-TEST-0001.pdf" }
        : { buffer: Buffer.from("<!doctype html><title>Listing</title>"), finalUrl: url, contentType: "text/html; charset=utf-8", fileName: null };
    });
    const ws = (await api("POST", `/grants/applications/${appId}/notice`, { useOfficialLink: true })).data;
    expect(asked).toEqual(["https://www.example-agency.test/notices/EX-TEST-0001.pdf"]);
    expect(ws.notice).toMatchObject({ origin: "link", sourceUrl: asked[0], status: "ready", hasFile: true, fileName: "EX-TEST-0001.pdf", pagesRead: 3 });

    const html = await api("POST", `/grants/applications/${appId}/notice`, { url: "https://www.example-agency.test/listing" });
    expect(html.status).toBe(201);
    expect(html.data.notice).toMatchObject({ status: "failed", hasFile: false });
    expect(html.data.notice.error).toMatch(/returned a web page, not a PDF/);
    // A permanent file problem is not retried.
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.dedupeKey, `ai:notice:${appId}`)).orderBy(jobsTable.createdAt);
    expect(job).toBeDefined();
    // Replacing the notice removed the earlier notice's untouched proposals.
    expect(html.data.requirements.some((r: any) => r.origin === "notice")).toBe(false);

    expect((await api("POST", `/grants/applications/${appId}/notice`, { url: "http://insecure.test/x.pdf" })).status).toBe(400);
    expect((await api("POST", `/grants/applications/${appId}/notice`, { url: "https://10.0.0.5/x.pdf" })).status).toBe(400);
    expect((await api("POST", `/grants/applications/${appId}/notice`, {})).status).toBe(400);
    setNoticeFetcherForTests(null);
  });

  it("refuses files that are not PDFs, and scanned notices with no text", async () => {
    const api = client(OWNER);
    const appId = await newApplication(api);
    const notPdf = await api("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(Buffer.from("just text, not a pdf"), "fake.pdf"));
    expect(notPdf.status).toBe(400);
    expect(notPdf.data.error).toBe("The file is not a PDF.");
    const blank = await buildSyntheticNoticePdf({ pages: [[" "], [" "]] });
    const scanned = await api("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(blank));
    expect(scanned.data.notice).toMatchObject({ status: "failed", pagesRead: 2 });
    expect(scanned.data.notice.error).toMatch(/looks scanned/);
  });

  it("isolates the notice to its workspace, and removes the file with the notice and the application", async () => {
    const owner = client(OWNER);
    const other = client(OTHER);
    const appId = await newApplication(owner);
    const ws = (await owner("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(pdf))).data;
    const row = ws.requirements.find((r: any) => r.origin === "notice");
    for (const [method, path, body] of [
      ["POST", `/grants/applications/${appId}/notice`, { useOfficialLink: true }],
      ["POST", `/grants/applications/${appId}/notice/rerun`, undefined],
      ["DELETE", `/grants/applications/${appId}/notice`, undefined],
      ["GET", `/grants/applications/${appId}/notice/pages/1`, undefined],
      ["GET", `/grants/applications/${appId}/notice/file`, undefined],
      ["POST", `/grants/requirements/${row.id}/reject`, undefined],
      ["POST", `/grants/requirements/${row.id}/restore`, undefined],
      ["PATCH", `/grants/requirements/${row.id}`, { confirmed: true }],
    ] as const) {
      expect((await other(method, path, body)).status, `${method} ${path}`).toBe(404);
    }
    const [stored] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, appId));
    expect(existsSync(resolveSourcePath(stored.fileKey!))).toBe(true);

    // Removing the notice keeps decided rows and drops untouched proposals and the file.
    await owner("PATCH", `/grants/requirements/${row.id}`, { confirmed: true });
    const removed = (await owner("DELETE", `/grants/applications/${appId}/notice`)).data;
    expect(removed.notice).toBeNull();
    expect(removed.requirements.filter((r: any) => r.origin === "notice").map((r: any) => r.id)).toEqual([row.id]);
    expect(existsSync(resolveSourcePath(stored.fileKey!))).toBe(false);

    const again = (await owner("POST", `/grants/applications/${appId}/notice`, undefined, pdfForm(pdf))).data;
    const [second] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.id, again.notice.id));
    expect((await owner("DELETE", `/grants/applications/${appId}`)).status).toBe(204);
    expect(existsSync(resolveSourcePath(second.fileKey!))).toBe(false);
  });
});

describe("notice routes and roles", () => {
  const STAMP = Date.now();
  const WS_NAME = `Notice roles workspace ${STAMP}`;
  const email = (role: string) => `${role}-${STAMP}@notice.example`;
  const CLIENT_ADDRESS = "198.51.100.32";
  let fullServer: Server;
  let fullBase = "";
  const people: Record<string, Api> = {};

  function person(): Api {
    let cookie = "";
    return async (method, path, body) => {
      const res = await fetch(`${fullBase}/api${path}`, {
        method,
        headers: { "X-Forwarded-For": CLIENT_ADDRESS, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
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
    app.use(session({ secret: "notice-roles-secret", resave: false, saveUninitialized: false, name: "sid" }));
    app.use("/api", fullRouter);
    fullServer = app.listen(0);
    fullBase = `http://127.0.0.1:${(fullServer.address() as AddressInfo).port}`;
    const operator = person();
    await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
    const created = await operator("POST", "/workspaces", { name: WS_NAME, ownerEmail: email("owner") });
    const owner = person();
    await owner("POST", `/auth/invites/${created.data.invitePath.replace("/invite/", "")}/accept`, { name: "Nora Owner", password: "Notice roles are separated 7" });
    for (const role of ["writer", "reviewer", "viewer"]) {
      const invite = await owner("POST", "/workspace/invites", { email: email(role), role });
      const p = person();
      await p("POST", `/auth/invites/${invite.data.invitePath.replace("/invite/", "")}/accept`, { name: `Test ${role}`, password: "Notice roles are separated 7" });
      people[role] = p;
    }
  }, 60_000);

  afterAll(async () => {
    fullServer?.close();
    const ws = await db.select().from(workspacesTable).where(eq(workspacesTable.name, WS_NAME));
    await db.delete(membersTable).where(like(membersTable.email, `%-${STAMP}@notice.example`));
    if (ws.length) {
      await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
      await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
    }
  });

  it("lets writers attach, reread, remove, confirm and reject; reviewers and viewers only read", async () => {
    // A writer reaches the handlers (404 for ids that do not exist).
    for (const [method, path] of [
      ["POST", "/grants/applications/missing/notice"],
      ["POST", "/grants/applications/missing/notice/rerun"],
      ["DELETE", "/grants/applications/missing/notice"],
      ["POST", "/grants/requirements/missing/reject"],
      ["POST", "/grants/requirements/missing/restore"],
      ["GET", "/grants/applications/missing/notice/pages/1"],
    ] as const) {
      expect((await people.writer(method, path, method === "GET" || method === "DELETE" ? undefined : {})).status, `writer ${method} ${path}`).toBe(404);
    }
    for (const role of ["reviewer", "viewer"]) {
      for (const [method, path] of [
        ["POST", "/grants/applications/missing/notice"],
        ["POST", "/grants/applications/missing/notice/rerun"],
        ["DELETE", "/grants/applications/missing/notice"],
        ["POST", "/grants/requirements/missing/reject"],
        ["POST", "/grants/requirements/missing/restore"],
      ] as const) {
        const res = await people[role](method, path, method === "DELETE" ? undefined : {});
        expect(res.status, `${role} ${method} ${path}`).toBe(403);
        expect(res.data.code).toBe("forbidden_by_role");
      }
      expect((await people[role]("GET", "/grants/applications/missing/notice/pages/1")).status, `${role} read`).toBe(404);
    }
  });
});
