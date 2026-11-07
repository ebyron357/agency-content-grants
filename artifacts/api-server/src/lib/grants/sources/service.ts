import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, modelConfigTable, grantOpportunitiesTable, grantSourceChecksTable, grantSourceDraftsTable, grantSourcesTable, type GrantSource, type GrantSourceDraft } from "@workspace/db";
import { generateForStage, getActiveProvider } from "../../ai/router";
import { contentHash, cheapModelFor, extractCandidates, extractLinks, htmlPageToText, type CandidateDraft, type GenerateFn, type PageSnapshot } from "./extraction";
import { builtinFetch, userAgent, type PageFetchLike } from "./fetcher";
import { ChangeDetectionClient, watcherSettings, type FetchFn, type WatcherSettings } from "./changedetection";
import { webhookSecret } from "./webhookAuth";
import { freshness, isDue, isPageSource, mayRun } from "./registry";
import { approvalCheck, opportunityFromDraft } from "./promote";

/**
 * The source registry's database work (docs/SOURCE_REGISTRY.md): checking
 * watched pages, extracting drafts, and approving drafts into opportunities.
 * The routes in routes/sources-registry.ts and the jobs in lib/jobs/definitions.ts call these.
 */

/** Injected in tests; production uses the real network and the configured AI provider. */
export interface ServiceDeps {
  fetchPage?: PageFetchLike;
  changeDetectionFetch?: FetchFn;
  generate?: GenerateFn;
  settings?: WatcherSettings;
  now?: () => Date;
}

export function currentSettings(): WatcherSettings {
  return watcherSettings(process.env, webhookSecret());
}

/** The cheap model tier: a configured utility model if set, else the active provider's cheapest model. */
export const defaultGenerate: GenerateFn = async (messages, options) => {
  const provider = getActiveProvider();
  if (provider.name === "demo") return generateForStage("utility", messages, options);
  const configured = process.env.SOURCE_EXTRACT_MODEL ? undefined : await utilityModel();
  if (configured) return generateForStage("utility", messages, options);
  return provider.generate(messages, { ...options, model: cheapModelFor(provider.name) });
};

async function utilityModel(): Promise<string | null> {
  try {
    const [row] = await db.select({ utilityModel: modelConfigTable.utilityModel }).from(modelConfigTable).where(eq(modelConfigTable.id, "singleton")).limit(1);
    return row?.utilityModel ?? null;
  } catch {
    return null;
  }
}

export interface CheckResult {
  sourceId: string;
  checkId: string | null;
  outcome: "unchanged" | "changed" | "failed" | "skipped";
  error?: string;
  /** The extraction job to run, when the page changed. */
  extract?: boolean;
}

async function recordFailure(source: GrantSource, backend: string, now: Date, error: string, httpStatus: number | null = null): Promise<CheckResult> {
  const checkId = randomUUID();
  await db.insert(grantSourceChecksTable).values({ id: checkId, sourceId: source.id, checkedAt: now, backend, outcome: "failed", httpStatus, error: error.slice(0, 500) });
  await db.update(grantSourcesTable).set({ lastCheckedAt: now, lastError: error.slice(0, 500) }).where(eq(grantSourcesTable.id, source.id));
  return { sourceId: source.id, checkId, outcome: "failed", error };
}

/** Stores a page snapshot: unchanged pages only refresh freshness; changed ones keep their text for extraction. */
async function recordSnapshot(source: GrantSource, backend: string, now: Date, page: { text: string; links: string[]; status: number | null; bytes: number }): Promise<CheckResult> {
  const hash = contentHash(page.text);
  const changed = hash !== source.lastContentHash;
  const checkId = randomUUID();
  await db.insert(grantSourceChecksTable).values({
    id: checkId,
    sourceId: source.id,
    checkedAt: now,
    backend,
    outcome: changed ? "changed" : "unchanged",
    httpStatus: page.status,
    contentHash: hash,
    bytes: page.bytes,
    pageText: changed ? page.text : null,
    pageLinks: changed ? page.links : null,
  });
  await db
    .update(grantSourcesTable)
    .set({ lastCheckedAt: now, lastSuccessAt: now, lastError: null, lastContentHash: hash, ...(changed ? { lastChangedAt: now } : {}) })
    .where(eq(grantSourcesTable.id, source.id));
  return { sourceId: source.id, checkId, outcome: changed ? "changed" : "unchanged", extract: changed };
}

