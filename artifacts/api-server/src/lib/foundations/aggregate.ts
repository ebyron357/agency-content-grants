/**
 * Foundation giving aggregation (docs/GRANT_STUDIO.md, Foundations).
 *
 * Pure module: no database import, so parsing and aggregation are unit-tested
 * on their own. The importer streams funder-graph grant rows through
 * `classifyRow`, groups them per funder with `FunderSegment`, and merges each
 * funder's filings into its stored aggregate with `mergeFunder`.
 *
 * funder-graph schema: https://github.com/egeria-corporation/funder-graph
 * (README, "Published schema"). Apache-2.0.
 */

/** The grant columns the importer reads; every other column is skipped. */
export const GRANT_COLUMNS = [
  "grant_id",
  "funder_ein",
  "funder_name",
  "funder_state",
  "funder_form_type",
  "object_id",
  "tax_year",
  "tax_period_end",
  "filing_submission_date",
  "amount_usd",
  "amount_type",
  "grant_purpose",
  "recipient_name_raw",
  "recipient_city",
  "recipient_state",
  "recipient_country",
  "recipient_ein_resolved",
  "match_confidence",
  "recipient_ntee_code",
  "recipient_type",
] as const;

export type GrantColumn = (typeof GRANT_COLUMNS)[number];
export type RawGrantRow = Partial<Record<GrantColumn, unknown>>;

export interface ImportOptions {
  /** funder-graph match confidence at or above which a resolved recipient EIN (and its NTEE code) is used. funder-graph's own default is 0.90. */
  minConfidence: number;
  /** Recent grants kept per funder (the largest in its latest RECENT_TAX_YEARS tax years). */
  recentPerFunder: number;
  /** Recipient states kept per funder; the rest are summed under "other". */
  statesPerFunder: number;
}

export const DEFAULT_OPTIONS: ImportOptions = { minConfidence: 0.9, recentPerFunder: 10, statesPerFunder: 25 };
export const RECENT_TAX_YEARS = 3;

/** Why a row was not counted. */
export type Exclusion = "individual" | "not_paid" | "no_amount" | "bad_row";

export interface CleanGrant {
  id: string;
  funderEin: string;
  funderName: string;
  funderState: string | null;
  formType: string;
  objectId: string;
  taxYear: number;
  taxPeriodEnd: string;
  submittedOn: string | null;
  amountUsd: number;
  purpose: string | null;
  recipientName: string;
  recipientCity: string | null;
  /** Two-letter state, "foreign", or null when not filed. */
  recipientState: string | null;
  /** Only when funder-graph's confidence meets the minimum. */
  recipientEin: string | null;
  matchConfidence: number | null;
  /** organization | government | unknown. Only organizations and governments are listed by name. */
  recipientType: string;
  category: string;
  categorySource: "ntee" | "purpose" | "none";
}

// ── Categories ─────────────────────────────────────────────────────────────

/** NTEE major groups (IRS / NCCS National Taxonomy of Exempt Entities). */
export const NTEE_GROUPS: Record<string, string> = {
  A: "Arts, culture and humanities",
  B: "Education",
  C: "Environment",
  D: "Animal-related",
  E: "Health care",
  F: "Mental health and crisis intervention",
  G: "Diseases, disorders and medical disciplines",
  H: "Medical research",
  I: "Crime and legal-related",
  J: "Employment",
  K: "Food, agriculture and nutrition",
  L: "Housing and shelter",
  M: "Public safety and disaster relief",
  N: "Recreation and sports",
  O: "Youth development",
  P: "Human services",
  Q: "International affairs",
  R: "Civil rights and advocacy",
  S: "Community improvement",
  T: "Philanthropy and grantmaking",
  U: "Science and technology",
  V: "Social science",
  W: "Public and societal benefit",
  X: "Religion-related",
  Y: "Mutual and membership benefit",
  Z: "Unknown",
};

export const UNCLASSIFIED = "unclassified";

/**
 * Words in a grant's purpose (or an organization's mission) that point to an
 * NTEE major group. Used only when no NTEE code is available at the minimum
 * confidence, and always reported as derived from the purpose text.
 */
