import { APPLICANT_TYPES, GRANTS_GOV_OTHERS_CODE, GRANTS_GOV_UNRESTRICTED_CODE, READINESS_KINDS, type ApplicantType, type ReadinessKind, readinessKindsFor } from "./eligibility";
import { daysUntil } from "./gate";

/**
 * Explained matching: hard filters first (each exclusion says why), then a fit
 * score from 0 to 100 whose every point comes from a stated reason. Nothing
 * here is an eligibility conclusion: the applicant confirms eligibility against
 * the official notice before starting an application (charter, Human approvals).
 */

export interface MatchApplicant {
  applicantType: ApplicantType;
  mission: string | null;
  focusAreas: string[];
  state: string | null;
  annualBudget: number | null;
  maxCostSharePercent: number;
}

export interface MatchReadiness {
  kind: string;
  status: string;
  expiresOn: string | null;
}

export interface MatchOpportunity {
  title: string;
  description: string | null;
  categories: string[];
  eligibilityCodes: string[];
  eligibilityText: string | null;
  status: string;
  closeDate: string | null;
  awardFloor: number | null;
  awardCeiling: number | null;
  costSharing: boolean | null;
}

export interface MatchResult {
  eligible: boolean;
  score: number;
  reasons: string[];
  exclusions: string[];
  gaps: string[];
  matchedTopics: string[];
  /** Distinctive mission words found in the opportunity. */
  missionTerms: string[];
  /** True when a focus area or a mission term matched: the opportunity is on-topic, not only eligible. */
  relevant: boolean;
  daysLeft: number | null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Topics (focus areas) whose words all appear in the opportunity text. */
export function matchTopics(focusAreas: string[], opportunity: Pick<MatchOpportunity, "title" | "description" | "categories">): string[] {
  const haystack = ` ${normalize([opportunity.title, opportunity.description ?? "", ...opportunity.categories].join(" "))} `;
  return focusAreas.filter((topic) => {
    const words = normalize(topic).split(" ").filter((w) => w.length > 2);
    return words.length > 0 && words.every((word) => haystack.includes(` ${word}`));
  });
}

/** Common words that say nothing about a topic. */
const STOPWORDS = new Set([
  "about", "across", "after", "their", "there", "these", "those", "through", "under", "where", "which", "while", "within", "would",
  "other", "people", "provide", "provides", "services", "service", "support", "supports", "program", "programs", "project", "projects",
  "community", "communities", "improve", "improving", "increase", "access", "local", "national", "state", "states", "public",
  "organization", "organizations", "mission", "families", "family", "individuals", "including", "development", "research", "health",
  "education", "help", "helps", "build", "building", "strengthen", "every", "areas", "region", "regions", "rural", "urban",
]);

/** Distinctive words (5+ letters, not generic) from the mission that appear in the opportunity text. */
export function matchMissionTerms(mission: string | null, opportunity: Pick<MatchOpportunity, "title" | "description" | "categories">): string[] {
  if (!mission) return [];
  const haystack = ` ${normalize([opportunity.title, opportunity.description ?? "", ...opportunity.categories].join(" "))} `;
  const words = [...new Set(normalize(mission).split(" ").filter((w) => w.length >= 5 && !STOPWORDS.has(w)))];
  return words.filter((w) => haystack.includes(` ${w}`)).slice(0, 6);
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function matchOpportunity(
  applicant: MatchApplicant,
  opportunity: MatchOpportunity,
  readiness: MatchReadiness[],
  now: Date = new Date(),
): MatchResult {
  const reasons: string[] = [];
  const exclusions: string[] = [];
  const gaps: string[] = [];
  let score = 0;

  // ── Hard filters ────────────────────────────────────────────────────────
  const status = opportunity.status.toLowerCase();
  if (status !== "posted" && status !== "forecasted") exclusions.push(`The opportunity is ${status}, not open or forecast.`);
  const daysLeft = daysUntil(opportunity.closeDate, now);
  if (daysLeft !== null && daysLeft < 0) exclusions.push("The closing date has passed.");

  const applicantCodes: readonly string[] = APPLICANT_TYPES[applicant.applicantType].grantsGovCodes;
  const exact = opportunity.eligibilityCodes.some((code) => applicantCodes.includes(code));
  const unrestricted = opportunity.eligibilityCodes.includes(GRANTS_GOV_UNRESTRICTED_CODE);
  const others = opportunity.eligibilityCodes.includes(GRANTS_GOV_OTHERS_CODE);
  if (exact) {
    score += 30;
    reasons.push(`Eligibility lists ${APPLICANT_TYPES[applicant.applicantType].label.toLowerCase()} applicants.`);
  } else if (unrestricted) {
    score += 22;
    reasons.push("Eligibility is unrestricted, subject to the notice's clarifications.");
  } else if (others) {
    score += 12;
    reasons.push("Eligibility says \"others\": read the notice's eligibility text to confirm.");
  } else {
    exclusions.push(`Eligibility does not list ${APPLICANT_TYPES[applicant.applicantType].label.toLowerCase()} applicants.`);
  }

  if (opportunity.costSharing === true && applicant.maxCostSharePercent <= 0) {
    exclusions.push("The notice requires cost sharing, and this organization recorded that it cannot commit any.");
  } else if (opportunity.costSharing === true) {
    gaps.push(`Cost sharing is required; this organization can commit up to ${applicant.maxCostSharePercent}%. Check the notice's required share.`);
  } else if (opportunity.costSharing === null) {
    gaps.push("The record does not yet say whether cost sharing is required. Check the notice.");
  }

  // ── Fit ────────────────────────────────────────────────────────────────
  const matchedTopics = matchTopics(applicant.focusAreas, opportunity);
  if (applicant.focusAreas.length === 0) {
    gaps.push("Add focus areas to the profile so topics can be matched.");
  } else if (matchedTopics.length > 0) {
    // Tiered: one topic is a lead, several are a strong signal.
    score += Math.min(35, 12 * matchedTopics.length);
    reasons.push(`Matches your focus area${matchedTopics.length > 1 ? "s" : ""}: ${matchedTopics.join(", ")}.`);
  }
  const missionTerms = matchMissionTerms(applicant.mission, opportunity);
  if (missionTerms.length > 0) {
    score += Math.min(10, 4 * missionTerms.length);
    reasons.push(`Uses words from your mission: ${missionTerms.join(", ")}.`);
  }

  const ceiling = opportunity.awardCeiling;
  if (ceiling && applicant.annualBudget && applicant.annualBudget > 0) {
    const ratio = ceiling / applicant.annualBudget;
    if (ratio <= 1.5) {
      score += 15;
      reasons.push(`The award ceiling (${money(ceiling)}) is in proportion to your annual budget.`);
    } else if (ratio <= 4) {
      score += 9;
      reasons.push(`The award ceiling (${money(ceiling)}) is large for your budget; funders look at capacity to manage it.`);
    } else {
      score += 3;
      gaps.push(`The award ceiling (${money(ceiling)}) is more than four times your annual budget.`);
    }
  } else {
    score += 7;
  }

  if (daysLeft === null) {
    score += status === "forecasted" ? 6 : 0;
    if (status === "forecasted") reasons.push("Forecast: time to prepare before it opens.");
  } else if (daysLeft >= 30) {
    score += 10;
    reasons.push(`${daysLeft} days until the closing date.`);
  } else if (daysLeft >= 14) {
    score += 6;
    reasons.push(`${daysLeft} days until the closing date: start soon.`);
  } else if (daysLeft >= 0) {
    score += 2;
    gaps.push(`Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} until the closing date.`);
  }

  // ── Readiness ──────────────────────────────────────────────────────────
  const byKind = new Map(readiness.map((item) => [item.kind, item]));
  let blockingMissing = 0;
  for (const kind of readinessKindsFor(applicant.applicantType)) {
    const spec = READINESS_KINDS[kind as ReadinessKind];
    if (!spec.blocking) continue;
    const item = byKind.get(kind);
    if (!item || item.status !== "ready") {
      blockingMissing++;
      gaps.push(`${spec.label}: not ready.`);
    } else if (item.expiresOn && opportunity.closeDate && item.expiresOn < opportunity.closeDate) {
      blockingMissing++;
      gaps.push(`${spec.label} expires on ${item.expiresOn}, before this closing date. Renew it first.`);
    }
  }
  score += blockingMissing === 0 ? 10 : 0;

  const eligible = exclusions.length === 0;
  return {
    eligible,
    score: eligible ? Math.max(0, Math.min(100, score)) : 0,
    reasons,
    exclusions,
    gaps,
    matchedTopics,
    missionTerms,
    relevant: matchedTopics.length > 0 || missionTerms.length > 0,
    daysLeft,
  };
}
