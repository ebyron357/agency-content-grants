import { exponentialBackoff, type JobDefinition } from "./types";
import { enqueueJob, type EnqueueOptions } from "./queue";

/**
 * Every kind of background job, as data (docs/BACKGROUND_JOBS.md). The worker
 * runs only kinds listed here; enqueueing an unknown kind is an error.
 */
const definitions = new Map<string, JobDefinition<any>>();

export function defineJob<P extends Record<string, unknown>>(def: JobDefinition<P>): JobDefinition<P> {
  if (definitions.has(def.kind)) throw new Error(`Job kind ${def.kind} is defined twice`);
  definitions.set(def.kind, def);
  return def;
}

export function jobDefinition(kind: string): JobDefinition | undefined {
  return definitions.get(kind);
}

export function jobKinds(): JobDefinition[] {
  return [...definitions.values()];
}

export function enqueue<P extends Record<string, unknown>>(def: JobDefinition<P>, payload: P, opts: EnqueueOptions = {}) {
  if (!definitions.has(def.kind)) throw new Error(`Unknown job kind ${def.kind}`);
  return enqueueJob(def.kind, payload, { ...opts, maxAttempts: opts.maxAttempts ?? def.maxAttempts });
}

export { exponentialBackoff };
