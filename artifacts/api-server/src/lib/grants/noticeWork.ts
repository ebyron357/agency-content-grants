import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, grantApplicantsTable, grantApplicationsTable, grantNoticesTable, grantRequirementsTable, type GrantNotice } from "@workspace/db";
import { generateForStage } from "../ai/router";
import { deleteSourcePdf, readSourcePdf, storeSourcePdf } from "../sourceStorage";
import { PermanentJobError } from "../jobs/types";
import { invalidatePackage } from "./aiWork";
import { NoticeFileError, assertNoticeFile, noticeConfig, noticeFileName, readNoticePages, sha256, textCoverage } from "./noticePdf";
import { proposeChecklist, type Generate } from "./noticeChecklist";
import { noticeFetcher } from "./noticeFetch";

/**
 * The notice checklist job (docs/GRANT_STUDIO.md, Notice PDF and requirement
 * checklist): fetch the PDF when it came from a link, read its pages, and
 * propose requirement rows with page citations into the compliance matrix,
 * each unconfirmed until a person confirms it.
 *
 * A rerun replaces the earlier proposals nobody has acted on. Rows a person
 * confirmed or rejected are kept, and a proposal that repeats one of them is
 * not added again.
 */

export const NOTICE_ORIGIN = "notice";

async function ownedNotice(noticeId: string, userId: string): Promise<{ notice: GrantNotice; applicationId: string }> {
  const [found] = await db
    .select({ notice: grantNoticesTable, applicationId: grantApplicationsTable.id })
    .from(grantNoticesTable)
    .innerJoin(grantApplicationsTable, eq(grantNoticesTable.applicationId, grantApplicationsTable.id))
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantNoticesTable.id, noticeId), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!found) throw new PermanentJobError("The notice no longer exists.");
  return found;
}

async function setNotice(id: string, values: Partial<typeof grantNoticesTable.$inferInsert>): Promise<void> {
  await db.update(grantNoticesTable).set(values).where(eq(grantNoticesTable.id, id));
}

const keyOf = (label: string, page: number | null) => `${label.trim().toLowerCase().replace(/\s+/g, " ")}|${page ?? ""}`;

export interface NoticeRunOptions {
  signal?: AbortSignal;
  progress?: (value: Record<string, unknown>) => Promise<void>;
  /** Tests pass a fake model. Defaults to the configured AI provider (the demo provider when none is). */
  generate?: Generate;
}

