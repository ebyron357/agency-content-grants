import { createHash } from "crypto";
import { htmlPageToText } from "../sources/extraction";

/**
 * Shared pieces of the state feed connectors (Illinois, North Carolina, Utah;
 * docs/SOURCE_REGISTRY.md §7).
 *
 * Portions are adapted from KurtLehnardt/granted
 * (https://github.com/KurtLehnardt/granted, commit d6e143a,
 * scaffold/scripts/lib/normalizeNewSources.mjs), Copyright (c) 2026 Kurt
 * Lehnardt, MIT License: see LICENSE-granted.txt in this folder.
 *
 * Pure module: no database import, so every parser is unit-tested against
 * recorded pages.
 */

/** One state listing in the shape `grant_opportunities` stores (the same fields California's connector fills). */
export interface StateRecord {
  sourceRef: string;
  number: string | null;
  title: string;
  agency: string | null;
  agencyCode: null;
  /**
   * posted | forecasted | closed, or `listed` for a directory entry whose
   * source does not say whether it is open now. `listed` never passes the
   * publication gate, which only accepts posted or forecasted.
   */
  status: string;
  openDate: string | null;
  closeDate: string | null;
  rollingDeadline: boolean;
  awardFloor: number | null;
  awardCeiling: number | null;
  estimatedFunding: number | null;
  costSharing: boolean | null;
  costSharePercent: number | null;
  eligibilityCodes: string[];
  eligibilityText: string | null;
  categories: string[];
  assistanceListings: string[];
  description: string | null;
  officialUrl: string;
  jurisdiction: string;
}

/** Text of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export function cellText(html: string | null | undefined): string {
  return htmlPageToText(html ?? "").replace(/\s+/g, " ").trim();
}

/** A short stable reference from a URL or title, for sources with no id of their own. */
export function shortRef(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

/**
 * Every dollar figure in a text, as [lowest, highest]. A zero is no figure
 * ("$0 - $250000" has no stated floor). Prose with no figure gives [null, null]:
 * nothing is guessed. (granted's `parseDollarAmounts`.)
 */
export function dollarRange(text: string | null | undefined): [number | null, number | null] {
  const values = [...cellText(text).matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return [null, null];
  return [Math.min(...values), Math.max(...values)];
}

/** "11/02/2026" → "2026-11-02"; anything else, or an impossible date, → null. */
export function usDate(value: string | null | undefined): string | null {
  const m = (value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** An absolute https URL, resolving protocol-relative and relative links against `base`; anything else → null. */
export function httpsUrl(raw: string | null | undefined, base?: string): string | null {
  const s = cellText(raw);
  if (!s) return null;
  if (!/^(https?:)?\/\//i.test(s) && !base) return null;
  try {
    const url = new URL(s.startsWith("//") ? `https:${s}` : s, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function stateChecksum(record: StateRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/** The cells of each `<tr>` in an HTML fragment, as raw inner HTML. */
export function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
      // Skip interactive control cells (NC.gov's "show details" button column).
      .filter((c) => !/control-cell/.test(c[1]))
      .map((c) => c[2]);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** The first link in an HTML fragment: its decoded href and its text. */
export function firstLink(html: string): { href: string; text: string } | null {
  const m = html.match(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i);
  if (!m) return null;
  return { href: cellText(m[1] ?? m[2] ?? ""), text: cellText(m[3]) };
}

/** A GET of one page; the default is the source watcher's respectful built-in fetcher (sources/fetcher.ts). */
export type StatePageFetch = (url: string) => Promise<{ status: number; body: string }>;

/**
 * Below this many parsed rows a connector refuses the page instead of syncing:
 * a markup change that breaks parsing must not mark every listing closed.
 */
export class TooFewRowsError extends Error {
  constructor(source: string, parsed: number, min: number) {
    super(`${source}: parsed ${parsed} listings, fewer than the ${min} expected. The page layout may have changed, so nothing was updated.`);
  }
}
