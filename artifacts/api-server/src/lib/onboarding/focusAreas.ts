/**
 * Focus areas the setup wizard offers (docs/SELF_SIGNUP.md §4).
 *
 * Grant Studio matches an opportunity to a focus area when every word of the
 * area appears in the opportunity's text (lib/grants/matching.ts), so these are
 * short, plain phrases that federal and state notices use. They are only
 * suggestions: the person picks any, adds their own, or none.
 *
 * Keyed by NTEE major group letter, so an organization found by EIN sees the
 * areas for its classification first. Pure module.
 */
import { NTEE_GROUPS } from "../foundations/aggregate";

export const FOCUS_AREAS_BY_NTEE: Record<string, string[]> = {
  A: ["arts", "humanities", "museums", "cultural heritage"],
  B: ["education", "literacy", "STEM education", "after-school"],
  C: ["environment", "conservation", "climate", "clean water"],
  D: ["animal welfare", "wildlife"],
  E: ["health", "rural health", "health equity", "maternal health"],
  F: ["mental health", "substance use", "suicide prevention", "crisis services"],
  G: ["chronic disease", "cancer", "HIV"],
  H: ["medical research", "biomedical research"],
  I: ["legal aid", "reentry", "victim services", "crime prevention"],
  J: ["workforce development", "job training", "apprenticeship"],
  K: ["food security", "nutrition", "agriculture", "local food"],
  L: ["housing", "homelessness", "affordable housing"],
  M: ["disaster relief", "emergency preparedness", "public safety"],
  N: ["recreation", "youth sports"],
  O: ["youth development", "mentoring", "after-school"],
  P: ["human services", "families", "seniors", "child care"],
  Q: ["international development", "refugees"],
  R: ["civil rights", "equity", "voting"],
  S: ["community development", "economic development", "small business"],
  T: ["philanthropy", "capacity building"],
  U: ["science", "technology", "research"],
  V: ["social science research", "evaluation"],
  W: ["public policy", "civic engagement", "broadband"],
  X: ["faith-based services", "community services"],
  Y: ["membership services"],
};

/** Offered to everyone, and to organizations without an EIN (businesses, new nonprofits). */
export const GENERAL_FOCUS_AREAS = [
  "education",
  "health",
  "workforce development",
  "housing",
  "food security",
  "environment",
  "arts",
  "youth development",
  "small business",
  "research",
  "technology",
  "rural",
];

/** Suggested areas for an NTEE group first, then the general list, without repeats. */
export function suggestedFocusAreas(nteeGroup: string | null | undefined, limit = 12): string[] {
  const first = (nteeGroup && FOCUS_AREAS_BY_NTEE[nteeGroup]) || [];
  const out: string[] = [];
  for (const area of [...first, ...GENERAL_FOCUS_AREAS]) if (!out.includes(area)) out.push(area);
  return out.slice(0, limit);
}

export function focusCatalog() {
  return {
    general: GENERAL_FOCUS_AREAS,
    byCause: Object.entries(FOCUS_AREAS_BY_NTEE).map(([key, areas]) => ({ key, label: NTEE_GROUPS[key] ?? key, areas })),
  };
}