/** Checks one page source with the configured backend. Never throws for a page problem: it is recorded on the source. */
export async function checkSource(sourceId: string, deps: ServiceDeps = {}): Promise<CheckResult> {
  const [source] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, sourceId)).limit(1);
  if (!source) return { sourceId, checkId: null, outcome: "skipped", error: "The source no longer exists." };
  if (!isPageSource(source)) return { sourceId, checkId: null, outcome: "skipped", error: "Feeds run in the daily grant sync." };
  if (!mayRun(source)) return { sourceId, checkId: null, outcome: "skipped", error: "The source is not active with checked terms that permit automated reading." };
  const now = deps.now?.() ?? new Date();
  const settings = deps.settings ?? currentSettings();
  const url = source.urls[0];

  if (settings.backend === "changedetection" && settings.changeDetection) {
    const client = new ChangeDetectionClient(settings.changeDetection, deps.changeDetectionFetch);
    try {
      const watchId = await client.upsertWatch(source.watchId, { name: source.name, url, scheduleHours: source.scheduleHours, paused: false });
      if (watchId !== source.watchId) await db.update(grantSourcesTable).set({ watchId, watchSyncedAt: now }).where(eq(grantSourcesTable.id, source.id));
      const state = await client.watchState(watchId);
      if (state.lastError) return recordFailure(source, "changedetection", now, `changedetection.io: ${state.lastError}`);
      if (!state.lastChecked) {
        // Not read yet by changedetection.io: nothing to record, and freshness is unchanged.
        await db.update(grantSourcesTable).set({ lastCheckedAt: now }).where(eq(grantSourcesTable.id, source.id));
        return { sourceId, checkId: null, outcome: "skipped", error: "changedetection.io has not checked this page yet." };
      }
      const snap = await client.latestSnapshot(watchId);
      return recordSnapshot({ ...source, watchId }, "changedetection", state.lastChecked, { text: snap.text.trim(), links: snap.html ? extractLinks(snap.html, url) : [], status: null, bytes: snap.text.length });
    } catch (err) {
      return recordFailure(source, "changedetection", now, (err as Error).message);
    }
  }

  try {
    const res = await (deps.fetchPage ?? builtinFetch)(url, { userAgent: userAgent() });
    if (res.status < 200 || res.status >= 300) return recordFailure(source, "builtin", now, `The page answered HTTP ${res.status}.`, res.status);
    const isHtml = !res.contentType || /html|xml/i.test(res.contentType);
    const text = isHtml ? htmlPageToText(res.body) : res.body.trim();
    if (!text) return recordFailure(source, "builtin", now, "The page has no readable text.", res.status);
    return recordSnapshot(source, "builtin", now, { text, links: isHtml ? extractLinks(res.body, res.url) : [], status: res.status, bytes: Buffer.byteLength(res.body) });
  } catch (err) {
    return recordFailure(source, "builtin", now, (err as Error).message);
  }
}

/**
 * Extracts drafts from a changed check. A draft the queue already holds (same
 * fingerprint) is refreshed only while pending; approved and rejected ones keep
 * the reviewer's decision and are only marked as seen again.
 */
export async function extractFromCheck(checkId: string, deps: ServiceDeps = {}): Promise<{ drafts: number; created: number; demo: boolean; provider: string; unparsable: boolean }> {
  const [check] = await db.select().from(grantSourceChecksTable).where(eq(grantSourceChecksTable.id, checkId)).limit(1);
  if (!check || check.outcome !== "changed" || !check.pageText) return { drafts: 0, created: 0, demo: false, provider: "none", unparsable: false };
  const [source] = await db.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, check.sourceId)).limit(1);
  if (!source) return { drafts: 0, created: 0, demo: false, provider: "none", unparsable: false };
  const page: PageSnapshot = { url: source.urls[0], text: check.pageText, links: check.pageLinks ?? [], checkedAt: check.checkedAt };
  const jurisdiction = source.jurisdictionKind === "state" ? `state of ${source.jurisdictionCode}` : source.jurisdictionKind;
  const outcome = await extractCandidates(page, { name: source.name, jurisdiction }, deps.generate ?? defaultGenerate);
  let created = 0;
  for (const d of outcome.drafts) if (await storeDraft(source.id, check.id, d, outcome.provider)) created++;
  await db.update(grantSourceChecksTable).set({ drafts: outcome.drafts.length, ...(outcome.unparsable ? { error: "The AI answer was not JSON; no drafts were made." } : {}) }).where(eq(grantSourceChecksTable.id, check.id));
  return { drafts: outcome.drafts.length, created, demo: outcome.demo, provider: outcome.provider, unparsable: outcome.unparsable };
}