const KEYWORDS: [string, RegExp][] = [
  ["F", /\b(mental health|suicide|crisis|counsel(?:ing|ling)|substance|addiction|behavioral health)\b/],
  ["H", /\b(medical research|clinical trials?|cancer research|biomedical)\b/],
  ["G", /\b(cancer|diabetes|alzheimer|autism|hiv|aids|disease|disorder)\b/],
  ["E", /\b(health|hospital|clinic|medical|patients?|nursing|dental)\b/],
  ["B", /\b(education|school|scholarships?|students?|universit(?:y|ies)|college|literacy|library|libraries|tuition|teachers?|stem)\b/],
  ["A", /\b(arts?|museum|music|theat(?:er|re)|cultur(?:e|al)|dance|opera|symphony|humanities|historical|history)\b/],
  ["C", /\b(environment(?:al)?|conservation|climate|wildlife habitat|land trust|parks?|watershed|forest|sustainab(?:le|ility))\b/],
  ["D", /\b(animals?|humane|veterinary|shelter for animals|wildlife)\b/],
  ["K", /\b(food|hunger|nutrition|farm(?:s|ing|ers)?|agricultur(?:e|al)|food bank|pantry)\b/],
  ["L", /\b(housing|homeless(?:ness)?|shelter|affordable homes?)\b/],
  ["M", /\b(disaster|relief|emergency|fire(?:fighters?)?|rescue)\b/],
  ["N", /\b(sports?|recreation|athletics?|camps?)\b/],
  ["O", /\b(youth|boys|girls|scouts?|mentor(?:ing)?|after[- ]school)\b/],
  ["I", /\b(legal aid|justice|courts?|prisons?|reentry|crime)\b/],
  ["J", /\b(employment|job training|workforce|vocational)\b/],
  ["Q", /\b(international|global|overseas|refugees?|humanitarian)\b/],
  ["R", /\b(civil rights|advocacy|voting|equality|equity)\b/],
  ["S", /\b(community development|economic development|neighborhood|community improvement|small business)\b/],
  ["U", /\b(science|technology|engineering|research)\b/],
  ["X", /\b(church|ministry|ministries|religious|faith|synagogue|mosque|parish|diocese)\b/],
  ["P", /\b(human services|families|seniors|elderly|children|social services|united way|ymca|ywca|charitable support)\b/],
];

/** NTEE major group letters found in free text, in table order. */
export function categoriesInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [letter, re] of KEYWORDS) if (re.test(lower) && !found.includes(letter)) found.push(letter);
  return found;
}

/** The category of one grant: the recipient's NTEE major group when trusted, else the first group its purpose points to. */
export function categoryOf(ntee: string | null, confident: boolean, purpose: string | null): { category: string; source: CleanGrant["categorySource"] } {
  const letter = ntee?.trim().charAt(0).toUpperCase();
  if (confident && letter && NTEE_GROUPS[letter] && letter !== "Z") return { category: letter, source: "ntee" };
  const fromPurpose = categoriesInText(purpose)[0];
  if (fromPurpose) return { category: fromPurpose, source: "purpose" };
  return { category: UNCLASSIFIED, source: "none" };
}

