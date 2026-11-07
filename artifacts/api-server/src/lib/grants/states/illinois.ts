import { TooFewRowsError, cellText, dollarRange, firstLink, httpsUrl, shortRef, tableRows, usDate, type StatePageFetch, type StateRecord } from "./common";
import { todayIso } from "../gate";

/**
 * Illinois connector: the Catalog of State Financial Assistance (CSFA)
 * opportunity list, the State's central list of open notices of funding
 * opportunity under the Grant Accountability and Transparency Act (GATA).
 *
 * The page is one server-rendered table (Opportunity Title, Agency,
 * Application Date Range, Award Range) with no API or export, so the connector
 * reads the table. Adapted from KurtLehnardt/granted
 * (scaffold/scripts/1-fetch-il-grants.mjs and normalizeIlRow in
 * scaffold/scripts/lib/normalizeNewSources.mjs, commit d6e143a), Copyright (c)
 * 2026 Kurt Lehnardt, MIT License: see LICENSE-granted.txt in this folder.
 * Changes: the table is read cell by cell, so both the markup granted matched
 * (relative, single-quoted `GMS.aspx` links) and the markup recorded on
 * 7 November 2026 (absolute, double-quoted links with a "GMS" badge) parse; the
 * application window sets the status (forecasted before it opens, closed after
 * it ends) and a stated "No end date" is a rolling deadline, as California's
 * "Ongoing" is; zero amounts are no amount.
 *
 * Use the plain host: granted recorded that `www.omb.illinois.gov` did not connect.
 */

export const IL_SOURCE = "il_csfa";
export const IL_CONNECTOR_VERSION = "il-csfa@1";
export const IL_JURISDICTION = "IL";
export const IL_LIST_URL = "https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx";
/** The list had 126 rows on 7 November 2026 (granted saw 113 earlier). */
export const IL_MIN_ROWS = 20;

export interface IlRow {
  title: string;
  /** The opportunity's own page: the AmpliFund notice for GMS rows, the CSFA notice otherwise. */
  url: string | null;
  /** A stable reference: the AmpliFund notice id, the CSFA `nofo` number, or a hash of the link. */
  ref: string;
  agency: string;
  dateRange: string;
  awardRange: string;
}

/** The opportunity's own URL and a stable reference from the title cell's link. */
function linkTarget(href: string): { url: string | null; ref: string | null } {
  const gms = href.match(/GMS\.aspx\?url=([^&]+)/i);
  if (gms) {
    let target: string;
    try {
      target = decodeURIComponent(gms[1].replace(/\+/g, " "));
    } catch {
      return { url: null, ref: null };
    }
    const url = httpsUrl(target);
    const id = url?.match(/\/Details\/([0-9a-f-]{36})/i)?.[1];
    return { url, ref: id ? `gms-${id.toLowerCase()}` : url ? `gms-${shortRef(url)}` : null };
  }
  const nofo = href.match(/Opportunity\.aspx\?nofo=(\d+)/i);
  if (nofo) return { url: `https://omb.illinois.gov/public/gata/csfa/Opportunity.aspx?nofo=${nofo[1]}`, ref: `nofo-${nofo[1]}` };
  const url = httpsUrl(href, IL_LIST_URL);
  return { url, ref: url ? `url-${shortRef(url)}` : null };
}

/** Every row of the CSFA table whose title cell links to an opportunity. A row of another shape is skipped, never guessed. */
export function parseIlOpportunityList(html: string): IlRow[] {
  const out: IlRow[] = [];
  for (const cells of tableRows(html)) {
    if (cells.length !== 4) continue;
    const link = firstLink(cells[0]);
    if (!link?.text) continue;
    const { url, ref } = linkTarget(link.href);
    if (!ref) continue;
    out.push({ title: link.text, url, ref, agency: cellText(cells[1]), dateRange: cellText(cells[2]), awardRange: cellText(cells[3]) });
  }
  return out;
}

/** "11/02/2026 - 01/06/2027" → both dates; "04/03/2025 - No end date" → an open date and no end. */
export function ilDateRange(value: string): { openDate: string | null; closeDate: string | null; noEndDate: boolean } {
  const m = value.match(/^\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(.+?)\s*$/);
  if (!m) return { openDate: null, closeDate: null, noEndDate: false };
  return { openDate: usDate(m[1]), closeDate: usDate(m[2]), noEndDate: /^no end date$/i.test(m[2]) };
}

export function normalizeIlRow(row: IlRow, now: Date = new Date()): StateRecord | null {
  if (!row.title) return null;
  const { openDate, closeDate, noEndDate } = ilDateRange(row.dateRange);
  const today = todayIso(now);
  // The window the State lists decides the status; an unreadable window stays "posted" and the gate asks for a closing date.
  const status = openDate && openDate > today ? "forecasted" : closeDate && closeDate < today ? "closed" : "posted";
  const [awardFloor, awardCeiling] = dollarRange(row.awardRange);
  const description = [
    "Listed in the Illinois Catalog of State Financial Assistance (CSFA) opportunity list.",
    row.dateRange ? `Application period as listed: ${row.dateRange}.` : null,
    row.awardRange ? `Award range as listed: ${row.awardRange}.` : null,
    "Eligibility and requirements are in the official notice.",
  ].filter(Boolean).join(" ");
  return {
    sourceRef: row.ref,
    number: null,
    title: row.title,
    agency: row.agency || null,
    agencyCode: null,
    status,
    openDate,
    closeDate,
    rollingDeadline: noEndDate,
    awardFloor,
    awardCeiling,
    estimatedFunding: null,
    costSharing: null,
    costSharePercent: null,
    eligibilityCodes: [],
    eligibilityText: null,
    categories: [],
    assistanceListings: [],
    description,
    officialUrl: row.url ?? "",
    jurisdiction: IL_JURISDICTION,
  };
}

export async function fetchIlRecords(fetchPage: StatePageFetch, now: Date = new Date(), minRows: number = IL_MIN_ROWS): Promise<StateRecord[]> {
  const res = await fetchPage(IL_LIST_URL);
  if (res.status !== 200) throw new Error(`Illinois CSFA opportunity list returned HTTP ${res.status}`);
  const rows = parseIlOpportunityList(res.body);
  if (rows.length < minRows) throw new TooFewRowsError("Illinois CSFA opportunity list", rows.length, minRows);
  return rows.map((r) => normalizeIlRow(r, now)).filter((r): r is StateRecord => r !== null);
}