async function storeDraft(sourceId: string, checkId: string, d: CandidateDraft, provider: string): Promise<boolean> {
  const fields = {
    title: d.title, funder: d.funder, deadline: d.deadline, rollingDeadline: d.rollingDeadline, opportunityStatus: d.opportunityStatus,
    amountMin: d.amountMin, amountMax: d.amountMax, eligibilitySummary: d.eligibilitySummary, applicantKinds: d.applicantKinds,
    officialUrl: d.officialUrl, sourceUrl: d.sourceUrl, checkedAt: d.checkedAt, evidence: d.evidence, notes: d.notes, demo: d.demo, provider,
  };
  const [existing] = await db.select({ id: grantSourceDraftsTable.id, status: grantSourceDraftsTable.status }).from(grantSourceDraftsTable)
    .where(and(eq(grantSourceDraftsTable.sourceId, sourceId), eq(grantSourceDraftsTable.fingerprint, d.fingerprint))).limit(1);
  if (existing) {
    await db.update(grantSourceDraftsTable).set(existing.status === "pending" ? { ...fields, checkId, lastSeenAt: d.checkedAt } : { lastSeenAt: d.checkedAt }).where(eq(grantSourceDraftsTable.id, existing.id));
    return false;
  }
  await db.insert(grantSourceDraftsTable).values({ id: randomUUID(), sourceId, checkId, fingerprint: d.fingerprint, status: "pending", ...fields, lastSeenAt: d.checkedAt });
  return true;
}

/** Active page sources whose schedule has come round, for the hourly job. */
export async function dueSources(now: Date = new Date()): Promise<GrantSource[]> {
  const rows = await db.select().from(grantSourcesTable).where(and(eq(grantSourcesTable.status, "active"), inArray(grantSourcesTable.connectorType, ["portal_page", "watched_page"]))).orderBy(asc(grantSourcesTable.lastCheckedAt));
  return rows.filter((s) => mayRun(s) && isDue(s, now));
}

/**
 * Records a feed connector's run on its registry row, so feeds show freshness
 * too. Only that: the connectors, their schedule and their env switches
 * (GRANTS_SYNC_DISABLED, GRANTS_CA_DISABLED) are unchanged by the registry.
 */
export async function recordFeedRun(connector: string, result: { status: "succeeded" | "failed"; error?: string }, at: Date = new Date()): Promise<void> {
  const ok = result.status === "succeeded";
  await db
    .update(grantSourcesTable)
    .set({ lastCheckedAt: at, ...(ok ? { lastSuccessAt: at, lastError: null } : { lastError: (result.error ?? "The sync failed.").slice(0, 500) }) })
    .where(and(eq(grantSourcesTable.connectorType, "feed"), eq(grantSourcesTable.connector, connector)));
}

/**
 * The feed connectors, of those named, whose registry row may run now (active,
 * terms checked and permitting automated reading). The state feeds use this;
 * a feed with no row does not run.
 */
export async function runnableFeedConnectors(connectors: string[]): Promise<Set<string>> {
  if (connectors.length === 0) return new Set();
  const rows = await db.select().from(grantSourcesTable).where(and(eq(grantSourcesTable.connectorType, "feed"), inArray(grantSourcesTable.connector, connectors)));
  return new Set(rows.filter(mayRun).map((r) => r.connector!).filter(Boolean));
}

export function sourceView(s: GrantSource, now: Date = new Date()) {
  return {
    id: s.id, key: s.key, name: s.name, jurisdictionKind: s.jurisdictionKind, jurisdictionCode: s.jurisdictionCode, connectorType: s.connectorType, connector: s.connector,
    urls: s.urls, scheduleHours: s.scheduleHours, owner: s.owner, status: s.status, termsNote: s.termsNote, termsChecked: s.termsChecked,
    termsPermitAutomation: s.termsPermitAutomation, termsCheckedAt: s.termsCheckedAt, termsCheckedBy: s.termsCheckedBy, staleAfterDays: s.staleAfterDays,
    watchId: s.watchId, lastCheckedAt: s.lastCheckedAt, lastSuccessAt: s.lastSuccessAt, lastChangedAt: s.lastChangedAt, lastError: s.lastError,
    updatedBy: s.updatedBy, updatedAt: s.updatedAt, running: mayRun(s), freshness: freshness(s, now),
  };
}