export async function runNoticeChecklist(noticeId: string, userId: string, opts: NoticeRunOptions = {}): Promise<Record<string, unknown>> {
  const { notice, applicationId } = await ownedNotice(noticeId, userId);
  const cfg = noticeConfig();
  const progress = opts.progress ?? (async () => {});
  try {
    // 1. The file: fetched now when the notice came from a link.
    let fileKey = notice.fileKey;
    let buffer: Buffer;
    if (!fileKey) {
      if (!notice.sourceUrl) throw new PermanentJobError("The notice has no file and no link.");
      await setNotice(notice.id, { status: "reading", error: null });
      await progress({ stage: "downloading" });
      const fetched = await noticeFetcher()(notice.sourceUrl, { maxBytes: cfg.maxBytes, signal: opts.signal });
      try {
        assertNoticeFile(fetched.buffer, cfg);
      } catch (err) {
        const type = fetched.contentType?.split(";")[0] ?? "unknown";
        if (err instanceof NoticeFileError && /not a PDF/.test(err.message)) {
          throw new NoticeFileError(`The link returned ${type === "text/html" ? "a web page" : `a ${type} file`}, not a PDF. Open the link, download the notice PDF and attach it here.`);
        }
        throw err;
      }
      fileKey = await storeSourcePdf(fetched.buffer);
      buffer = fetched.buffer;
      await setNotice(notice.id, { fileKey, fileBytes: fetched.buffer.length, sha256: sha256(fetched.buffer), fileName: noticeFileName(fetched.fileName, notice.fileName) });
    } else {
      buffer = await readSourcePdf(fileKey);
    }

    // 2. The pages, one at a time.
    await setNotice(notice.id, { status: "reading", error: null });
    const read = await readNoticePages(buffer, {
      maxPages: cfg.maxPages,
      signal: opts.signal,
      onPage: async (n, total) => {
        if (n === total || n % 10 === 0) await progress({ stage: "reading", page: n, pages: total });
      },
    });
    buffer = Buffer.alloc(0);
    const coverage = textCoverage(read.pages);
    await setNotice(notice.id, { status: "extracting", extractor: read.extractor, extractorNote: read.note ?? null, pageCount: read.pageCount, pagesRead: read.pages.length, truncated: read.truncated, pages: read.pages });
    if (coverage.scanned) {
      throw new NoticeFileError("No text was found on any page: the notice looks scanned. Text recognition (OCR) is not available yet; add the requirements by hand, or attach a PDF with a text layer.");
    }

    // 3. The checklist, validated against the pages it cites.
    await progress({ stage: "checklist", pages: read.pages.length });
    const generate: Generate = opts.generate ?? ((messages, options) => generateForStage("planning", messages, options));
    const outcome = await proposeChecklist(read.pages, generate, {
      signal: opts.signal,
      onChunk: (done, total) => progress({ stage: "checklist", chunk: done, chunks: total, pages: read.pages.length }),
    });

    // 4. Into the compliance matrix, replacing the earlier proposals nobody has acted on.
    const existing = await db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, applicationId));
    const stale = existing.filter((r) => r.origin === NOTICE_ORIGIN && !r.confirmed && !r.rejectedAt).map((r) => r.id);
    const kept = new Set(existing.filter((r) => !stale.includes(r.id)).map((r) => keyOf(r.label, r.page)));
    const fresh = outcome.accepted.filter((r) => !kept.has(keyOf(r.label, r.page)));
    await db.transaction(async (tx) => {
      if (stale.length) await tx.delete(grantRequirementsTable).where(inArray(grantRequirementsTable.id, stale));
      if (fresh.length) {
        const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${grantRequirementsTable.position}), 0)` }).from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, applicationId));
        await tx.insert(grantRequirementsTable).values(fresh.map((r, i) => ({
          id: randomUUID(),
          applicationId,
          kind: r.kind,
          label: r.label,
          detail: r.detail,
          sourceRef: `Notice p. ${r.page}`,
          points: r.points,
          origin: NOTICE_ORIGIN,
          confirmed: false,
          position: Number(max) + 1 + i,
          noticeId: notice.id,
          page: r.page,
          quote: r.quote,
          extractedBy: outcome.extractedBy,
        })));
      }
    });
    if (stale.length || fresh.length) await invalidatePackage(applicationId);
    const note = [read.truncated ? `Only the first ${read.pages.length} of ${read.pageCount} pages were read (the limit is ${cfg.maxPages}).` : null, outcome.message].filter(Boolean).join(" ") || null;
    await setNotice(notice.id, { status: "ready", checklistProvider: outcome.provider, checklistDemo: outcome.demo, proposed: fresh.length, dropped: outcome.rejected.length, error: note });
    return { proposed: fresh.length, dropped: outcome.rejected.length, pages: read.pages.length, pageCount: read.pageCount, truncated: read.truncated, demo: outcome.demo, extractor: read.extractor, message: note };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 1000) : String(err);
    await setNotice(notice.id, { status: "failed", error: message }).catch(() => {});
    if (err instanceof NoticeFileError) throw new PermanentJobError(message);
    throw err;
  }
}

/** Removes the stored notice files of these applications (before the rows are deleted). */
export async function deleteNoticeFiles(applicationIds: string[]): Promise<void> {
  if (!applicationIds.length) return;
  const rows = await db.select({ fileKey: grantNoticesTable.fileKey }).from(grantNoticesTable).where(inArray(grantNoticesTable.applicationId, applicationIds));
  await Promise.all(rows.filter((r) => r.fileKey).map((r) => deleteSourcePdf(r.fileKey!).catch(() => {})));
}

/** Removes an application's notice: its file, its row and the proposals nobody has acted on. Confirmed and rejected rows stay. */
export async function removeNotice(applicationId: string): Promise<boolean> {
  const [notice] = await db.select().from(grantNoticesTable).where(eq(grantNoticesTable.applicationId, applicationId)).limit(1);
  if (!notice) return false;
  const removed = await db.delete(grantRequirementsTable).where(and(eq(grantRequirementsTable.noticeId, notice.id), eq(grantRequirementsTable.confirmed, false), isNull(grantRequirementsTable.rejectedAt))).returning({ id: grantRequirementsTable.id });
  await db.delete(grantNoticesTable).where(eq(grantNoticesTable.id, notice.id));
  if (notice.fileKey) await deleteSourcePdf(notice.fileKey).catch(() => {});
  if (removed.length) await invalidatePackage(applicationId);
  return true;
}
