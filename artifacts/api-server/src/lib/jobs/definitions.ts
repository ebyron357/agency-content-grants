import { defineJob, exponentialBackoff } from "./registry";
import { runGrantSync } from "../grants/ingest";
import { runRequirementsExtract, runSectionDraft, runSectionReview } from "../grants/aiWork";
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
