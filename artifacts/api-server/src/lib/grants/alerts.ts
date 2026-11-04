import { db, grantApplicantsTable, grantApplicationsTable, grantOpportunitiesTable, grantReadinessItemsTable, type GrantApplicant, type GrantOpportunity } from "@workspace/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { dueReminder } from "./calendar";
import { emitEvent } from "../webhooks/events";
import { isApplicantType } from "./eligibility";
import { daysUntil } from "./gate";
import { hasTopics, isNewFor, scoreMatches, summarizeAlerts, type AlertSummary } from "./matchSet";

export { BROAD_TOPIC_SHARE, CLOSING_SOON_DAYS, broadTopics, hasTopics, isNewFor, matchInput, newSince, scoreMatches, summarizeAlerts, type AlertSummary, type ScoredMatch } from "./matchSet";

/**
 * Match alerts: which eligible opportunities are new to an organization and
 * which close soon. "New" means first stored after the organization's last
 * "mark as seen" (or after the organization was added), so a new
 * organization starts at zero instead of with every open opportunity flagged.
 * After each sync, each organization with new on-topic matches gets one
 * `grant.new_matches` webhook event, which owners can route to email, Slack
 * or a CRM through the existing automation webhooks.
 */

const ALERT_TOP = 5;

async function loadPublishable(): Promise<GrantOpportunity[]> {
  return db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.publishable, true));
}

/**
 * Alert summaries are cached in process (the deployment is a single
 * instance). An entry is reused only while nothing it depends on has changed:
 * the organization (profile or "mark as seen"), its readiness items, the
 * opportunity store (any row change or a change in the publishable count) and
 * today's date (closing-soon counts and the gate move daily). Without the
 * cache, each Grant Studio page load rescored every organization against every
 * opportunity: about 2.5 s for 20 organizations on 4 November.
 */
const SUMMARY_CACHE_MAX = 1_000;
const summaryCache = new Map<string, { key: string; summary: AlertSummary }>();
let summaryStats = { hits: 0, misses: 0 };

/** Cache counters, for tests and diagnostics. */
export function alertSummaryStats(): { hits: number; misses: number; size: number } {
  return { ...summaryStats, size: summaryCache.size };
}

export function resetAlertSummaryCache(): void {
  summaryCache.clear();
  summaryStats = { hits: 0, misses: 0 };
}

function stamp(value: Date | string | null | undefined): string {
  return value ? new Date(value).toISOString() : "-";
}

/** The cache key for one organization: everything its summary depends on. */
export function summaryKey(
  applicant: Pick<GrantApplicant, "updatedAt" | "matchesSeenAt">,
  readiness: { updatedAt: Date }[],
  opportunityStamp: string,
  today: string,
): string {
  const readinessStamp = readiness.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), new Date(0));
  return [stamp(applicant.updatedAt), stamp(applicant.matchesSeenAt), readiness.length, stamp(readinessStamp), opportunityStamp, today].join("|");
}

/** Alert summaries for a set of organizations; opportunities are read and scored only for organizations whose entry is stale. */
export async function alertSummaries(applicants: GrantApplicant[], now: Date = new Date()): Promise<Map<string, AlertSummary>> {
  const result = new Map<string, AlertSummary>();
  const valid = applicants.filter((a) => isApplicantType(a.applicantType));
  if (valid.length === 0) return result;
  const [[store], items] = await Promise.all([
    db
      .select({ changed: sql<string | null>`max(${grantOpportunitiesTable.updatedAt})`, publishable: sql<number>`count(*) filter (where ${grantOpportunitiesTable.publishable})` })
      .from(grantOpportunitiesTable),
    db.select().from(grantReadinessItemsTable).where(inArray(grantReadinessItemsTable.applicantId, valid.map((a) => a.id))),
  ]);
  const opportunityStamp = `${stamp(store?.changed)}#${Number(store?.publishable ?? 0)}`;
  const today = now.toISOString().slice(0, 10);
  const stale: { applicant: GrantApplicant; key: string }[] = [];
  for (const applicant of valid) {
    const key = summaryKey(applicant, items.filter((i) => i.applicantId === applicant.id), opportunityStamp, today);
    const cached = summaryCache.get(applicant.id);
    if (cached && cached.key === key) {
      summaryStats.hits++;
      result.set(applicant.id, cached.summary);
    } else {
      stale.push({ applicant, key });
    }
  }
  if (stale.length > 0) {
    const opps = await loadPublishable();
    for (const { applicant, key } of stale) {
      summaryStats.misses++;
      const { scored } = scoreMatches(applicant, opps, items.filter((i) => i.applicantId === applicant.id), now);
      const summary = summarizeAlerts(applicant, scored);
      summaryCache.delete(applicant.id);
      summaryCache.set(applicant.id, { key, summary });
      result.set(applicant.id, summary);
    }
    // Oldest entries go first once the cache is full.
    while (summaryCache.size > SUMMARY_CACHE_MAX) summaryCache.delete(summaryCache.keys().next().value!);
  }
  return result;
}

