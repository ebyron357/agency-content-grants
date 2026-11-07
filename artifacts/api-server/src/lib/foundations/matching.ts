import { filingLinks } from "./profile";
import { POLICY_LABELS, type ApplicationPolicy } from "./applicationPolicy";

/**
 * Ranks foundations for one Grant Studio organization (docs/GRANT_STUDIO.md,
 * Foundations: "Suggestions").
 *
 * Pure module: no database import. Every point comes from the funder's stored
 * giving history and is explained in a sentence a person can check against
 * the profile and the filing. A suggestion is funding history and guidance for
 * research: never an open call and never an eligibility decision. The
 * "accepts applications" flag is shown with each suggestion but does not
 * change its score, so an unknown flag is never treated as yes or no.
 */

export const WEIGHTS = { state: 30, cause: 30, size: 20, recency: 10, consistency: 10 } as const;
export type Component = keyof typeof WEIGHTS;

export interface MatchFunder {
  ein: string;
  name: string;
  state: string | null;
  formType: string;
  totalPaidUsd: number;
  grantCount: number;
  firstTaxYear: number | null;
  lastTaxYear: number | null;
  givingByYear: Record<string, number>;
  givingByState: Record<string, number>;
  givingByCategory: Record<string, number>;
  categorySources: Record<string, number>;
  sizeStats: Record<string, number>;
  latestObjectId: string | null;
  latestTaxPeriodEnd: string | null;
  filings: Record<string, string>;
  applicationPolicy: string | null;
  applicationPolicyTaxYear: number | null;
  applicationPolicyObjectId: string | null;
}

export interface MatchOrganization {
  state: string;
  causes: { key: string; label: string; from: string }[];
  annualBudget: number | null;
  /** The amount the organization means to ask for, when known. */
  requestUsd: number | null;
}

export interface ScoredComponent {
  key: Component;
  label: string;
  points: number;
  max: number;
  reason: string;
}

export interface FunderMatch {
  ein: string;
  score: number;
  components: ScoredComponent[];
  reasons: string[];
  cautions: string[];
  inStateUsd: number;
  causeUsd: number;
  applicationPolicy: PolicyView;
  filings: { taxPeriodEnd: string; objectId: string }[];
  filing: ReturnType<typeof filingLinks>;
}