// ── Row parsing ────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A date column as YYYY-MM-DD: Parquet DATE arrives as a Date, CSV as text; a year-only value stays a year. */
export function isoDay(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d+$/.test(s)) {
    // Days since the epoch (an untyped Parquet DATE).
    const d = new Date(Number(s) * 86_400_000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

const EIN = /^\d{9}$/;

export function normalizeEin(v: unknown): string | null {
  const s = str(v)?.replace(/-/g, "");
  if (!s) return null;
  const padded = /^\d{1,9}$/.test(s) ? s.padStart(9, "0") : s;
  return EIN.test(padded) ? padded : null;
}

/**
 * Checks one funder-graph grant row. Individuals are excluded (they are not
 * the funding graph, and we never store named people), as are grants approved
 * for future payment (summing them with grants paid double-counts, per
 * funder-graph's own guidance) and rows without a positive amount.
 */
export function classifyRow(row: RawGrantRow, opts: ImportOptions = DEFAULT_OPTIONS): { ok: true; grant: CleanGrant } | { ok: false; reason: Exclusion } {
  const recipientType = (str(row.recipient_type) ?? "unknown").toLowerCase();
  if (recipientType === "individual") return { ok: false, reason: "individual" };
  if ((str(row.amount_type) ?? "").toLowerCase() !== "paid") return { ok: false, reason: "not_paid" };
  const amount = num(row.amount_usd);
  if (amount === null || amount <= 0) return { ok: false, reason: "no_amount" };
  const funderEin = normalizeEin(row.funder_ein);
  const objectId = str(row.object_id);
  const taxYear = num(row.tax_year);
  const funderName = str(row.funder_name);
  const recipientName = str(row.recipient_name_raw);
  if (!funderEin || !objectId || !taxYear || !funderName || !recipientName) return { ok: false, reason: "bad_row" };
  const confidence = num(row.match_confidence);
  const confident = confidence !== null && confidence >= opts.minConfidence;
  const purpose = str(row.grant_purpose)?.slice(0, 200) ?? null;
  const { category, source } = categoryOf(str(row.recipient_ntee_code), confident, purpose);
  const country = (str(row.recipient_country) ?? "US").toUpperCase();
  const state = str(row.recipient_state)?.toUpperCase() ?? null;
  return {
    ok: true,
    grant: {
      id: str(row.grant_id) ?? `${objectId}:${recipientName}:${amount}`,
      funderEin,
      funderName: funderName.slice(0, 300),
      funderState: str(row.funder_state)?.toUpperCase().slice(0, 2) ?? null,
      formType: (str(row.funder_form_type) ?? "990PF").toUpperCase(),
      objectId,
      taxYear: Math.trunc(taxYear),
      taxPeriodEnd: isoDay(row.tax_period_end) ?? String(Math.trunc(taxYear)),
      submittedOn: isoDay(row.filing_submission_date),
      amountUsd: Math.round(amount),
      purpose,
      recipientName: recipientName.slice(0, 300),
      recipientCity: str(row.recipient_city)?.slice(0, 120) ?? null,
      recipientState: country !== "US" ? "foreign" : state && /^[A-Z]{2}$/.test(state) ? state : null,
      recipientEin: confident ? normalizeEin(row.recipient_ein_resolved) : null,
      matchConfidence: confidence,
      recipientType,
      category,
      categorySource: source,
    },
  };
}

// ── Grant size distribution ────────────────────────────────────────────────

/** Ten histogram buckets per power of ten (each about 26% wide), so distributions from different years merge exactly. */
export const BUCKETS_PER_DECADE = 10;

export function sizeBucket(amount: number): number {
  return Math.floor(Math.log10(Math.max(1, amount)) * BUCKETS_PER_DECADE + 1e-9);
}

const bucketLow = (b: number) => 10 ** (b / BUCKETS_PER_DECADE);

/** Percentile estimated from the histogram, interpolated geometrically within its bucket and clamped to the observed range. */
export function percentile(hist: Record<string, number>, p: number, min: number, max: number): number {
  const entries = Object.entries(hist).map(([k, n]) => [Number(k), n] as const).sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return 0;
  const target = p * total;
  let seen = 0;
  for (const [bucket, n] of entries) {
    if (seen + n >= target) {
      const lo = Math.max(bucketLow(bucket), min);
      const hi = Math.min(bucketLow(bucket + 1), max);
      const frac = n ? Math.min(1, Math.max(0, (target - seen) / n)) : 0;
      const value = lo > 0 && hi > 0 ? lo * (hi / lo) ** frac : lo;
      return Math.round(Math.min(max, Math.max(min, value)));
    }
    seen += n;
  }
  return max;
}

export interface SizeStats {
  count: number;
  min: number;
  max: number;
  p25: number;
  median: number;
  p75: number;
}

export function sizeStats(hist: Record<string, number>, min: number, max: number): SizeStats {
  const count = Object.values(hist).reduce((s, n) => s + n, 0);
  if (!count) return { count: 0, min: 0, max: 0, p25: 0, median: 0, p75: 0 };
  return { count, min, max, p25: percentile(hist, 0.25, min, max), median: percentile(hist, 0.5, min, max), p75: percentile(hist, 0.75, min, max) };
}

// ── Per-funder aggregation ─────────────────────────────────────────────────

/** One filing's grants, aggregated. */
export interface FilingAggregate {
  objectId: string;
  taxYear: number;
  taxPeriodEnd: string;
  submittedOn: string | null;
  funderName: string;
  funderState: string | null;
  formType: string;
  total: number;
  count: number;
  byState: Map<string, number>;
  byCategory: Map<string, number>;
  categorySources: Map<string, number>;
  histogram: Map<number, number>;
  min: number;
  max: number;
  /** The largest grants to named organizations and governments, capped. */
  top: CleanGrant[];
}

function bump<K>(map: Map<K, number>, key: K, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function pushTop(top: CleanGrant[], grant: CleanGrant, cap: number): void {
  if (cap <= 0) return;
  if (top.length < cap) {
    top.push(grant);
    return;
  }
  let smallest = 0;
  for (let i = 1; i < top.length; i++) if (top[i].amountUsd < top[smallest].amountUsd) smallest = i;
  if (grant.amountUsd > top[smallest].amountUsd) top[smallest] = grant;
}

/** Collects one funder's grants (consecutive rows in a partition sorted by funder EIN), filing by filing. */
export class FunderSegment {
  readonly filings = new Map<string, FilingAggregate>();
  constructor(readonly ein: string, private readonly opts: ImportOptions = DEFAULT_OPTIONS) {}

  add(g: CleanGrant): void {
    let f = this.filings.get(g.objectId);
    if (!f) {
      f = {
        objectId: g.objectId, taxYear: g.taxYear, taxPeriodEnd: g.taxPeriodEnd, submittedOn: g.submittedOn, funderName: g.funderName, funderState: g.funderState, formType: g.formType,
        total: 0, count: 0, byState: new Map(), byCategory: new Map(), categorySources: new Map(), histogram: new Map(), min: Infinity, max: 0, top: [],
      };
      this.filings.set(g.objectId, f);
    }
    f.total += g.amountUsd;
    f.count += 1;
    bump(f.byState, g.recipientState ?? "unknown", g.amountUsd);
    bump(f.byCategory, g.category, g.amountUsd);
    bump(f.categorySources, g.categorySource, 1);
    bump(f.histogram, sizeBucket(g.amountUsd), 1);
    f.min = Math.min(f.min, g.amountUsd);
    f.max = Math.max(f.max, g.amountUsd);
    // Grants to recipients of unknown type are counted but never listed by name: they may be people.
    if (g.recipientType === "organization" || g.recipientType === "government") pushTop(f.top, g, this.opts.recentPerFunder);
  }

  /**
   * One filing per tax period: when a period has several (an amended return),
   * the latest submitted wins, then the latest object id.
   */
  chosen(): FilingAggregate[] {
    const byPeriod = new Map<string, FilingAggregate>();
    for (const f of this.filings.values()) {
      const current = byPeriod.get(f.taxPeriodEnd);
      if (!current || later(f, current)) byPeriod.set(f.taxPeriodEnd, f);
    }
    return [...byPeriod.values()];
  }
}

function later(a: FilingAggregate, b: FilingAggregate): boolean {
  const as = a.submittedOn ?? "", bs = b.submittedOn ?? "";
  return as !== bs ? as > bs : a.objectId > b.objectId;
}

/** What is stored for one funder. Mirrors the foundation_funders row. */
export interface FunderState {
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
  sizeHistogram: Record<string, number>;
  sizeStats: Record<string, number>;
  /** tax period end → object id of the filing counted for it. */
  filings: Record<string, string>;
  latestObjectId: string | null;
  latestTaxPeriodEnd: string | null;
  latestSubmittedOn: string | null;
}

/** A stored recent grant. Mirrors the foundation_grants row. */
export interface StoredGrant {
  id: string;
  funderEin: string;
  recipientName: string;
  recipientCity: string | null;
  recipientState: string | null;
  recipientEin: string | null;
  matchConfidence: number | null;
  amountUsd: number;
  taxYear: number;
  purpose: string | null;
  category: string | null;
  objectId: string;
}

export function toStoredGrant(g: CleanGrant): StoredGrant {
  return {
    id: g.id, funderEin: g.funderEin, recipientName: g.recipientName, recipientCity: g.recipientCity, recipientState: g.recipientState,
    recipientEin: g.recipientEin, matchConfidence: g.matchConfidence, amountUsd: g.amountUsd, taxYear: g.taxYear, purpose: g.purpose, category: g.category, objectId: g.objectId,
  };
}

function addInto(target: Record<string, number>, source: Map<string | number, number>): void {
  for (const [k, v] of source) target[String(k)] = (target[String(k)] ?? 0) + v;
}

/** Keeps the largest `cap` keys; the rest are summed under "other". */
export function capKeys(map: Record<string, number>, cap: number): Record<string, number> {
  const entries = Object.entries(map).filter(([k]) => k !== "other").sort((a, b) => b[1] - a[1]);
  if (entries.length <= cap) return map;
  const kept = Object.fromEntries(entries.slice(0, cap));
  const rest = entries.slice(cap).reduce((s, [, v]) => s + v, 0) + (map.other ?? 0);
  return rest ? { ...kept, other: rest } : kept;
}

export interface MergeResult {
  state: FunderState;
  recent: StoredGrant[];
  /** Filings skipped because their tax period was already counted from another filing (an amendment or a duplicate). */
  superseded: number;
  /** Filings skipped because this exact filing was already counted (a resumed or repeated import). */
  alreadyCounted: number;
  added: number;
}

export function emptyFunder(ein: string): FunderState {
  return {
    ein, name: "", state: null, formType: "990PF", totalPaidUsd: 0, grantCount: 0, firstTaxYear: null, lastTaxYear: null,
    givingByYear: {}, givingByState: {}, givingByCategory: {}, categorySources: {}, sizeHistogram: {}, sizeStats: {}, filings: {}, latestObjectId: null, latestTaxPeriodEnd: null, latestSubmittedOn: null,
  };
}

/**
 * Merges a funder's filings from one partition into what is stored. Each tax
 * period is counted from one filing only. Years are imported newest first, so
 * a period already counted came from a later or equal publication and an
 * older filing for it is skipped as superseded. A filing already counted is
 * skipped too, so a resumed or repeated import never counts it twice.
 */
export function mergeFunder(ein: string, existing: FunderState | null, existingRecent: StoredGrant[], filings: FilingAggregate[], opts: ImportOptions = DEFAULT_OPTIONS): MergeResult {
  const base = existing ?? emptyFunder(ein);
  const state: FunderState = {
    ...base,
    givingByYear: { ...base.givingByYear }, givingByState: { ...base.givingByState }, givingByCategory: { ...base.givingByCategory },
    categorySources: { ...base.categorySources }, sizeHistogram: { ...base.sizeHistogram }, filings: { ...base.filings },
  };
  let min = existing && existing.grantCount > 0 ? (existing.sizeStats.min ?? Infinity) : Infinity;
  let max = existing?.sizeStats.max ?? 0;
  let superseded = 0;
  let alreadyCounted = 0;
  let added = 0;
  const candidates = [...existingRecent];
  for (const f of filings) {
    const counted = state.filings[f.taxPeriodEnd];
    if (counted) {
      if (counted === f.objectId) alreadyCounted += 1;
      else superseded += 1;
      continue;
    }
    state.filings[f.taxPeriodEnd] = f.objectId;
    added += 1;
    state.totalPaidUsd += f.total;
    state.grantCount += f.count;
    state.givingByYear[String(f.taxYear)] = (state.givingByYear[String(f.taxYear)] ?? 0) + f.total;
    addInto(state.givingByState, f.byState);
    addInto(state.givingByCategory, f.byCategory);
    addInto(state.categorySources, f.categorySources);
    addInto(state.sizeHistogram, f.histogram);
    min = Math.min(min, f.min);
    max = Math.max(max, f.max);
    state.firstTaxYear = state.firstTaxYear === null ? f.taxYear : Math.min(state.firstTaxYear, f.taxYear);
    state.lastTaxYear = state.lastTaxYear === null ? f.taxYear : Math.max(state.lastTaxYear, f.taxYear);
    // Identity comes from the most recent filing counted.
    if (!state.latestTaxPeriodEnd || f.taxPeriodEnd > state.latestTaxPeriodEnd) {
      state.latestTaxPeriodEnd = f.taxPeriodEnd;
      state.latestObjectId = f.objectId;
      state.latestSubmittedOn = f.submittedOn;
      state.name = f.funderName;
      state.state = f.funderState;
      state.formType = f.formType;
    }
    candidates.push(...f.top.map(toStoredGrant));
  }
  state.givingByState = capKeys(state.givingByState, opts.statesPerFunder);
  state.sizeStats = { ...sizeStats(state.sizeHistogram, Number.isFinite(min) ? min : 0, max) };
  return { state, recent: recentGrants(candidates, opts.recentPerFunder), superseded, alreadyCounted, added };
}

/** The largest grants in the funder's latest RECENT_TAX_YEARS tax years with grants listed, largest first. */
export function recentGrants(candidates: StoredGrant[], cap: number): StoredGrant[] {
  const years = [...new Set(candidates.map((g) => g.taxYear))].sort((a, b) => b - a).slice(0, RECENT_TAX_YEARS);
  const unique = new Map<string, StoredGrant>();
  for (const g of candidates) if (years.includes(g.taxYear)) unique.set(g.id, g);
  return [...unique.values()].sort((a, b) => b.amountUsd - a.amountUsd || a.id.localeCompare(b.id)).slice(0, cap);
}

export type ExclusionCounts = Record<Exclusion | "kept" | "read", number>;

export function emptyCounts(): ExclusionCounts {
  return { read: 0, kept: 0, individual: 0, not_paid: 0, no_amount: 0, bad_row: 0 };
}