export interface AlertRunResult {
  applicants: number;
  events: number;
}

/**
 * Emits one `grant.new_matches` event per organization that has on-topic (or,
 * without topics, eligible) matches first stored since its last alert. The
 * payload carries public opportunity facts and Grant Studio paths only.
 */
export async function emitMatchAlerts(now: Date = new Date()): Promise<AlertRunResult> {
  const applicants = (await db.select().from(grantApplicantsTable)).filter((a) => isApplicantType(a.applicantType));
  if (applicants.length === 0) return { applicants: 0, events: 0 };
  const [opps, items, applications] = await Promise.all([
    loadPublishable(),
    db.select().from(grantReadinessItemsTable).where(inArray(grantReadinessItemsTable.applicantId, applicants.map((a) => a.id))),
    db.select({ applicantId: grantApplicationsTable.applicantId, opportunityId: grantApplicationsTable.opportunityId }).from(grantApplicationsTable),
  ]);
  let events = 0;
  for (const applicant of applicants) {
    const since = applicant.alertedAt ?? applicant.createdAt;
    const started = new Set(applications.filter((a) => a.applicantId === applicant.id).map((a) => a.opportunityId));
    const { scored } = scoreMatches(applicant, opps, items.filter((i) => i.applicantId === applicant.id), now);
    const pool = hasTopics(applicant) ? scored.filter((s) => s.match.relevant) : scored;
    const fresh = pool.filter((s) => isNewFor(s.opp, since) && !started.has(s.opp.id));
    if (fresh.length > 0) {
      await emitEvent({
        type: "grant.new_matches",
        userId: applicant.userId,
        data: {
          applicantId: applicant.id,
          applicantName: applicant.name,
          count: fresh.length,
          matchesPath: `/grant-studio/organizations/${applicant.id}`,
          top: fresh.slice(0, ALERT_TOP).map(({ opp, match }) => ({
            opportunityId: opp.id,
            title: opp.title,
            agency: opp.agency,
            number: opp.number,
            closeDate: opp.closeDate,
            daysLeft: daysUntil(opp.closeDate, now),
            score: match.score,
            officialUrl: opp.officialUrl,
            studioPath: `/grant-studio/opportunities/${opp.id}?org=${applicant.id}`,
          })),
        },
      });
      events++;
    }
    await db.update(grantApplicantsTable).set({ alertedAt: now }).where(eq(grantApplicantsTable.id, applicant.id));
  }
  return { applicants: applicants.length, events };
}

/**
 * Emits `grant.deadline_approaching` once per application as its closing date
 * crosses each reminder threshold (14, 7 and 2 days). Exported applications
 * are left alone: the package has gone to the authorized representative.
 */
export async function emitDeadlineReminders(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({ app: grantApplicationsTable, applicant: grantApplicantsTable, opp: grantOpportunitiesTable })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .innerJoin(grantOpportunitiesTable, eq(grantApplicationsTable.opportunityId, grantOpportunitiesTable.id))
    .where(and(ne(grantApplicationsTable.status, "exported"), isNull(grantApplicationsTable.outcome)));
  let events = 0;
  for (const { app, applicant, opp } of rows) {
    const daysLeft = daysUntil(opp.closeDate, now);
    const threshold = dueReminder(daysLeft, app.deadlineAlertDays);
    if (threshold === null) continue;
    await emitEvent({
      type: "grant.deadline_approaching",
      userId: applicant.userId,
      data: {
        applicationId: app.id,
        applicationTitle: app.title,
        applicantId: applicant.id,
        applicantName: applicant.name,
        status: app.status,
        closeDate: opp.closeDate,
        daysLeft,
        reminderDays: threshold,
        officialUrl: opp.officialUrl,
        applicationPath: `/grant-studio/applications/${app.id}`,
      },
    });
    await db.update(grantApplicationsTable).set({ deadlineAlertDays: threshold }).where(eq(grantApplicationsTable.id, app.id));
    events++;
  }
  return events;
}