export interface PolicyView {
  status: ApplicationPolicy;
  label: string;
  taxYear: number | null;
  objectId: string | null;
  detail: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The "accepts applications" flag as shown, with the tax year it came from. Never inferred. */
export function policyView(f: Pick<MatchFunder, "formType" | "applicationPolicy" | "applicationPolicyTaxYear" | "applicationPolicyObjectId">): PolicyView {
  const status: ApplicationPolicy = f.applicationPolicy === "invitation_only" || f.applicationPolicy === "accepts_applications" ? f.applicationPolicy : "unknown";
  const year = f.applicationPolicyTaxYear ? `tax year ${f.applicationPolicyTaxYear}` : "its";
  const detail =
    status === "invitation_only"
      ? `Its ${year} Form 990-PF says it only contributes to preselected organizations and does not accept unsolicited requests (Part XIV line 2).`
      : status === "accepts_applications"
        ? `Its ${year} Form 990-PF does not check Part XIV line 2 (contributions only to preselected organizations). Confirm how to apply on the funder's own site or filing.`
        : f.formType !== "990PF"
          ? "Not reported: this funder files Form 990, which has no such question."
          : "Not known: the filing that says whether it accepts unsolicited requests has not been read.";
  return { status, label: POLICY_LABELS[status], taxYear: status === "unknown" ? null : f.applicationPolicyTaxYear, objectId: status === "unknown" ? null : f.applicationPolicyObjectId, detail };
}

function stateComponent(f: MatchFunder, state: string): ScoredComponent {
  const inState = f.givingByState[state] ?? 0;
  const share = f.totalPaidUsd > 0 ? inState / f.totalPaidUsd : 0;
  // Full points at half of its giving in the state; a national funder with a small in-state share still earns some.
  const points = round1(WEIGHTS.state * clamp(Math.sqrt(share / 0.5), 0, 1));
  return { key: "state", label: "Gives in your state", points, max: WEIGHTS.state, reason: `Paid ${usd(inState)} to recipients in ${state}, ${pct(share)} of its giving.` };
}

function causeComponent(f: MatchFunder, causes: MatchOrganization["causes"]): { component: ScoredComponent; causeUsd: number } {
  const parts = causes.map((c) => ({ ...c, usd: f.givingByCategory[c.key] ?? 0 })).filter((c) => c.usd > 0);
  const causeUsd = parts.reduce((s, c) => s + c.usd, 0);
  const share = f.totalPaidUsd > 0 ? Math.min(1, causeUsd / f.totalPaidUsd) : 0;
  const points = round1(WEIGHTS.cause * clamp(Math.sqrt(share / 0.5), 0, 1));
  const named = parts.map((c) => `${usd(c.usd)} to ${c.label.toLowerCase()} recipients`).join(", ");
  return { component: { key: "cause", label: "Funds your cause", points, max: WEIGHTS.cause, reason: `Paid ${named || "nothing to your causes"} (NTEE major groups, all states), ${pct(share)} of its giving.` }, causeUsd };
}

/**
 * How its usual grant compares with what the organization needs. With a
 * request amount: inside the funder's middle half of grant sizes is a full
 * fit, inside its smallest-to-largest range a partial one. With only an
 * annual budget: a median grant of 2–25% of the budget fits, up to 50% is a
 * stretch, and more (or under 0.5%) fits poorly.
 */
function sizeComponent(f: MatchFunder, org: MatchOrganization): ScoredComponent {
  const s = f.sizeStats;
  const median = s.median ?? 0;
  const base = { key: "size" as const, label: "Grant size fits", max: WEIGHTS.size };
  if (!median) return { ...base, points: 0, reason: "No grant sizes are recorded for this funder." };
  if (org.requestUsd && org.requestUsd > 0) {
    const r = org.requestUsd;
    const lo = s.p25 ?? median, hi = s.p75 ?? median, min = s.min ?? lo, max = s.max ?? hi;
    if (r >= lo && r <= hi) return { ...base, points: WEIGHTS.size, reason: `Your request of ${usd(r)} is within its usual grant range (middle half ${usd(lo)} to ${usd(hi)}).` };
    if (r >= min && r <= max) return { ...base, points: round1(WEIGHTS.size * 0.5), reason: `Your request of ${usd(r)} is within its range of ${usd(min)} to ${usd(max)}, but outside its usual ${usd(lo)} to ${usd(hi)}.` };
    return { ...base, points: 0, reason: `Your request of ${usd(r)} is ${r > max ? "above its largest" : "below its smallest"} grant on record (${usd(r > max ? max : min)}).` };
  }
  if (org.annualBudget && org.annualBudget > 0) {
    const ratio = median / org.annualBudget;
    const text = `Its median grant of ${usd(median)} is ${ratio < 0.01 ? "under 1" : Math.round(ratio * 100)}% of your annual budget of ${usd(org.annualBudget)}`;
    if (ratio >= 0.02 && ratio <= 0.25) return { ...base, points: WEIGHTS.size, reason: `${text}: a typical size for one grant.` };
    if (ratio > 0.25 && ratio <= 0.5) return { ...base, points: round1(WEIGHTS.size * 0.5), reason: `${text}: large for an organization your size.` };
    if (ratio >= 0.005 && ratio < 0.02) return { ...base, points: round1(WEIGHTS.size * 0.5), reason: `${text}: small for an organization your size.` };
    return { ...base, points: round1(WEIGHTS.size * 0.2), reason: `${text}: ${ratio > 0.5 ? "far larger than" : "far smaller than"} a typical grant for an organization your size.` };
  }
  return { ...base, points: round1(WEIGHTS.size * 0.5), reason: `Its median grant is ${usd(median)}. Add your annual budget or a request amount to compare.` };
}

function recencyComponent(f: MatchFunder, latestDataYear: number): ScoredComponent {
  const base = { key: "recency" as const, label: "Gave recently", max: WEIGHTS.recency };
  if (!f.lastTaxYear) return { ...base, points: 0, reason: "No tax year is recorded for its giving." };
  const gap = Math.max(0, latestDataYear - f.lastTaxYear);
  const points = gap === 0 ? 10 : gap === 1 ? 7 : gap === 2 ? 4 : 0;
  const tail = gap === 0 ? "the latest year in the imported filings" : `${gap} year${gap === 1 ? "" : "s"} before the latest year in the imported filings (${latestDataYear})`;
  return { ...base, points, reason: `Its latest grants counted are from tax year ${f.lastTaxYear}, ${tail}.` };
}

function consistencyComponent(f: MatchFunder): ScoredComponent {
  const base = { key: "consistency" as const, label: "Gives year after year", max: WEIGHTS.consistency };
  if (!f.lastTaxYear) return { ...base, points: 0, reason: "No giving by year is recorded." };
  const first = Math.max(f.firstTaxYear ?? f.lastTaxYear, f.lastTaxYear - 4);
  const span = f.lastTaxYear - first + 1;
  let given = 0;
  for (let y = first; y <= f.lastTaxYear; y++) if ((f.givingByYear[String(y)] ?? 0) > 0) given += 1;
  // Five years of giving earns full points; fewer imported years earn fewer.
  const points = round1(WEIGHTS.consistency * (given / 5));
  const range = span === 1 ? `tax year ${first}` : `tax years ${first}–${f.lastTaxYear}`;
  return { ...base, points, reason: `Paid grants in ${given} of ${span} ${range}${span < 5 ? "; fewer than five years of its giving are imported" : ""}.` };
}

/** Scores one funder for one organization. */
export function scoreFunder(f: MatchFunder, org: MatchOrganization, latestDataYear: number): FunderMatch {
  const state = stateComponent(f, org.state);
  const { component: cause, causeUsd } = causeComponent(f, org.causes);
  const components = [state, cause, sizeComponent(f, org), recencyComponent(f, latestDataYear), consistencyComponent(f)];
  const score = Math.round(components.reduce((s, c) => s + c.points, 0));
  const cautions: string[] = [];
  const total = Object.values(f.categorySources).reduce((s, n) => s + n, 0);
  if (total > 0 && (f.categorySources.purpose ?? 0) / total > 0.5) cautions.push("Most of its causes come from the grant purpose text, not the recipient's NTEE code, so treat them as approximate.");
  cautions.push("State and cause are counted separately: this does not show that its in-state grants were for your cause.");
  const policy = policyView(f);
  if (policy.status === "invitation_only") cautions.push(policy.detail);
  const filings = Object.entries(f.filings).map(([taxPeriodEnd, objectId]) => ({ taxPeriodEnd, objectId })).sort((a, b) => b.taxPeriodEnd.localeCompare(a.taxPeriodEnd)).slice(0, 5);
  return {
    ein: f.ein,
    score,
    components,
    reasons: components.map((c) => c.reason),
    cautions,
    inStateUsd: f.givingByState[org.state] ?? 0,
    causeUsd,
    applicationPolicy: policy,
    filings,
    filing: filingLinks(f.ein, f.latestObjectId),
  };
}

/** Ranks candidates, best first; ties go to more in-state giving, then the EIN. */
export function rankFunders(candidates: MatchFunder[], org: MatchOrganization, latestDataYear: number, opts: { limit?: number; hideInvitationOnly?: boolean } = {}): FunderMatch[] {
  return candidates
    .map((f) => scoreFunder(f, org, latestDataYear))
    .filter((m) => !(opts.hideInvitationOnly && m.applicationPolicy.status === "invitation_only"))
    .sort((a, b) => b.score - a.score || b.inStateUsd - a.inStateUsd || a.ein.localeCompare(b.ein))
    .slice(0, opts.limit ?? 10);
}

