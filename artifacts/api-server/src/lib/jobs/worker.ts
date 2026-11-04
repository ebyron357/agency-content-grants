import { randomUUID } from "crypto";
import { hostname } from "os";
import { claimNextJob, completeJob, failJobAttempt, heartbeatJob, pruneFinishedJobs, reclaimStaleJobs } from "./queue";
import { jobKinds, jobDefinition } from "./registry";
import { afterFailure, errorText } from "./types";
import type { Job } from "@workspace/db";

/**
 * The background worker (docs/BACKGROUND_JOBS.md). Runs inside the API
 * process: it polls the queue, runs up to `concurrency` jobs at once (and each
 * kind up to its own limit), reports a heartbeat while a job runs, aborts a job
 * that passes its timeout, and on shutdown waits briefly for running jobs.
 * Anything still running at exit is put back by the next worker's reclaim.
 */

export const HEARTBEAT_MS = 15_000;
const MAINTENANCE_MS = 60_000;
const PRUNE_MS = 24 * 60 * 60_000;

export interface WorkerStatus {
  id: string;
  startedAt: string;
  lastPollAt: string | null;
  concurrency: number;
  running: { id: string; kind: string; startedAt: string }[];
}

interface Running {
  job: Job;
  controller: AbortController;
  done: Promise<void>;
}

export class JobWorker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly startedAt = new Date();
  private lastPollAt: Date | null = null;
  private readonly running = new Map<string, Running>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private lastPrune = 0;
  private stopping = false;
  private polling = false;

  /** `kinds` limits this worker to some job kinds; by default it runs every registered kind. */
  constructor(private readonly opts: { concurrency: number; pollMs: number; kinds?: string[] }) {}

  start(): void {
    void this.maintenance();
    this.maintenanceTimer = setInterval(() => void this.maintenance(), MAINTENANCE_MS);
    this.schedulePoll(0);
  }

  status(): WorkerStatus {
    return {
      id: this.id,
      startedAt: this.startedAt.toISOString(),
      lastPollAt: this.lastPollAt?.toISOString() ?? null,
      concurrency: this.opts.concurrency,
      running: [...this.running.values()].map((r) => ({ id: r.job.id, kind: r.job.kind, startedAt: (r.job.startedAt ?? new Date()).toISOString() })),
    };
  }

  /** Wakes the worker now, for example right after a job was enqueued. */
  nudge(): void {
    if (!this.stopping) this.schedulePoll(0);
  }

  async stop(graceMs = 25_000): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    const all = Promise.all([...this.running.values()].map((r) => r.done));
    const timedOut = await Promise.race([all.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), graceMs).unref())]);
    if (timedOut) for (const r of this.running.values()) r.controller.abort(new Error("The worker is stopping."));
  }

  private schedulePoll(delay: number): void {
    if (this.stopping) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delay);
    this.pollTimer.unref?.();
  }

  private async maintenance(): Promise<void> {
    try {
      await reclaimStaleJobs();
      if (Date.now() - this.lastPrune > PRUNE_MS) {
        this.lastPrune = Date.now();
        await pruneFinishedJobs();
      }
    } catch (err) {
      console.warn("[jobs] maintenance failed", errorText(err));
    }
  }

  /** Kinds that still have a free slot. */
  private availableKinds(): string[] {
    const perKind = new Map<string, number>();
    for (const r of this.running.values()) perKind.set(r.job.kind, (perKind.get(r.job.kind) ?? 0) + 1);
    return jobKinds()
      .filter((d) => !this.opts.kinds || this.opts.kinds.includes(d.kind))
      .filter((d) => (perKind.get(d.kind) ?? 0) < d.concurrency)
      .map((d) => d.kind);
  }

  private async poll(): Promise<void> {
    if (this.stopping || this.polling) return;
    this.polling = true;
    try {
      this.lastPollAt = new Date();
      while (!this.stopping && this.running.size < this.opts.concurrency) {
        const job = await claimNextJob(this.id, this.availableKinds());
        if (!job) break;
        this.launch(job);
      }
    } catch (err) {
      console.warn("[jobs] poll failed", errorText(err));
    } finally {
      this.polling = false;
      this.schedulePoll(this.opts.pollMs);
    }
  }

  private launch(job: Job): void {
    const controller = new AbortController();
    const done = this.execute(job, controller).finally(() => {
      this.running.delete(job.id);
      this.nudge();
    });
    this.running.set(job.id, { job, controller, done });
  }

  private async execute(job: Job, controller: AbortController): Promise<void> {
    const def = jobDefinition(job.kind);
    if (!def) {
      await failJobAttempt(job.id, this.id, `No handler for job kind ${job.kind}`, { status: "failed" });
      return;
    }
    const heartbeat = setInterval(() => void heartbeatJob(job.id, this.id).catch(() => {}), HEARTBEAT_MS);
    const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${Math.round(def.timeoutMs / 1000)} s`)), def.timeoutMs);
    try {
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
      const result = await Promise.race([
        def.run({ jobId: job.id, payload: job.payload as Record<string, unknown>, attempt: job.attempts, signal: controller.signal, progress: (p) => heartbeatJob(job.id, this.id, p) }),
        aborted,
      ]);
      await completeJob(job.id, this.id, result ?? null);
    } catch (err) {
      const next = afterFailure(job.attempts, job.maxAttempts, err, def.backoffMs);
      console.warn(`[jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed: ${errorText(err)}${next.status === "queued" ? ` (retry at ${next.runAt.toISOString()})` : ""}`);
      await failJobAttempt(job.id, this.id, errorText(err), next).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    }
  }
}

let worker: JobWorker | null = null;

export function workerEnabled(): boolean {
  if (process.env.JOBS_WORKER_DISABLED === "true") return false;
  return process.env.NODE_ENV !== "test" || process.env.JOBS_WORKER_ENABLED === "true";
}

export function startJobWorker(): JobWorker | null {
  if (worker || !workerEnabled()) return worker;
  const concurrency = Math.max(1, Math.min(8, Number(process.env.JOBS_CONCURRENCY) || 2));
  worker = new JobWorker({ concurrency, pollMs: Number(process.env.JOBS_POLL_MS) || 5_000 });
  worker.start();
  return worker;
}

export function currentWorker(): JobWorker | null {
  return worker;
}

export async function stopJobWorker(): Promise<void> {
  const w = worker;
  worker = null;
  await w?.stop();
}
