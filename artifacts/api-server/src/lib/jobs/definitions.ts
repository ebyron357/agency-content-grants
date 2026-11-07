import { defineJob, enqueue, exponentialBackoff } from "./registry";
import { runGrantSync } from "../grants/ingest";
import { runRequirementsExtract, runSectionDraft, runSectionReview } from "../grants/aiWork";
import { runFoundationImport } from "../foundations/importer";
import { PermanentJobError, isPermanent } from "./types";
import { confirmAiDraftedApplication, releaseAiDraftClaim, type AiDraftUsage } from "../billing/service";
import { runNoticeChecklist } from "../grants/noticeWork";

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

/**
 * The billing fields are present only while billing is on (docs/BILLING.md):
 * a successful draft confirms the application's monthly count, and a draft
 * that finally fails releases the reservation its request made.
 */
export const sectionDraftJob = defineJob<{ sectionId: string; userId: string } & Partial<AiDraftUsage>>({
  kind: "grant_section_draft",
  label: "Draft a section with AI",
  ...AI_LIMITS,
  run: async ({ payload, attempt }) => {
    let result: Awaited<ReturnType<typeof runSectionDraft>>;
    try {
      result = await runSectionDraft(payload.sectionId, payload.userId);
    } catch (err) {
      if (payload.usageClaimId && (isPermanent(err) || attempt >= AI_LIMITS.maxAttempts)) {
        await releaseAiDraftClaim(payload.usageClaimId).catch(() => {});
      }
      throw err;
    }
    if (payload.usageWorkspaceId && payload.usagePeriod && payload.usageApplicationId) {
      await confirmAiDraftedApplication({ usageWorkspaceId: payload.usageWorkspaceId, usagePeriod: payload.usagePeriod, usageApplicationId: payload.usageApplicationId });
    }
    return result;
  },
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

/**
 * Reads an attached notice PDF page by page and proposes requirement rows with
 * page citations. Reading a long notice and several AI requests take longer
 * than the other AI work, so the timeout is 10 minutes. One attempt plus one
 * retry: a run replaces its own unreviewed proposals, so running again is safe.
 * File problems (not a PDF, password, scanned) are permanent and not retried.
 */
export const noticeChecklistJob = defineJob<{ noticeId: string; userId: string }>({
  kind: "grant_notice_checklist",
  label: "Read a notice PDF and propose its checklist",
  maxAttempts: 2,
  timeoutMs: 10 * 60_000,
  backoffMs: exponentialBackoff(15_000, 60_000),
  concurrency: 1,
  run: ({ payload, signal, progress }) => runNoticeChecklist(payload.noticeId, payload.userId, { signal, progress }),
});

/** Keys that keep one AI job per section (or application) queued or running at a time. */
export const aiKey = (kind: "draft" | "review" | "extract" | "notice", id: string) => `ai:${kind}:${id}`;

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
// ── Past federal awards (USAspending) ───────────────────────────────────────────
// Reads one Assistance Listing's recent grants into usaspending_award_cache. A
// retry is safe: each run replaces the listing's row.

export const usaspendingAwardsJob = defineJob<{ programNumber: string }>({
  kind: "usaspending_awards",
  label: "Read past federal awards from USAspending",
  maxAttempts: 2,
  timeoutMs: 2 * 60_000,
  backoffMs: exponentialBackoff(60_000, 10 * 60_000),
  concurrency: 1,
  run: async ({ payload, signal }) => {
    const { refreshListing } = await import("../grants/pastAwards");
    return { ...(await refreshListing(payload.programNumber, { signal })) };
  },
});

/** One read per listing queued or running at a time. */
export const usaspendingKey = (programNumber: string) => `usaspending:${programNumber}`;

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
