/**
 * Past federal awards per Assistance Listing, from the USAspending.gov API
 * (docs/GRANT_STUDIO.md, Past federal awards).
 *
 * Pure module: no database import. Request bodies follow the published API
 * contracts (usaspending-api, CC0):
 *   POST /api/v2/search/spending_by_award/        (api_contracts/contracts/v2/search/spending_by_award.md)
 *   POST /api/v2/search/spending_by_award_count/  (…/spending_by_award_count.md)
 * Grants only: award type codes 02, 03, 04 and 05 (block, formula, project
 * and cooperative agreement). The API is public and needs no key.
 */

export const DEFAULT_API_BASE = "https://api.usaspending.gov";
export const GRANT_TYPE_CODES = ["02", "03", "04", "05"] as const;
/** The API's largest page. */
export const SAMPLE_SIZE = 100;
/** Federal fiscal years searched, counting the current one. */
export const FISCAL_YEARS = 4;
export const LABEL = "Past federal awards from USAspending.gov: what this program funded before, not a promise of future awards";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** An Assistance Listing (CFDA) number: two digits, a dot, three digits (some carry a letter). */
export const PROGRAM_NUMBER = /^\d{2}\.\d{3}[A-Z]?$/;

export function normalizeProgramNumber(v: string): string | null {
  const s = v.trim().toUpperCase();
  return PROGRAM_NUMBER.test(s) ? s : null;
}

/** The federal fiscal year a date falls in (October starts the next one). */
export function fiscalYear(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate);
  if (!m) return null;
  const y = Number(m[1]);
  return Number(m[2]) >= 10 ? y + 1 : y;
}

/** The window searched: the start of the fiscal year FISCAL_YEARS − 1 years back, to today. */
export function searchWindow(now = new Date()): { start: string; end: string } {
  const fy = fiscalYear(now.toISOString().slice(0, 10))!;
  return { start: `${fy - FISCAL_YEARS}-10-01`, end: now.toISOString().slice(0, 10) };
}

export function filters(programNumber: string, window: { start: string; end: string }) {
  return {
    program_numbers: [programNumber],
    award_type_codes: [...GRANT_TYPE_CODES],
    time_period: [{ start_date: window.start, end_date: window.end }],
  };
}

export const AWARD_FIELDS = ["Award ID", "Recipient Name", "Award Amount", "Start Date", "Recipient Location", "generated_internal_id"] as const;

export function awardsRequest(programNumber: string, window: { start: string; end: string }) {
  return { filters: filters(programNumber, window), fields: [...AWARD_FIELDS], sort: "Start Date", order: "desc", limit: SAMPLE_SIZE, page: 1, subawards: false };
}

export function countRequest(programNumber: string, window: { start: string; end: string }) {
  return { filters: filters(programNumber, window), subawards: false };
}

export interface PastAward {
  awardId: string | null;
  /** USAspending's own id, for the award page link. */
  generatedId: string | null;
  recipient: string;
  amountUsd: number;
  startDate: string | null;
  fiscalYear: number | null;
  /** Recipient's state (two letters), or null when foreign or not given. */
  state: string | null;
}

/** Parses spending_by_award results; rows without a recipient or a positive amount are skipped. */
export function parseAwards(body: unknown): PastAward[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error("USAspending answered without a results list");
  const out: PastAward[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const amount = Number(r["Award Amount"]);
    const recipient = typeof r["Recipient Name"] === "string" ? (r["Recipient Name"] as string).trim().slice(0, 200) : "";
    if (!recipient || !Number.isFinite(amount) || amount <= 0) continue;
    const start = typeof r["Start Date"] === "string" ? (r["Start Date"] as string).slice(0, 10) : null;
    const loc = (r["Recipient Location"] ?? {}) as Record<string, unknown>;
    const state = typeof loc.state_code === "string" && /^[A-Z]{2}$/.test(loc.state_code) ? loc.state_code : null;
    out.push({
      awardId: typeof r["Award ID"] === "string" ? (r["Award ID"] as string).slice(0, 80) : null,
      generatedId: typeof r.generated_internal_id === "string" && /^[A-Za-z0-9_.-]{1,200}$/.test(r.generated_internal_id) ? r.generated_internal_id : null,
      recipient,
      amountUsd: Math.round(amount),
      startDate: start,
      fiscalYear: start ? fiscalYear(start) : null,
      state,
    });
  }
  return out;
}

