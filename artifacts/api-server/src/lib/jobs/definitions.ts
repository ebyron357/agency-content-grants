import { defineJob, enqueue, exponentialBackoff } from "./registry";
import { runGrantSync } from "../grants/ingest";
import { runRequirementsExtract, runSectionDraft, runSectionReview } from "../grants/aiWork";
import { runFoundationImport } from "../foundations/importer";
import { PermanentJobError } from "./types";

/**
 * The job kinds this API runs. Add a kind here, with its limits, and the
 * worker, the jobs screen and the schedules pick it up.
 */

/** Refreshes grant opportunities from every source, then sends match alerts and deadline reminders. */
export const grantSyncJob = defineJob<{ scheduleSlot?: string }>({
  kind: "grant_sync",
  label: "Refresh grant opportunities",
  maxAttempts: 3,
  timeoutMs: 20 * 60_000,
  backoffMs: exponentialBackoff(5 * 60_000, 60 * 60_000),
  concurrency: 1,
  run: async ({ progress, signal }) => {
    const result = await runGrantSync({ onProgress: (p) => progress(p), signal });
    return { ...result };
  },
});

/** The dedupe key that keeps one grant sync queued or running at a time. */
export const GRANT_SYNC_KEY = "grant_sync";

// ── Grant Studio AI work ───────────────────────────────────────────────────────
// One attempt plus one retry: a provider error is often transient, and each
// run replaces its own output, so running again is safe. The user waits a few
// seconds for a fast answer; otherwise the page follows the job.

const AI_LIMITS = { maxAttempts: 2, timeoutMs: 3 * 60_000, backoffMs: exponentialBackoff(15_000, 60_000), concurrency: 2 } as const;

export const sectionDraftJob = defineJob<{ sectionId: string; userId: string }>({
  kind: "grant_section_draft",
  label: "Draft a section with AI",
  ...AI_LIMITS,
  run: ({ payload }) => runSectionDraft(payload.sectionId, payload.userId),
});

export const sectionReviewJob = defineJob<{ sectionId: string; userId: string }>({
  kind: "grant_section_review",
  label: "Review a section",
  ...AI_LIMITS,
  run: ({ payload }) => runSectionReview(payload.sectionId, payload.userId),
});

export const requirementsExtractJob = defineJob<{ applicationId: string; userId: string }>({
  kind: "grant_requirements_extract",
  label: "Extract requirements from a notice",
  ...AI_LIMITS,
  run: ({ payload }) => runRequirementsExtract(payload.applicationId, payload.userId),
});

/** Keys that keep one AI job per section (or application) queued or running at a time. */
export const aiKey = (kind: "draft" | "review" | "extract", id: string) => `ai:${kind}:${id}`;

// ── Foundation giving history ──────────────────────────────────────────────────
// Streams funder-graph's Parquet partitions into per-funder aggregates. A retry
// is safe: filings already counted are skipped (lib/foundations/aggregate.ts).

export const foundationImportJob = defineJob<{ scheduleSlot?: string }>({
  kind: "foundation_import",
  label: "Import foundation giving history",
  maxAttempts: 2,
  timeoutMs: 3 * 60 * 60_000,
  backoffMs: exponentialBackoff(10 * 60_000, 60 * 60_000),
  concurrency: 1,
  run: async ({ jobId, progress, signal }) => {
    // The import needs more memory and database than the current plans hold; the owner turns it on (docs/GRANT_STUDIO.md, Foundations).
    if (!foundationImportEnabled()) throw new PermanentJobError("The foundation import is off on this server. Set FOUNDATIONS_IMPORT_ENABLED=true to run it.");
    const result = await runFoundationImport({ jobId, signal, onProgress: (p) => progress(p) });
    return { ...result };
  },
});

/** The dedupe key that keeps one foundation import queued or running at a time. */
export const FOUNDATION_IMPORT_KEY = "foundation_import";

/** Off unless the owner sets FOUNDATIONS_IMPORT_ENABLED=true: no import runs, by schedule or by hand, until then. */
export const foundationImportEnabled = () => process.env.FOUNDATIONS_IMPORT_ENABLED === "true";
// ── Source registry (docs/SOURCE_REGISTRY.md) ────────────────────────────────

export const sourceExtractJob = defineJob<{ checkId: string }>({
  kind: "source_extract",
  label: "Extract opportunities from a changed page",
  ...AI_LIMITS,
  concurrency: 1,
  run: async ({ payload }) => {
    const { extractFromCheck } = await import("../grants/sources/service");
    return { ...(await extractFromCheck(payload.checkId)) };
  },
});

export const sourceCheckJob = defineJob<{ sourceId: string }>({
  kind: "source_check",
  label: "Check a watched page",
  maxAttempts: 2,
  timeoutMs: 2 * 60_000,
  backoffMs: exponentialBackoff(60_000, 10 * 60_000),
  concurrency: 1,
  run: async ({ payload }) => {
    const { checkSource } = await import("../grants/sources/service");
    const result = await checkSource(payload.sourceId);
    let extractJobId: string | null = null;
    if (result.extract && result.checkId) extractJobId = (await enqueue(sourceExtractJob, { checkId: result.checkId }, { dedupeKey: `source:extract:${result.checkId}`, requestedBy: "system" })).job.id;
    return { ...result, extractJobId };
  },
});

/** Enqueues a check of every active page source whose schedule has come round. Runs hourly. */
export const sourceSweepJob = defineJob<{ scheduleSlot?: string }>({
  kind: "source_sweep",
  label: "Check watched pages that are due",
  maxAttempts: 2,
  timeoutMs: 5 * 60_000,
  backoffMs: exponentialBackoff(60_000, 10 * 60_000),
  concurrency: 1,
  run: async () => {
    const { dueSources } = await import("../grants/sources/service");
    const due = await dueSources();
    for (const s of due) await enqueue(sourceCheckJob, { sourceId: s.id }, { dedupeKey: sourceCheckKey(s.id), requestedBy: "schedule" });
    return { queued: due.length };
  },
});

export const sourceCheckKey = (sourceId: string) => `source:check:${sourceId}`;
export const SOURCE_SWEEP_KEY = "source_sweep";
