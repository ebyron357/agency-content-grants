/**
 * Grant Studio AI work as background jobs, through the real routes and the
 * real database. The AI calls are replaced with controllable fakes, so the
 * test can make a call slow (it continues in the background and the page
 * follows it) or fail (the request reports the provider's error).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, grantApplicantsTable, grantOpportunitiesTable, jobsTable, usersTable } from "@workspace/db";

const fake = vi.hoisted(() => ({ delayMs: 0, fail: null as string | null }));
vi.mock("../lib/grants/ai", async (original) => {
  const real = await original<typeof import("../lib/grants/ai")>();
  return {
    ...real,
    draftSection: async () => {
      await new Promise((r) => setTimeout(r, fake.delayMs));
      if (fake.fail) throw new Error(fake.fail);
      return { value: "<p>Drafted in the background.</p>", demo: false, provider: "fake" };
    },
  };
});

import { requireAuth } from "../middleware/requireAuth";
import grantsRouter from "./grants";
import jobsRouter from "./jobs";
import { startJobWorker, stopJobWorker } from "../lib/jobs/worker";

const OWNER = `ai-owner-${randomUUID()}`;
const OTHER = `ai-other-${randomUUID()}`;
let server: Server;
let base = "";

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

const opportunities: string[] = [];

/**
 * A fresh opportunity for each application: the sync tests that run in parallel
 * close any stored opportunity missing from their fake feed.
 */
async function freshOpportunity(): Promise<string> {
  const id = randomUUID();
  opportunities.push(id);
  await db.insert(grantOpportunitiesTable).values({
    id, source: "grants_gov", sourceRef: `test-${id}`, title: "Youth Literacy Expansion", agency: "Test Agency", status: "posted",
    closeDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), officialUrl: `https://www.grants.gov/search-results-detail/${id}`,
    fetchedAt: new Date(), detailFetchedAt: new Date(), checksum: "seed", connectorVersion: "test", publishable: true, gateMissing: [],
    eligibilityCodes: ["12"], categories: [], assistanceListings: [], costSharing: false,
  });
  return id;
}

async function newApplication(api: ReturnType<typeof client>) {
  const opportunityId = await freshOpportunity();
  const org = (await api("POST", "/grants/applicants", { name: `AI test org ${randomUUID().slice(0, 6)}`, applicantType: "nonprofit_501c3" })).data;
  const started = (await api("POST", "/grants/applications", { applicantId: org.id, opportunityId, eligibilityConfirmed: true })).data;
  const ws = (await api("GET", `/grants/applications/${started.id}`)).data;
  return { appId: started.id as string, sectionId: ws.sections[0].id as string, orgId: org.id as string };
}

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: OWNER, username: `ai-owner-${OWNER.slice(-8)}`, passwordHash: "x" },
    { id: OTHER, username: `ai-other-${OTHER.slice(-8)}`, passwordHash: "x" },
  ]);
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "ai-jobs-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
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
  await stopJobWorker();
  server?.close();
  await db.delete(jobsTable).where(inArray(jobsTable.userId, [OWNER, OTHER]));
  await db.delete(grantApplicantsTable).where(inArray(grantApplicantsTable.userId, [OWNER, OTHER]));
  await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, opportunities));
  await db.delete(usersTable).where(inArray(usersTable.id, [OWNER, OTHER]));
});

describe("AI work as background jobs", () => {
  it("without a worker, runs the job in the request and reports a provider failure", async () => {
    const api = client(OWNER);
    const { sectionId } = await newApplication(api);
    fake.delayMs = 0;
    const ok = await api("POST", `/grants/sections/${sectionId}/draft`);
    expect(ok.status).toBe(200);
    expect(ok.data.section.content).toBe("<p>Drafted in the background.</p>");
    // Every request is still a recorded job.
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.dedupeKey, `ai:draft:${sectionId}`));
    expect(job).toMatchObject({ kind: "grant_section_draft", status: "succeeded", userId: OWNER, attempts: 1 });

    fake.fail = "Provider returned 529: overloaded";
    const failed = await api("POST", `/grants/sections/${sectionId}/draft`);
    expect(failed.status).toBe(502);
    expect(failed.data.error).toBe("Provider returned 529: overloaded");
    fake.fail = null;
  });

  it("with a worker, answers 202 for a slow call, shows it on the application, and finishes in the background", async () => {
    startJobWorker({ force: true, kinds: ["grant_section_draft", "grant_section_review", "grant_requirements_extract"], pollMs: 100 });
    const api = client(OWNER);
    const { appId, sectionId } = await newApplication(api);
    // Longer than two 3-second waits, so both requests come back while it is still running.
    fake.delayMs = 9000;
    const queued = await api("POST", `/grants/sections/${sectionId}/draft`);
    expect(queued.status).toBe(202);
    expect(queued.data).toMatchObject({ pending: true, jobId: expect.any(String) });
    // Asking again while it runs returns the same job instead of a second one.
    const again = await api("POST", `/grants/sections/${sectionId}/draft`);
    expect(again.data.jobId).toBe(queued.data.jobId);
    const during = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(during.aiJobs).toEqual([expect.objectContaining({ id: queued.data.jobId, kind: "grant_section_draft", sectionId })]);
    // The job belongs to its workspace.
    expect((await api("GET", `/jobs/${queued.data.jobId}`)).data).toMatchObject({ kind: "grant_section_draft", system: false });
    expect((await client(OTHER)("GET", `/jobs/${queued.data.jobId}`)).status).toBe(404);

    const until = Date.now() + 15_000;
    let status = "";
    while (Date.now() < until) {
      status = (await api("GET", `/jobs/${queued.data.jobId}`)).data.status;
      if (status === "succeeded" || status === "failed") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(status).toBe("succeeded");
    const after = (await api("GET", `/grants/applications/${appId}`)).data;
    expect(after.aiJobs).toEqual([]);
    expect(after.sections[0].content).toBe("<p>Drafted in the background.</p>");
    fake.delayMs = 0;
  }, 45_000);

  it("never drafts over an approved section", async () => {
    const api = client(OWNER);
    const { sectionId } = await newApplication(api);
    await api("PATCH", `/grants/sections/${sectionId}`, { content: "<p>Our own words, written by the team.</p>" });
    expect((await api("POST", `/grants/sections/${sectionId}/approve`)).status).toBe(200);
    expect((await api("POST", `/grants/sections/${sectionId}/draft`)).status).toBe(409);
  });
});