export function parseCount(body: unknown): number | null {
  const n = Number((body as { results?: { grants?: unknown } })?.results?.grants);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

export class UsaspendingError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

async function post(fetchImpl: FetchLike, url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new UsaspendingError(`USAspending could not be reached (${(err as Error).message || "network error"})`, false);
  }
  if (!res.ok) {
    // 400 and 422 mean the request itself is wrong: running again will not help.
    throw new UsaspendingError(`USAspending answered ${res.status}`, res.status === 400 || res.status === 422);
  }
  try {
    return await res.json();
  } catch {
    throw new UsaspendingError("USAspending answered with something other than JSON", false);
  }
}

export interface ListingRead {
  programNumber: string;
  window: { start: string; end: string };
  totalAwards: number | null;
  awards: PastAward[];
}

/** Reads one listing: the most recent awards and the total count. */
export async function readListing(programNumber: string, opts: { apiBase?: string; fetchImpl?: FetchLike; signal?: AbortSignal; now?: Date } = {}): Promise<ListingRead> {
  const base = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const window = searchWindow(opts.now);
  const awards = parseAwards(await post(fetchImpl, `${base}/api/v2/search/spending_by_award/`, awardsRequest(programNumber, window), opts.signal));
  const totalAwards = parseCount(await post(fetchImpl, `${base}/api/v2/search/spending_by_award_count/`, countRequest(programNumber, window), opts.signal));
  return { programNumber, window, totalAwards, awards };
}

// ── Summaries, computed when the page asks ─────────────────────────────────

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

export interface ListingSummary {
  sampleSize: number;
  amounts: { min: number; p25: number; median: number; p75: number; max: number; total: number } | null;
  byFiscalYear: { fiscalYear: number; count: number; usd: number }[];
  topStates: { state: string; count: number; usd: number }[];
  inState: { state: string; count: number; usd: number; awards: PastAward[] } | null;
  recent: PastAward[];
}

export function summarize(awards: PastAward[], state: string | null, recent = 10): ListingSummary {
  const amounts = awards.map((a) => a.amountUsd).sort((a, b) => a - b);
  const years = new Map<number, { count: number; usd: number }>();
  const states = new Map<string, { count: number; usd: number }>();
  for (const a of awards) {
    if (a.fiscalYear) {
      const y = years.get(a.fiscalYear) ?? { count: 0, usd: 0 };
      years.set(a.fiscalYear, { count: y.count + 1, usd: y.usd + a.amountUsd });
    }
    if (a.state) {
      const s = states.get(a.state) ?? { count: 0, usd: 0 };
      states.set(a.state, { count: s.count + 1, usd: s.usd + a.amountUsd });
    }
  }
  const mine = state ? awards.filter((a) => a.state === state) : [];
  return {
    sampleSize: awards.length,
    amounts: amounts.length
      ? { min: amounts[0], p25: quantile(amounts, 0.25), median: quantile(amounts, 0.5), p75: quantile(amounts, 0.75), max: amounts[amounts.length - 1], total: amounts.reduce((s, n) => s + n, 0) }
      : null,
    byFiscalYear: [...years.entries()].map(([fiscalYear, v]) => ({ fiscalYear, ...v })).sort((a, b) => b.fiscalYear - a.fiscalYear),
    topStates: [...states.entries()].map(([s, v]) => ({ state: s, ...v })).sort((a, b) => b.count - a.count || b.usd - a.usd || a.state.localeCompare(b.state)).slice(0, 5),
    inState: state ? { state, count: mine.length, usd: mine.reduce((s, a) => s + a.amountUsd, 0), awards: mine.slice(0, 5) } : null,
    recent: awards.slice(0, recent),
  };
}

export function awardUrl(generatedId: string | null): string | null {
  return generatedId ? `https://www.usaspending.gov/award/${encodeURIComponent(generatedId)}` : null;
}
