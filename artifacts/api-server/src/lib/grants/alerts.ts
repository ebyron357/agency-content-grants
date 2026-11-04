import { db, grantApplicantsTable, grantApplicationsTable, grantOpportunitiesTable, grantReadinessItemsTable, type GrantApplicant, type GrantOpportunity } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
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

/** Alert summaries for a set of organizations, computed against one read of the opportunity store. */
export async function alertSummaries(applicants: GrantApplicant[]): Promise<Map<string, AlertSummary>> {
  const result = new Map<string, AlertSummary>();
  const valid = applicants.filter((a) => isApplicantType(a.applicantType));
  if (valid.length === 0) return result;
  const [opps, items] = await Promise.all([
    loadPublishable(),
    db.select().from(grantReadinessItemsTable).where(inArray(grantReadinessItemsTable.applicantId, valid.map((a) => a.id))),
  ]);
  for (const applicant of valid) {
    const { scored } = scoreMatches(applicant, opps, items.filter((i) => i.applicantId === applicant.id));
    result.set(applicant.id, summarizeAlerts(applicant, scored));
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
