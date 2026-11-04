import type { GrantApplicant, GrantOpportunity } from "@workspace/db";
import type { ApplicantType } from "./eligibility";
import type { PlaceDesignations } from "./places";
import { matchOpportunity, type MatchReadiness, type MatchResult } from "./matching";

/**
 * Pure rules for a set of matches: ordering, what counts as new, and the alert
 * summary. No database access, so they are unit tested directly.
 */

export const CLOSING_SOON_DAYS = 14;
export interface ScoredMatch {
  opp: GrantOpportunity;
  match: MatchResult;
}

export function matchInput(applicant: GrantApplicant) {
  return {
    applicantType: applicant.applicantType as ApplicantType,
    mission: applicant.mission,
    focusAreas: applicant.focusAreas,
    state: applicant.state,
    annualBudget: applicant.annualBudget,
    maxCostSharePercent: applicant.maxCostSharePercent,
    placeDesignations: applicant.placeDesignations as PlaceDesignations | null,
  };
}

/** Eligible matches, on-topic first, then by score, topic count and nearest deadline. */
export function scoreMatches(applicant: GrantApplicant, opps: GrantOpportunity[], readiness: MatchReadiness[], now: Date = new Date()): { scored: ScoredMatch[]; excluded: number } {
  const scored: ScoredMatch[] = [];
  let excluded = 0;
  for (const opp of opps) {
    const match = matchOpportunity(matchInput(applicant), opp, readiness, now);
    if (match.eligible) scored.push({ opp, match });
    else excluded++;
  }
  scored.sort(
    (a, b) =>
      Number(b.match.relevant) - Number(a.match.relevant) ||
      b.match.score - a.match.score ||
      b.match.matchedTopics.length - a.match.matchedTopics.length ||
      (a.match.daysLeft ?? 9999) - (b.match.daysLeft ?? 9999),
  );
  return { scored, excluded };
}

/** The time after which an opportunity counts as new for this organization. */
export function newSince(applicant: Pick<GrantApplicant, "matchesSeenAt" | "createdAt">): Date {
  return applicant.matchesSeenAt ?? applicant.createdAt;
}

export function isNewFor(opp: Pick<GrantOpportunity, "createdAt">, since: Date): boolean {
  return opp.createdAt.getTime() > since.getTime();
}

/** Whether the organization has topics to judge relevance by. */
export function hasTopics(applicant: Pick<GrantApplicant, "focusAreas" | "mission">): boolean {
  return applicant.focusAreas.length > 0 || Boolean(applicant.mission && applicant.mission.trim());
}

export interface AlertSummary {
  /** New eligible matches (on-topic only when the organization has topics). */
  newMatches: number;
  /** Eligible matches (on-topic only when the organization has topics) closing within CLOSING_SOON_DAYS. */
  closingSoon: number;
}

export function summarizeAlerts(applicant: Pick<GrantApplicant, "focusAreas" | "mission" | "matchesSeenAt" | "createdAt">, scored: ScoredMatch[]): AlertSummary {
  const since = newSince(applicant);
  const pool = hasTopics(applicant) ? scored.filter((s) => s.match.relevant) : scored;
  return {
    newMatches: pool.filter((s) => isNewFor(s.opp, since)).length,
    closingSoon: pool.filter((s) => s.match.daysLeft !== null && s.match.daysLeft >= 0 && s.match.daysLeft <= CLOSING_SOON_DAYS).length,
  };
}

/** Share of eligible matches above which a focus area counts as too broad to narrow anything. */
export const BROAD_TOPIC_SHARE = 0.4;
const BROAD_TOPIC_MIN_ELIGIBLE = 50;

/**
 * Focus areas that appear in most eligible opportunities ("health",
 * "research"): they make nearly everything on-topic, so the profile should
 * name something more specific. Judged only once there are enough matches.
 */
export function broadTopics(focusAreas: string[], scored: ScoredMatch[]): string[] {
  if (scored.length < BROAD_TOPIC_MIN_ELIGIBLE) return [];
  return focusAreas.filter((topic) => scored.filter((s) => s.match.matchedTopics.includes(topic)).length / scored.length > BROAD_TOPIC_SHARE);
}
