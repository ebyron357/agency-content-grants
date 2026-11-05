/**
 * The job queue against the real test database: enqueue and dedupe, claiming
 * under contention (SKIP LOCKED), the worker's retries, permanent failures and
 * timeouts, stale-job reclaim, cancel and retry, recurring schedules, and the
 * HTTP routes. The test worker only runs this file's own job kinds, so the
 * grant sync is never really started.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";
import { defineJob, enqueue } from "./registry";
import { activeJob, claimNextJob, reclaimStaleJobs, retryJob, cancelJob } from "./queue";
import { JobWorker } from "./worker";
import { PermanentJobError } from "./types";
import { runSchedules, SCHEDULES } from "./schedules";
import { GRANT_SYNC_KEY } from "./definitions";
import { router } from "../../routes/index";

const PREFIX = `test_${Date.now()}`;
const flakyCalls = new Map<string, number>();

const okJob = defineJob<{ n: number }>({ kind: `${PREFIX}_ok`, label: "Test ok", maxAttempts: 3, timeoutMs: 5000, backoffMs: () => 0, concurrency: 2, run: async ({ payload, progress }) => {
  await progress({ step: "half" });
  return { doubled: payload.n * 2 };
} });
const flakyJob = defineJob<{ key: string }>({ kind: `${PREFIX}_flaky`, label: "Test flaky", maxAttempts: 3, timeoutMs: 5000, backoffMs: () => 0, concurrency: 1, run: async ({ payload, attempt }) => {
  flakyCalls.set(payload.key, (flakyCalls.get(payload.key) ?? 0) + 1);
  if (attempt < 2) throw new Error("Upstream 503");
  return { attempt };
} });
const permanentJob = defineJob({ kind: `${PREFIX}_permanent`, label: "Test permanent", maxAttempts: 5, timeoutMs: 5000, backoffMs: () => 0, concurrency: 1, run: async () => {
  throw new PermanentJobError("The record no longer exists.");
} });
const slowJob = defineJob({ kind: `${PREFIX}_slow`, label: "Test slow", maxAttempts: 1, timeoutMs: 150, backoffMs: () => 0, concurrency: 1, run: () => new Promise((resolve) => setTimeout(resolve, 5000)) });
const kinds = [okJob, flakyJob, permanentJob, slowJob].map((d) => d.kind);

async function waitFor(id: string, statuses: string[], ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (statuses.includes(job.status)) return job;
    if (Date.now() > until) throw new Error(`job ${id} stayed ${job.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let worker: JobWorker | null = null;
let server: Server;
let base = "";
/**
 * The sign-in rate limits are keyed by client address and stored in the shared test database. Test files run in
 * parallel, so each file signs in from its own documentation-range address (RFC 5737) instead of sharing 127.0.0.1;
 * otherwise sign-ins from other files can fill this file's counter and return 429.
 */
const CLIENT_ADDRESS = "198.51.100.14";

