import { TooFewRowsError, cellText, firstLink, httpsUrl, shortRef, tableRows, type StatePageFetch, type StateRecord } from "./common";

/**
 * North Carolina connector: the NC.gov grant opportunities directory, one
 * table of State grant programs (Category, Grant Program with a link, Agency,
 * Description) with no API or export.
 *
 * A shallow source: the directory states no deadline, award amount or
 * eligibility, and does not say whether a program is accepting applications
 * now. Its rows are stored as `listed`, which the publication gate never
 * publishes; a program's own page, watched as a `watched_page` source, is what
 * can produce a reviewable open call. Nothing is guessed.
 *
 * Adapted from KurtLehnardt/granted (scaffold/scripts/1-fetch-nc-grants.mjs and
 * normalizeNcRow in scaffold/scripts/lib/normalizeNewSources.mjs, commit
 * d6e143a), Copyright (c) 2026 Kurt Lehnardt, MIT License: see
 * LICENSE-granted.txt in this folder. Changes: rows are read cell by cell,
 * skipping the "show details" control column the page added after granted's
 * flat-row pattern was written (recorded 7 November 2026), so both shapes parse.
 */

export const NC_SOURCE = "nc_grant_directory";
export const NC_CONNECTOR_VERSION = "nc-grant-directory@1";
export const NC_JURISDICTION = "NC";
export const NC_DIRECTORY_URL = "https://www.nc.gov/your-government/all-nc-state-services/grant-opportunities";
/** The directory had 86 rows on 7 November 2026. */
export const NC_MIN_ROWS = 20;

export interface NcRow {
  category: string;
  url: string | null;
  title: string;
  agency: string;
  description: string;
}

/** Rows of the directory table: four cells, the second linking to the program. */
export function parseNcDirectory(html: string): NcRow[] {
  const start = html.search(/<tbody\b/i);
  const end = start === -1 ? -1 : html.indexOf("</tbody>", start);
  if (start === -1 || end === -1) return [];
  const out: NcRow[] = [];
  for (const cells of tableRows(html.slice(start, end))) {
    if (cells.length !== 4) continue;
    const link = firstLink(cells[1]);
    if (!link?.text) continue;
    out.push({ category: cellText(cells[0]), url: httpsUrl(link.href, NC_DIRECTORY_URL), title: link.text, agency: cellText(cells[2]), description: cellText(cells[3]) });
  }
  return out;
}

export function normalizeNcRow(row: NcRow): StateRecord | null {
  if (!row.title) return null;
  const description = [
    row.description || null,
    "Listed in the NC.gov grant opportunities directory, which does not state deadlines, award amounts, eligibility or whether the program is open now. Check the program's own page.",
  ].filter(Boolean).join("\n\n");
  return {
    sourceRef: `nc-${shortRef(row.url || row.title)}`,
    number: null,
    title: row.title,
    agency: row.agency || null,
    agencyCode: null,
    status: "listed",
    openDate: null,
    closeDate: null,
    rollingDeadline: false,
    awardFloor: null,
    awardCeiling: null,
    estimatedFunding: null,
    costSharing: null,
    costSharePercent: null,
    eligibilityCodes: [],
    eligibilityText: null,
    categories: row.category ? [row.category] : [],
    assistanceListings: [],
    description,
    officialUrl: row.url ?? "",
    jurisdiction: NC_JURISDICTION,
  };
}

export async function fetchNcRecords(fetchPage: StatePageFetch, minRows: number = NC_MIN_ROWS): Promise<StateRecord[]> {
  const res = await fetchPage(NC_DIRECTORY_URL);
  if (res.status !== 200) throw new Error(`NC.gov grant opportunities directory returned HTTP ${res.status}`);
  const rows = parseNcDirectory(res.body);
  if (rows.length < minRows) throw new TooFewRowsError("NC.gov grant opportunities directory", rows.length, minRows);
  return rows.map(normalizeNcRow).filter((r): r is StateRecord => r !== null);
}
