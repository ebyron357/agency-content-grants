/**
 * Organization lookup by EIN from the ProPublica Nonprofit Explorer API v2
 * (docs/SELF_SIGNUP.md §5).
 *
 * GET https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json
 * returns `{ organization, filings_with_data, ... }` for an organization in the
 * IRS Exempt Organizations Business Master File, and HTTP 404 for an EIN it
 * does not know. The API needs no key. Its documentation page (checked
 * 7 November 2026) says "Usage constitutes agreement to our Data Terms of
 * Use" and sets no request limit; the owner must review those terms before
 * the lookup is used in production (owner action in docs/SELF_SIGNUP.md).
 *
 * Only the fields below are read and kept; nothing else from the response is
 * stored. Every value is shown to the person as an unconfirmed fact with this
 * source, and none is used until they confirm it.
 *
 * Pure module: no database import. The network call is injectable for tests.
 */
import { NTEE_GROUPS } from "../foundations/aggregate";

export const PROPUBLICA_SOURCE = {
  name: "ProPublica Nonprofit Explorer API v2",
  api: "https://projects.propublica.org/nonprofits/api",
  terms: "Using the API means agreeing to ProPublica's Data Terms of Use (linked from the API page); the data comes from the IRS Exempt Organizations Business Master File and Form 990 filings.",
  attribution: "Organization data from ProPublica Nonprofit Explorer (IRS filings).",
} as const;

export interface NonprofitRecord {
  /** Nine digits, no dash. */
  ein: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  nteeCode: string | null;
  /** NTEE major group letter, A–Z. */
  nteeGroup: string | null;
  nteeLabel: string | null;
  /** IRS subsection: 3 means 501(c)(3). */
  subsectionCode: number | null;
  /** Total revenue from the latest filing with data, else the master file. Whole US dollars. */
  revenue: number | null;
  /** Tax year that revenue is for, when known. */
  revenueYear: number | null;
  revenueFrom: "filing" | "master_file" | null;
  profileUrl: string;
}

export type LookupOutcome =
  | { kind: "found"; record: NonprofitRecord }
  | { kind: "not_found" }
  | { kind: "unavailable"; reason: string };

/** Accepts 12-3456789 or 123456789. Returns nine digits or null. */
export function normalizeEin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.trim().replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits) || digits === "000000000") return null;
  return digits;
}

export function formatEin(ein: string): string {
  return /^\d{9}$/.test(ein) ? `${ein.slice(0, 2)}-${ein.slice(2)}` : ein;
}

export function profileUrl(ein: string): string {
  return `https://projects.propublica.org/nonprofits/organizations/${ein}`;
}

const text = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Title case for the all-capitals names and addresses in IRS records ("FRIENDS OF THE LIBRARY INC" → "Friends of the Library Inc"). */
export function tidyCase(value: string | null): string | null {
  if (!value || /[a-z]/.test(value)) return value;
  const small = new Set(["of", "the", "and", "for", "in", "on", "at", "to", "a", "an", "by"]);
  return value
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, i) => (i > 0 && small.has(word) ? word : word.replace(/^(\w)/, (c) => c.toUpperCase())))
    .join("")
    .replace(/\b(Po|Llc|Usa|Ymca|Ywca)\b/g, (w) => w.toUpperCase());
}

/** Reads the fields GrantCrest uses from an organization response. Returns null when the body has no organization. */
export function parseOrganization(body: unknown, requestedEin: string): NonprofitRecord | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).organization;
  const org = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!org || typeof org !== "object") return null;
  const name = text(org.name);
  if (!name) return null;
  const ein = normalizeEin(String(org.ein ?? "").padStart(9, "0")) ?? requestedEin;
  const ntee = text(org.ntee_code, 10)?.toUpperCase() ?? null;
  const letter = ntee && /^[A-Z]/.test(ntee) ? ntee[0] : null;
  const filings = Array.isArray((body as Record<string, unknown>).filings_with_data) ? ((body as Record<string, unknown>).filings_with_data as Record<string, unknown>[]) : [];
  const latest = filings
    .map((f) => ({ year: num(f.tax_prd_yr) ?? (num(f.tax_prd) ? Math.floor(num(f.tax_prd)! / 100) : null), revenue: num(f.totrevenue) }))
    .filter((f) => f.revenue !== null)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
  const masterRevenue = num(org.revenue_amount);
  const masterPeriod = num(org.tax_period);
  const state = text(org.state, 20)?.toUpperCase() ?? null;
  return {
    ein,
    name: tidyCase(name)!,
    address: tidyCase(text(org.address)),
    city: tidyCase(text(org.city, 80)),
    state: state && /^[A-Z]{2}$/.test(state) ? state : null,
    zipcode: text(org.zipcode, 10),
    nteeCode: ntee,
    nteeGroup: letter,
    nteeLabel: letter ? (NTEE_GROUPS[letter] ?? null) : null,
    subsectionCode: num(org.subsection_code ?? org.subseccd),
    revenue: latest ? latest.revenue : masterRevenue,
    revenueYear: latest ? latest.year : masterPeriod ? Math.floor(masterPeriod / 100) : null,
    revenueFrom: latest ? "filing" : masterRevenue !== null ? "master_file" : null,
    profileUrl: profileUrl(ein),
  };
}

/** Revenue bands, for a profile fact and for judging award size. */
export const REVENUE_BANDS: { max: number; label: string }[] = [
  { max: 50_000, label: "Under $50,000" },
  { max: 250_000, label: "$50,000 to $249,999" },
  { max: 1_000_000, label: "$250,000 to $999,999" },
  { max: 5_000_000, label: "$1 million to $4.9 million" },
  { max: 25_000_000, label: "$5 million to $24.9 million" },
  { max: Number.POSITIVE_INFINITY, label: "$25 million or more" },
];

export function revenueBand(revenue: number | null | undefined): string | null {
  if (revenue === null || revenue === undefined || !Number.isFinite(revenue) || revenue < 0) return null;
  return REVENUE_BANDS.find((b) => revenue < b.max)!.label;
}

export function fullAddress(r: Pick<NonprofitRecord, "address" | "city" | "state" | "zipcode">): string | null {
  const cityLine = [r.city, [r.state, r.zipcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const parts = [r.address, cityLine].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export type FetchJson = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

let fetchOverride: FetchJson | null = null;

/** Tests answer the lookup with fixtures instead of the network. Pass null to restore. */
export function setNonprofitFetchForTests(fn: FetchJson | null): void {
  fetchOverride = fn;
}

export const LOOKUP_TIMEOUT_MS = 8_000;

export async function fetchOrganization(ein: string, env: NodeJS.ProcessEnv = process.env): Promise<LookupOutcome> {
  if (env.NONPROFIT_LOOKUP_DISABLED === "true") return { kind: "unavailable", reason: "The EIN lookup is turned off on this server." };
  const doFetch = fetchOverride ?? (fetch as unknown as FetchJson);
  let res: Awaited<ReturnType<FetchJson>>;
  try {
    res = await doFetch(`https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`, {
      headers: { Accept: "application/json", "User-Agent": "GrantCrest onboarding (organization lookup)" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable", reason: "ProPublica Nonprofit Explorer could not be reached." };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "unavailable", reason: `ProPublica Nonprofit Explorer answered with an error (HTTP ${res.status}).` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "unavailable", reason: "ProPublica Nonprofit Explorer sent a response that could not be read." };
  }
  const record = parseOrganization(body, ein);
  return record ? { kind: "found", record } : { kind: "not_found" };
}