beforeAll(() => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use(session({ secret: "jobs-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await worker?.stop(1000);
  worker = null;
});

afterAll(async () => {
  server?.close();
  await db.delete(jobsTable).where(like(jobsTable.kind, `${PREFIX}_%`));
  await db.delete(jobsTable).where(eq(jobsTable.kind, "grant_sync"));
});

describe("job queue", () => {
  it("dedupes active jobs by key", async () => {
    const a = await enqueue(okJob, { n: 1 }, { dedupeKey: `${PREFIX}-one` });
    const b = await enqueue(okJob, { n: 2 }, { dedupeKey: `${PREFIX}-one` });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect((await activeJob(`${PREFIX}-one`))?.id).toBe(a.job.id);
    expect(await cancelJob(a.job.id)).toBe(true);
    // Once it is no longer active, the key is free again.
    expect((await enqueue(okJob, { n: 3 }, { dedupeKey: `${PREFIX}-one` })).created).toBe(true);
  });

  it("never gives the same job to two workers", async () => {
    await db.delete(jobsTable).where(inArray(jobsTable.kind, kinds));
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) ids.add((await enqueue(okJob, { n: i })).job.id);
    const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => claimNextJob(`w${i % 3}`, [okJob.kind])));
    const claimed = claims.filter(Boolean).map((j) => j!.id);
    expect(claimed).toHaveLength(8);
    expect(new Set(claimed).size).toBe(8);
    expect([...claimed].sort()).toEqual([...ids].sort());
    await db.delete(jobsTable).where(inArray(jobsTable.id, claimed));
  });

  it("runs jobs, retries failures with backoff, and stops on permanent errors and timeouts", async () => {
    worker = new JobWorker({ concurrency: 3, pollMs: 50, kinds });
    worker.start();
    const ok = (await enqueue(okJob, { n: 21 })).job;
    const flaky = (await enqueue(flakyJob, { key: ok.id })).job;
    const permanent = (await enqueue(permanentJob, {})).job;
    const slow = (await enqueue(slowJob, {})).job;
    worker.nudge();

    const okDone = await waitFor(ok.id, ["succeeded"]);
    expect(okDone.result).toEqual({ doubled: 42 });
    expect(okDone.progress).toEqual({ step: "half" });
    expect(okDone.attempts).toBe(1);

    const flakyDone = await waitFor(flaky.id, ["succeeded"]);
    expect(flakyDone.attempts).toBe(2);
    expect(flakyCalls.get(ok.id)).toBe(2);

    const permanentDone = await waitFor(permanent.id, ["failed"]);
    expect(permanentDone.attempts).toBe(1);
    expect(permanentDone.lastError).toBe("The record no longer exists.");

    const slowDone = await waitFor(slow.id, ["failed"]);
    expect(slowDone.lastError).toMatch(/Timed out/);
    expect(worker.status().running).toEqual([]);
  });

  it("puts back jobs whose worker stopped, and fails them when out of attempts", async () => {
    const a = (await enqueue(okJob, { n: 1 })).job;
    const b = (await enqueue(slowJob, {})).job;
    const old = new Date(Date.now() - 10 * 60_000);
    await db.update(jobsTable).set({ status: "running", lockedBy: "gone", heartbeatAt: old, attempts: 1 }).where(inArray(jobsTable.id, [a.id, b.id]));
    expect(await reclaimStaleJobs()).toBeGreaterThanOrEqual(2);
    const [ra] = await db.select().from(jobsTable).where(eq(jobsTable.id, a.id));
    const [rb] = await db.select().from(jobsTable).where(eq(jobsTable.id, b.id));
    expect(ra.status).toBe("queued");
    expect(rb.status).toBe("failed");
    expect(rb.lastError).toMatch(/worker stopped/);
    // A failed job can be retried from its first attempt.
    const retried = await retryJob(b.id);
    expect(retried).toMatchObject({ status: "queued", attempts: 0, lastError: null });
    expect(await retryJob(a.id)).toBeNull();
    await db.delete(jobsTable).where(inArray(jobsTable.id, [a.id, b.id]));
  });

  it("enqueues each schedule once per slot, and counts a manual run", async () => {
    const saved = process.env.GRANTS_SYNC_ENABLED;
    process.env.GRANTS_SYNC_ENABLED = "true";
    try {
      await db.delete(jobsTable).where(eq(jobsTable.kind, "grant_sync"));
      const startedAt = Date.now() - 120_000;
      expect(await runSchedules(startedAt)).toEqual(["grant-sync-daily"]);
      expect(await runSchedules(startedAt)).toEqual([]);
      const [scheduled] = await db.select().from(jobsTable).where(eq(jobsTable.kind, "grant_sync"));
      expect(scheduled.requestedBy).toBe("schedule");
      expect((scheduled.payload as { scheduleSlot: string }).scheduleSlot).toMatch(/^grant-sync-daily:\d+$/);
      // A job of the kind already in this slot (here the one above, even once finished) covers it.
      await db.update(jobsTable).set({ status: "succeeded", finishedAt: new Date() }).where(eq(jobsTable.id, scheduled.id));
      expect(await runSchedules(startedAt)).toEqual([]);
      // The next slot gets its own job.
      const next = Date.now() + SCHEDULES[0].everyMs;
      expect(await runSchedules(startedAt, next)).toEqual(["grant-sync-daily"]);
    } finally {
      if (saved === undefined) delete process.env.GRANTS_SYNC_ENABLED;
      else process.env.GRANTS_SYNC_ENABLED = saved;
      await db.delete(jobsTable).where(eq(jobsTable.kind, "grant_sync"));
    }
  });

  it("queues a grant refresh once and exposes it to the screens", async () => {
    let cookie = "";
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base}/api${path}`, { method, headers: { "X-Forwarded-For": CLIENT_ADDRESS, ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return { status: res.status, data: (await res.json().catch(() => null)) as any };
    };
    await call("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    const first = await call("POST", "/grants/sync");
    expect(first.status).toBe(202);
    expect(first.data.status).toBe("queued");
    const second = await call("POST", "/grants/sync");
    expect(second.data.jobId).toBe(first.data.jobId);
    expect((await call("GET", "/grants/meta")).data).toMatchObject({ syncRunning: true, syncJob: { id: first.data.jobId, status: "queued" } });
    expect((await call("GET", `/jobs/${first.data.jobId}`)).data).toMatchObject({ kind: "grant_sync", label: "Refresh grant opportunities", system: true });

    // The jobs screen, cancel and retry need admin unlock.
    expect((await call("GET", "/jobs")).status).toBe(403);
    expect((await call("POST", `/jobs/${first.data.jobId}/cancel`)).status).toBe(403);
    await call("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD });
    const list = (await call("GET", "/jobs?kind=grant_sync")).data;
    expect(list.jobs.map((j: any) => j.id)).toContain(first.data.jobId);
    expect(list.kinds.map((k: any) => k.kind)).toContain("grant_sync");
    expect(list.schedules[0]).toMatchObject({ name: "grant-sync-daily", everyHours: 24 });
    expect(list.counts.queued).toBeGreaterThanOrEqual(1);
    expect((await call("POST", `/jobs/${first.data.jobId}/cancel`)).data.status).toBe("cancelled");
    expect((await call("GET", "/grants/meta")).data.syncJob).toBeNull();
    expect((await call("POST", `/jobs/${first.data.jobId}/retry`)).data.status).toBe("queued");
    expect((await activeJob(GRANT_SYNC_KEY))?.id).toBe(first.data.jobId);
    expect((await call("GET", "/jobs/not-a-job")).status).toBe(404);
  });
});