export function draftView(d: GrantSourceDraft, source?: Pick<GrantSource, "key" | "name" | "jurisdictionKind" | "jurisdictionCode">) {
  return {
    id: d.id, sourceId: d.sourceId, sourceName: source?.name ?? null, status: d.status, title: d.title, funder: d.funder, deadline: d.deadline,
    rollingDeadline: d.rollingDeadline, opportunityStatus: d.opportunityStatus, amountMin: d.amountMin, amountMax: d.amountMax,
    eligibilitySummary: d.eligibilitySummary, applicantKinds: d.applicantKinds, officialUrl: d.officialUrl, sourceUrl: d.sourceUrl, checkedAt: d.checkedAt,
    evidence: d.evidence, notes: d.notes, demo: d.demo, provider: d.provider, opportunityId: d.opportunityId, reviewedBy: d.reviewedBy, reviewedAt: d.reviewedAt,
    reviewNote: d.reviewNote, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt,
    gate: source ? approvalCheck(d, source) : null,
  };
}

export type ApproveResult = { ok: true; opportunityId: string; publishable: boolean } | { ok: false; status: number; error: string; problems?: string[] };

/**
 * Approves a pending draft into an opportunity. The opportunity is stored with
 * the publication gate's result, so it reaches applicants only when the gate
 * passes, and the gate is checked again here before anything is written.
 */
export async function approveDraft(draftId: string, reviewer: string, note: string | null, now: Date = new Date()): Promise<ApproveResult> {
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(grantSourceDraftsTable).where(eq(grantSourceDraftsTable.id, draftId)).for("update").limit(1);
    if (!draft) return { ok: false, status: 404, error: "Draft not found" };
    if (draft.status !== "pending") return { ok: false, status: 409, error: `This draft was already ${draft.status}.` };
    const [source] = await tx.select().from(grantSourcesTable).where(eq(grantSourcesTable.id, draft.sourceId)).limit(1);
    if (!source) return { ok: false, status: 404, error: "Source not found" };
    const check = approvalCheck(draft, source, now);
    if (!check.ok) return { ok: false, status: 409, error: "This draft cannot be approved yet.", problems: check.problems };
    const record = opportunityFromDraft(draft, source);
    const values = { ...record, publishable: check.gate.publishable, gateMissing: check.gate.missing };
    const [existing] = await tx.select({ id: grantOpportunitiesTable.id }).from(grantOpportunitiesTable).where(and(eq(grantOpportunitiesTable.source, record.source), eq(grantOpportunitiesTable.sourceRef, record.sourceRef))).limit(1);
    const opportunityId = existing?.id ?? randomUUID();
    if (existing) await tx.update(grantOpportunitiesTable).set(values).where(eq(grantOpportunitiesTable.id, existing.id));
    else await tx.insert(grantOpportunitiesTable).values({ id: opportunityId, ...values });
    await tx.update(grantSourceDraftsTable).set({ status: "approved", opportunityId, reviewedBy: reviewer, reviewedAt: now, reviewNote: note }).where(eq(grantSourceDraftsTable.id, draft.id));
    return { ok: true, opportunityId, publishable: check.gate.publishable };
  });
}

export async function rejectDraft(draftId: string, reviewer: string, note: string | null, now: Date = new Date()): Promise<{ ok: boolean; status: number; error?: string }> {
  const [draft] = await db.select().from(grantSourceDraftsTable).where(eq(grantSourceDraftsTable.id, draftId)).limit(1);
  if (!draft) return { ok: false, status: 404, error: "Draft not found" };
  if (draft.status !== "pending") return { ok: false, status: 409, error: `This draft was already ${draft.status}.` };
  await db.update(grantSourceDraftsTable).set({ status: "rejected", reviewedBy: reviewer, reviewedAt: now, reviewNote: note }).where(eq(grantSourceDraftsTable.id, draftId));
  return { ok: true, status: 200 };
}

export async function recentChecks(sourceId: string, limit = 20) {
  const rows = await db.select().from(grantSourceChecksTable).where(eq(grantSourceChecksTable.sourceId, sourceId)).orderBy(desc(grantSourceChecksTable.checkedAt)).limit(limit);
  return rows.map(({ pageText, pageLinks, ...r }) => ({ ...r, pageChars: pageText?.length ?? null, links: pageLinks?.length ?? null }));
}
