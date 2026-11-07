import { TooFewRowsError, cellText, dollarRange, shortRef, type StateRecord } from "./common";

/**
 * Utah connector: the State's "Utah Funding Opportunities Portal", which the
 * Governor's Office of Planning and Budget links from
 * https://gopb.utah.gov/funding-resources/. It is a Google Looker Studio
 * report: no API, no export and no server-rendered table. Its cards (an h4
 * title, five h5 lines "Category:", "Agency:", "Opportunity Amount:", "Grant
 * Match:", "Loan Interest:", a description and a "Learn More" link) render
 * only in a browser, two cross-origin iframes deep.
 *
 * So this connector is a parser of the rendered cards plus a renderer hook.
 * The API server has no browser, and no renderer is configured, so the feed
 * cannot run here: `fetchUtRecords` fails with a plain reason unless a renderer
 * is supplied. Its registry row stays disabled (docs/SOURCE_REGISTRY.md §7).
 *
 * Like North Carolina's directory, the cards state no deadline, no eligibility
 * and not whether a program is open now, so rows are `listed` and never pass
 * the publication gate. granted's seven hand-added Utah programs
 * (utManualAdditions.mjs) are not carried over: they are tax-increment zones,
 * not grant calls, and were hand-entered rather than read from the State.
 *
 * Adapted from KurtLehnardt/granted (scaffold/scripts/1-fetch-ut-grants.mjs and
 * normalizeUtRow in scaffold/scripts/lib/normalizeNewSources.mjs, commit
 * d6e143a), Copyright (c) 2026 Kurt Lehnardt, MIT License: see
 * LICENSE-granted.txt in this folder.
 */

export const UT_SOURCE = "ut_funding_portal";
export const UT_CONNECTOR_VERSION = "ut-funding-portal@1";
export const UT_JURISDICTION = "UT";
export const UT_REPORT_URL = "https://lookerstudio.google.com/u/0/reporting/ef90555b-7a4d-4b8e-898e-c427c996bf65/page/WFAzC";
/** granted saw about 200 cards. */
export const UT_MIN_ROWS = 100;

export interface UtCard {
  title: string;
  category: string;
  agency: string;
  amount: string;
  grantMatch: string;
  loanInterest: string;
  description: string;
  url: string;
}

/** Renders the report in a browser and returns the cards' HTML (the inner `viz-loader` document). */
export type UtRenderer = (url: string) => Promise<string>;

/** Splits rendered card HTML into cards (`.mdc-layout-grid__cell`) and reads each one's fields. */
export function parseUtCards(html: string): UtCard[] {
  const starts = [...html.matchAll(/<div\b[^>]*class\s*=\s*"[^"]*\bmdc-layout-grid__cell\b[^"]*"[^>]*>/gi)].map((m) => m.index!);
  const out: UtCard[] = [];
  starts.forEach((start, i) => {
    const cell = html.slice(start, starts[i + 1] ?? html.length);
    const h5s = [...cell.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi)].map((m) => cellText(m[1]));
    const field = (label: string) => {
      const line = h5s.find((h) => h.toLowerCase().startsWith(`${label.toLowerCase()}:`));
      return line ? line.slice(label.length + 1).trim() : "";
    };
    const href = cell.match(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    out.push({
      title: cellText(cell.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1]),
      category: field("Category"),
      agency: field("Agency"),
      amount: field("Opportunity Amount"),
      grantMatch: field("Grant Match"),
      loanInterest: field("Loan Interest"),
      description: cellText(cell.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]),
      url: cellText(href?.[1] ?? href?.[2] ?? ""),
    });
  });
  return out.filter((c) => c.title);
}

/** "Learn More" is absolute, protocol-relative, or placeholder text ("TBD"); placeholder text is no link. (granted's `resolveUtUrl`, https only.) */
export function utUrl(raw: string): string | null {
  const t = raw.trim();
  if (/^https:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return `https:${t}`;
  return null;
}

/** "N/A", "None", "-" or blank: not a loan. Anything else is a stated loan term. */
function hasLoanInterest(raw: string): boolean {
  const t = raw.trim();
  return t.length > 0 && !/^(n\/a|none|-)$/i.test(t);
}

export function normalizeUtCard(card: UtCard): StateRecord | null {
  if (!card.title) return null;
  const [awardFloor, awardCeiling] = dollarRange(card.amount);
  const kind = hasLoanInterest(card.loanInterest) ? "Loan" : /tax credit/i.test(`${card.title} ${card.category}`) ? "Tax credit" : null;
  const description = [
    card.description || null,
    kind ? `Funding type: ${kind}${kind === "Loan" ? ` (loan interest as listed: ${card.loanInterest})` : ""}.` : null,
    card.grantMatch && !/^(n\/a|none|-)$/i.test(card.grantMatch) ? `Grant match as listed: ${card.grantMatch}.` : null,
    "Listed in the Utah Funding Opportunities Portal, which does not state deadlines, eligibility or whether the program is open now. Check the program's own page.",
  ].filter(Boolean).join("\n\n");
  return {
    // No id in the source: a hash of title and agency, as granted derives it.
    sourceRef: `ut-${shortRef(`${card.title}${card.agency}`)}`,
    number: null,
    title: card.title,
    agency: card.agency || null,
    agencyCode: null,
    status: "listed",
    openDate: null,
    closeDate: null,
    rollingDeadline: false,
    awardFloor: awardFloor !== awardCeiling ? awardFloor : null,
    awardCeiling,
    estimatedFunding: null,
    costSharing: null,
    costSharePercent: null,
    eligibilityCodes: [],
    eligibilityText: null,
    categories: card.category ? [card.category] : [],
    assistanceListings: [],
    description,
    officialUrl: utUrl(card.url) ?? "",
    jurisdiction: UT_JURISDICTION,
  };
}

export const UT_NO_RENDERER =
  "Utah's funding portal is a Google Looker Studio report that only renders in a browser. No browser renderer is configured for the API server, so this connector cannot read it.";

export async function fetchUtRecords(render: UtRenderer | null, minRows: number = UT_MIN_ROWS): Promise<StateRecord[]> {
  if (!render) throw new Error(UT_NO_RENDERER);
  const cards = parseUtCards(await render(UT_REPORT_URL));
  if (cards.length < minRows) throw new TooFewRowsError("Utah Funding Opportunities Portal", cards.length, minRows);
  return cards.map(normalizeUtCard).filter((r): r is StateRecord => r !== null);
}
