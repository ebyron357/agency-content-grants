/**
 * Job definitions (docs/BACKGROUND_JOBS.md). Pure module: no database import,
 * so the retry and timeout rules are unit-tested on their own.
 */

export interface JobContext<P = Record<string, unknown>> {
  jobId: string;
  payload: P;
  attempt: number;
  /** Aborted when the job runs past its timeout or the worker is stopping. */
  signal: AbortSignal;
  /** Records progress for the status screen and counts as a heartbeat. */
  progress: (value: Record<string, unknown>) => Promise<void>;
}

export interface JobDefinition<P = Record<string, unknown>> {
  kind: string;
  /** Shown on the jobs screen. */
  label: string;
  maxAttempts: number;
  /** A run that takes longer is aborted and counts as a failed attempt. */
  timeoutMs: number;
  /** Delay before attempt n + 1 after attempt n failed (n starts at 1). */
  backoffMs: (attempt: number) => number;
  /** At most this many of this kind run at once in one worker. */
  concurrency: number;
  run: (ctx: JobContext<P>) => Promise<Record<string, unknown> | void>;
}

/** Exponential backoff with full jitter, capped: base, 2x base, 4x base ... up to max. */
export function exponentialBackoff(baseMs: number, maxMs: number, random: () => number = Math.random): (attempt: number) => number {
  return (attempt) => {
    const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
    return Math.round(ceiling / 2 + random() * (ceiling / 2));
  };
}

/** An error that should not be retried (bad input, a missing record). */
export class PermanentJobError extends Error {
  readonly permanent = true;
}

export function isPermanent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { permanent?: boolean }).permanent === true;
}

/** What happens after a failed attempt. */
export function afterFailure(attempt: number, maxAttempts: number, err: unknown, backoffMs: (n: number) => number, now = Date.now()): { status: "queued"; runAt: Date } | { status: "failed" } {
  if (isPermanent(err) || attempt >= maxAttempts) return { status: "failed" };
  return { status: "queued", runAt: new Date(now + backoffMs(attempt)) };
}

export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 2000) || "Unknown error";
}
