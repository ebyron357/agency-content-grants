import { createHash } from "crypto";

/**
 * California Grants Portal connector.
 *
 * Source: the State of California's open-data dataset "California Grants
 * Portal - Grants Offered" on data.ca.gov (CKAN datastore, keyless, updated
 * daily). Each record is the full listing, so no separate detail fetch is
 * needed. Field names and value formats were profiled from all 2,027 records
 * on 4 November 2026.
 */

export const CA_SOURCE = "ca_grants_portal";
export const CA_CONNECTOR_VERSION = "ca-grants-portal@1";
export const CA_JURISDICTION = "CA";
/** The "Grants Offered" resource in the california-grants-portal dataset. */
export const CA_RESOURCE_ID = process.env.CA_GRANTS_RESOURCE_ID || "111c8c88-21f6-453c-ae2c-b4785a0624f5";
const PAGE_SIZE = 500;
const MAX_RECORDS = 5_000;

function caApiBase(): string {
  return (process.env.CA_GRANTS_API_BASE || "https://data.ca.gov/api/3/action").replace(/\/$/, "");
}

/** One record as the datastore returns it (all values are strings or null). */
export type CaRecord = Record<string, string | number | null>;

/**
 * California applicant types mapped to the Grants.gov eligibility codes that
 * Grant Studio's matching understands. "Nonprofit" does not distinguish
 * 501(c)(3) status, so it maps to both nonprofit codes; "Business" maps to both
 * business codes. Public agencies, tribal governments and individuals are not
 * Grant Studio applicant types, so they map to no code (they stay in the text).
 */
const CA_APPLICANT_CODES: Record<string, string[]> = {
  Nonprofit: ["12", "13"],
  Business: ["22", "23"],
  "Other Legal Entity": ["25"],
};

export interface CaNormalized {
  sourceRef: string;
  number: string | null;
  title: string;
  agency: string | null;
  agencyCode: null;
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

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/ /g, " ").trim();
  return s && s !== "None" ? s : null;
}

function list(value: unknown): string[] {
  const s = text(value);
  return s ? s.split(";").map((v) => v.trim()).filter(Boolean) : [];
}

/** "2026-12-04 17:00:00" → "2026-12-04"; anything else → null. */
export function caDate(value: unknown): string | null {
  const s = text(value);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function money(value: string): number | null {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "Between $10,000.00 and $300,000.00" → [10000, 300000]; "$50,000.00" → [50000, 50000]; prose → [null, null]. */
export function caAmountRange(value: unknown): [number | null, number | null] {
  const s = text(value);
  if (!s) return [null, null];
  const between = s.match(/^Between\s+(\$[\d,.]+)\s+and\s+(\$[\d,.]+)$/i);
  if (between) return [money(between[1]), money(between[2])];
  const single = s.match(/^\$[\d,.]+$/);
  if (single) {
    const n = money(s);
    return [n, n];
  }
  return [null, null];
}

/** "Not Required" → no share; "25%" → 25; anything else is unknown. */
export function caMatching(value: unknown): { costSharing: boolean | null; costSharePercent: number | null } {
  const s = text(value);
  if (!s) return { costSharing: null, costSharePercent: null };
  if (/^not required$/i.test(s)) return { costSharing: false, costSharePercent: null };
  const pct = s.match(/^(\d{1,3})\s*%$/);
  if (pct) return { costSharing: true, costSharePercent: Number(pct[1]) };
  return { costSharing: true, costSharePercent: null };
}

function httpsOrNull(value: unknown): string | null {
  const s = text(value);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

export function normalizeCaRecord(r: CaRecord): CaNormalized | null {
  const sourceRef = text(r.PortalID);
  const title = text(r.Title);
  if (!sourceRef || !title) return null;
  const rawStatus = (text(r.Status) ?? "").toLowerCase();
  const status = rawStatus === "active" ? "posted" : rawStatus === "forecasted" ? "forecasted" : rawStatus || "unknown";
  const deadline = text(r.ApplicationDeadline);
  const [awardFloor, awardCeiling] = caAmountRange(r.EstAmounts);
  const applicantTypes = list(r.ApplicantType);
  const codes = [...new Set(applicantTypes.flatMap((t) => CA_APPLICANT_CODES[t] ?? []))].sort();
  const eligibilityText = [
    applicantTypes.length ? `California applicant types: ${applicantTypes.join("; ")}.` : null,
    text(r.ApplicantTypeNotes),
    text(r.Geography) ? `Geography: ${text(r.Geography)}` : null,
  ].filter(Boolean).join("\n\n") || null;
  const description = [text(r.Purpose), text(r.Description), text(r.MatchingFundsNotes) ? `Matching funds: ${text(r.MatchingFundsNotes)}` : null, text(r.FundingMethod) ? `Funding method: ${text(r.FundingMethod)}` : null]
    .filter(Boolean)
    .join("\n\n") || null;
  return {
    sourceRef,
    number: text(r.GrantID),
    title,
    agency: text(r.AgencyDept),
    agencyCode: null,
    status,
    openDate: caDate(r.OpenDate),
    closeDate: caDate(deadline),
    rollingDeadline: /^ongoing$/i.test(deadline ?? ""),
    awardFloor,
    awardCeiling,
    estimatedFunding: money(text(r.EstAvailFunds) ?? ""),
    ...caMatching(r.MatchingFunds),
    eligibilityCodes: codes,
    eligibilityText,
    categories: list(r.Categories),
    assistanceListings: [],
    description,
    // The program page first; the agency page when the program link is not https.
    officialUrl: httpsOrNull(r.GrantURL) ?? httpsOrNull(r.AgencyURL) ?? text(r.GrantURL) ?? "",
    jurisdiction: CA_JURISDICTION,
  };
}

export function caChecksum(record: CaNormalized): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/** A GET-only fetch, so tests can inject a fake California portal. */
export type CaFetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Reads every open (active or forecasted) record, page by page. */
export async function fetchOpenCaRecords(fetchImpl: CaFetchLike = fetch as unknown as CaFetchLike, timeoutMs = 30_000): Promise<CaRecord[]> {
  const out: CaRecord[] = [];
  for (let offset = 0; offset < MAX_RECORDS; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      resource_id: CA_RESOURCE_ID,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      filters: JSON.stringify({ Status: ["active", "forecasted"] }),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let body: { success?: boolean; result?: { records?: CaRecord[]; total?: number } };
    try {
      const res = await fetchImpl(`${caApiBase()}/datastore_search?${params}`, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
      if (!res.ok) throw new Error(`California Grants Portal returned ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (!body.success || !Array.isArray(body.result?.records)) throw new Error("California Grants Portal returned an unexpected response");
    out.push(...body.result!.records!);
    if (body.result!.records!.length < PAGE_SIZE) break;
  }
  return out;
}
