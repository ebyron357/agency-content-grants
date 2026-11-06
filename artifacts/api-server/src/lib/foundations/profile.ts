import { NTEE_GROUPS, UNCLASSIFIED, categoriesInText } from "./aggregate";

/**
 * How foundation records are shown (docs/GRANT_STUDIO.md, Foundations).
 * Pure module: no database import.
 */

export const HISTORY_LABEL = "Funding history from tax filings, not an open call";
export const SOURCE = {
  name: "funder-graph",
  repo: "https://github.com/egeria-corporation/funder-graph",
  license: "Code Apache-2.0. The hosted dataset's terms have not been reviewed; the pipeline can be run independently.",
  irsDownloads: "https://www.irs.gov/charities-non-profits/form-990-series-downloads",
  derivedFrom: "IRS Form 990-PF Part XV and Form 990 Schedule I e-file XML, and the IRS Exempt Organizations Business Master File",
} as const;

export const CAUSES = Object.entries(NTEE_GROUPS)
  .filter(([k]) => k !== "Z")
  .map(([key, label]) => ({ key, label }));

export function causeLabel(key: string): string {
  return key === UNCLASSIFIED ? "Not classified" : (NTEE_GROUPS[key] ?? key);
}

export function formatEin(ein: string): string {
  return /^\d{9}$/.test(ein) ? `${ein.slice(0, 2)}-${ein.slice(2)}` : ein;
}

/**
 * Where a person can find the filing. funder-graph documents that the IRS
 * publishes no per-filing URL (its docs/research/data-sources.md), so the
 * filing is identified by its IRS object id, with the IRS bulk download page
 * and ProPublica's page of filings for the EIN.
 */
export function filingLinks(ein: string, objectId: string | null) {
  return {
    objectId,
    irsDownloads: SOURCE.irsDownloads,
    propublica: /^\d{9}$/.test(ein) ? `https://projects.propublica.org/nonprofits/organizations/${ein}` : null,
    note: "The IRS publishes no web page per filing. The object id identifies the filing in the IRS e-file bulk downloads.",
  };
}

/** Rows sorted by amount, with share of the total, for display. */
export function breakdown(map: Record<string, number>, total: number, label: (k: string) => string, limit = 12) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, usd]) => ({ key, label: label(key), usd, share: total > 0 ? Math.round((usd / total) * 1000) / 10 : 0 }));
}

export function stateLabel(key: string): string {
  if (key === "foreign") return "Outside the US";
  if (key === "unknown") return "State not filed";
  if (key === "other") return "Other states";
  return key;
}

export interface SuggestionInput {
  state: string | null;
  focusAreas: string[];
  mission: string | null;
}

/** The causes an organization works on, from its focus areas and mission, with the words that put it there. */
export function causesFor(input: SuggestionInput): { key: string; label: string; from: string }[] {
  const out = new Map<string, string>();
  for (const area of input.focusAreas) for (const c of categoriesInText(area)) if (!out.has(c)) out.set(c, `focus area “${area}”`);
  for (const c of categoriesInText(input.mission)) if (!out.has(c)) out.set(c, "mission");
  return [...out.entries()].map(([key, from]) => ({ key, label: causeLabel(key), from }));
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export interface SuggestionRow {
  ein: string;
  name: string;
  state: string | null;
  totalPaidUsd: number;
  firstTaxYear: number | null;
  lastTaxYear: number | null;
  givingByState: Record<string, number>;
  givingByCategory: Record<string, number>;
  categorySources: Record<string, number>;
}

/**
 * Why a funder is suggested, in plain statements traced to its stored totals.
 * State and cause are recorded separately, so the reasons never claim the
 * in-state grants were for the cause.
 */
export function suggestionReasons(row: SuggestionRow, state: string, causes: { key: string; label: string }[]): string[] {
  const years = row.firstTaxYear && row.lastTaxYear ? (row.firstTaxYear === row.lastTaxYear ? `tax year ${row.lastTaxYear}` : `tax years ${row.firstTaxYear}–${row.lastTaxYear}`) : "the filings imported";
  const inState = row.givingByState[state] ?? 0;
  const reasons = [`Paid ${usd(inState)} to recipients in ${state} (${row.totalPaidUsd ? Math.round((inState / row.totalPaidUsd) * 100) : 0}% of its giving), ${years}.`];
  const purposeShare = (row.categorySources.purpose ?? 0) / Math.max(1, Object.values(row.categorySources).reduce((s, n) => s + n, 0));
  for (const c of causes) {
    const amount = row.givingByCategory[c.key] ?? 0;
    if (amount > 0) reasons.push(`Paid ${usd(amount)} to ${c.label.toLowerCase()} recipients, all states.`);
  }
  if (purposeShare > 0.5) reasons.push("Most of its causes come from the grant purpose text, not the recipient's NTEE code, so treat them as approximate.");
  reasons.push("State and cause totals are counted separately: this does not show that its in-state grants were for your cause.");
  return reasons;
}
