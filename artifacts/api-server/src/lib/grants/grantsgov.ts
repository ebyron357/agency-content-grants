import { createHash } from "crypto";

/**
 * Grants.gov connector (public, keyless API).
 *
 * search2:          POST {base}/search2           — opportunity search with facets
 * fetchOpportunity: POST {base}/fetchOpportunity  — one opportunity's full record
 *
 * Both were verified from the agent environment on 3 November 2026. Normalization is
 * kept pure (no network) so it can be unit-tested against recorded fixtures.
 */

export const GRANTS_GOV_CONNECTOR_VERSION = "grants-gov@1";
export const GRANTS_GOV_SOURCE = "grants_gov";

const DEFAULT_BASE = "https://api.grants.gov/v1/api";
const PUBLIC_DETAIL_URL = "https://www.grants.gov/search-results-detail/";

export function grantsGovBase(): string {
  return (process.env.GRANTS_GOV_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

export function publicOpportunityUrl(id: string): string {
  return `${PUBLIC_DETAIL_URL}${encodeURIComponent(id)}`;
}

export interface SearchHit {
  id: string;
  number?: string;
  title: string;
  agencyCode?: string;
  agency?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
  cfdaList?: string[];
}

export interface SearchPage {
  hitCount: number;
  startRecord: number;
  hits: SearchHit[];
}

/** The opportunity fields Grant Studio stores, independent of the source's shape. */
export interface NormalizedOpportunity {
  sourceRef: string;
  number: string | null;
  title: string;
  agency: string | null;
  agencyCode: string | null;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  assistanceListings: string[];
  officialUrl: string;
}

export interface NormalizedDetail {
  awardFloor: number | null;
  awardCeiling: number | null;
  estimatedFunding: number | null;
  costSharing: boolean | null;
  eligibilityCodes: string[];
  eligibilityText: string | null;
  categories: string[];
  description: string | null;
  closeDate: string | null;
  openDate: string | null;
  agency: string | null;
  assistanceListings: string[];
  noticeUrl: string | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Converts the date formats Grants.gov uses to an ISO date (YYYY-MM-DD):
 * "11/17/2026" (search), "Nov 17, 2026 12:00:00 AM EST" (detail) and "2026-11-17".
 * Returns null for anything else rather than guessing.
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  match = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(text);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month) return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
  }
  return null;
}

/** Award amounts arrive as numbers, numeric strings, or "none". */
export function toAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount > 0 ? amount : null;
}

/** Removes markup from the source's HTML description; the UI renders plain text only. */
export function plainText(value: unknown, maxLength = 20_000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSearchHit(hit: SearchHit): NormalizedOpportunity | null {
  const sourceRef = str(hit.id);
  const title = str(hit.title);
  if (!sourceRef || !title) return null;
  const status = (str(hit.oppStatus) || "posted").toLowerCase();
  return {
    sourceRef,
    number: str(hit.number),
    title,
    agency: str(hit.agency),
    agencyCode: str(hit.agencyCode),
    status,
    openDate: toIsoDate(hit.openDate),
    closeDate: toIsoDate(hit.closeDate),
    assistanceListings: Array.isArray(hit.cfdaList) ? hit.cfdaList.filter((v) => typeof v === "string") : [],
    officialUrl: publicOpportunityUrl(sourceRef),
  };
}

type Coded = { id?: unknown; description?: unknown };

function codes(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((item: Coded) => str(item?.id)).filter((v): v is string => Boolean(v));
}

function descriptions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((item: Coded) => str(item?.description)).filter((v): v is string => Boolean(v));
}

/** Normalizes the `data` object of a fetchOpportunity response. */
export function normalizeDetail(data: Record<string, any>): NormalizedDetail {
  const synopsis: Record<string, any> = data?.synopsis ?? {};
  const forecast: Record<string, any> = data?.forecast ?? {};
  const source = Object.keys(synopsis).length ? synopsis : forecast;
  const cfdas = Array.isArray(data?.cfdas)
    ? data.cfdas.map((c: any) => str(c?.cfdaNumber)).filter((v: string | null): v is string => Boolean(v))
    : [];
  const pkg = Array.isArray(data?.opportunityPkgs) ? data.opportunityPkgs[0] : undefined;
  return {
    awardFloor: toAmount(source.awardFloor),
    awardCeiling: toAmount(source.awardCeiling),
    estimatedFunding: toAmount(source.estimatedFunding),
    costSharing: typeof source.costSharing === "boolean" ? source.costSharing : null,
    eligibilityCodes: codes(source.applicantTypes),
    eligibilityText: plainText(source.applicantEligibilityDesc, 4_000),
    categories: descriptions(source.fundingActivityCategories),
    description: plainText(source.synopsisDesc ?? source.forecastDesc),
    closeDate: toIsoDate(source.responseDate) ?? toIsoDate(pkg?.closingDate) ?? toIsoDate(source.estApplicationResponseDate),
    openDate: toIsoDate(source.postingDate) ?? toIsoDate(pkg?.openingDate),
    agency: str(source.agencyName),
    assistanceListings: cfdas,
    noticeUrl: str(source.fundingDescLinkUrl),
  };
}

/** A stable checksum of the normalized record, so a re-fetch that changes nothing writes nothing. */
export function checksumOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

async function post(path: string, body: unknown, fetchImpl: FetchLike, timeoutMs = 20_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${grantsGovBase()}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Grants.gov ${path} returned HTTP ${res.status}`);
    const payload = await res.json();
    if (payload?.errorcode && payload.errorcode !== 0) {
      throw new Error(`Grants.gov ${path} error ${payload.errorcode}: ${String(payload.msg ?? "").slice(0, 200)}`);
    }
    return payload?.data ?? {};
  } finally {
    clearTimeout(timer);
  }
}

export async function searchOpportunities(
  params: { eligibilities?: string; oppStatuses?: string; keyword?: string; rows?: number; startRecordNum?: number },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<SearchPage> {
  const data = await post("search2", { rows: 100, oppStatuses: "forecasted|posted", ...params }, fetchImpl);
  return {
    hitCount: Number(data.hitCount) || 0,
    startRecord: Number(data.startRecord) || 0,
    hits: Array.isArray(data.oppHits) ? data.oppHits : [],
  };
}

export async function fetchOpportunityDetail(id: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<NormalizedDetail> {
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error("Invalid Grants.gov opportunity id");
  const data = await post("fetchOpportunity", { opportunityId: numeric }, fetchImpl);
  return normalizeDetail(data);
}
