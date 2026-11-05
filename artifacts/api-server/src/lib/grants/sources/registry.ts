/**
 * The grant source registry as data (docs/SOURCE_REGISTRY.md,
 * GRANT_PLATFORM_PLAN.md §4): what a source row may contain, when it may run,
 * and when it is stale. Pure module: no database import, so the rules are
 * unit-tested on their own and shared by the routes, the jobs and the screen.
 */

export const JURISDICTION_KINDS = ["federal", "state", "foundation", "corporate"] as const;
export type JurisdictionKind = (typeof JURISDICTION_KINDS)[number];

/**
 * - `feed`: an official structured feed read by a connector in code (Grants.gov, California).
 * - `portal_page`: a state grants portal page that lists many opportunities.
 * - `watched_page`: one funder's open-call page (a foundation, a corporate program, a state agency).
 * Both page types are watched for change and extracted into drafts for review.
 */
export const CONNECTOR_TYPES = ["feed", "portal_page", "watched_page"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export const PAGE_CONNECTOR_TYPES: readonly ConnectorType[] = ["portal_page", "watched_page"];

export const SOURCE_STATUSES = ["active", "paused", "disabled"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Connectors that exist in code. A `feed` row must name one; new feeds need a release. */
export const FEED_CONNECTORS = ["grants_gov", "ca_grants_portal"] as const;

/** USPS codes for the 50 states, DC and the territories. */
export const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR", "GU", "VI", "AS", "MP",
] as const;

export const LIMITS = {
  name: 200,
  key: 64,
  owner: 200,
  termsNote: 2000,
  url: 2000,
  urls: 5,
  /** Pages are checked at most every 6 hours, to be a respectful reader. */
  minPageScheduleHours: 6,
  maxScheduleHours: 720,
  maxStaleDays: 90,
} as const;

export const DEFAULT_STALE_DAYS = 3;

export interface SourceInput {
  key: string;
  name: string;
  jurisdictionKind: JurisdictionKind;
  jurisdictionCode: string | null;
  connectorType: ConnectorType;
  connector: string | null;
  urls: string[];
  scheduleHours: number;
  owner: string | null;
  status: SourceStatus;
  termsNote: string | null;
  termsChecked: boolean;
  termsPermitAutomation: boolean;
  staleAfterDays: number | null;
}

export type ValidationResult = { ok: true; value: SourceInput } | { ok: false; errors: string[] };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function slugKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, LIMITS.key);
}

/** An https URL with a hostname, no credentials and no literal IP address. Returns a problem, or null. */
export function urlProblem(raw: string): string | null {
  if (raw.length > LIMITS.url) return `is longer than ${LIMITS.url} characters`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "is not a valid URL";
  }
  if (url.protocol !== "https:") return "must use https";
  if (url.username || url.password) return "must not contain a user name or password";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return "must use a host name, not an IP address";
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return "must be a public host name";
  return null;
}

/**
 * Validates a whole source row (a create, or an existing row merged with a
 * change). Every problem is listed. The rule the plan sets: a source whose
 * terms were not checked, or forbid automated reading, stays disabled.
 */
export function validateSource(raw: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const name = str(raw.name);
  if (!name) errors.push("Enter a name.");
  else if (name.length > LIMITS.name) errors.push(`The name must be at most ${LIMITS.name} characters.`);

  const key = str(raw.key) ?? (name ? slugKey(name) : null);
  if (!key || !/^[a-z0-9][a-z0-9_:-]{1,63}$/.test(key)) errors.push("The key must be 2 to 64 lowercase letters, digits, _, : or -.");

  const jurisdictionKind = (JURISDICTION_KINDS as readonly string[]).includes(raw.jurisdictionKind as string) ? (raw.jurisdictionKind as JurisdictionKind) : null;
  if (!jurisdictionKind) errors.push(`The jurisdiction must be one of: ${JURISDICTION_KINDS.join(", ")}.`);
  let jurisdictionCode = str(raw.jurisdictionCode)?.toUpperCase() ?? null;
  if (jurisdictionKind === "state") {
    if (!jurisdictionCode || !(STATE_CODES as readonly string[]).includes(jurisdictionCode)) errors.push("A state source needs its two-letter state code (for example IL).");
  } else jurisdictionCode = null;

  const connectorType = (CONNECTOR_TYPES as readonly string[]).includes(raw.connectorType as string) ? (raw.connectorType as ConnectorType) : null;
  if (!connectorType) errors.push(`The connector type must be one of: ${CONNECTOR_TYPES.join(", ")}.`);
  let connector = str(raw.connector);
  if (connectorType === "feed") {
    if (!connector || !(FEED_CONNECTORS as readonly string[]).includes(connector)) errors.push(`A feed needs a connector in code (${FEED_CONNECTORS.join(", ")}); a new feed type needs a release.`);
  } else connector = null;

  const rawUrls = Array.isArray(raw.urls) ? raw.urls : typeof raw.urls === "string" ? raw.urls.split(/\s+/) : [];
  const urls = [...new Set(rawUrls.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))];
  if (urls.length === 0) errors.push("Add the source's URL.");
  if (urls.length > LIMITS.urls) errors.push(`Add at most ${LIMITS.urls} URLs.`);
  urls.forEach((u, i) => {
    const problem = urlProblem(u);
    if (problem) errors.push(`URL ${i + 1} ${problem}.`);
  });

  const isPage = connectorType !== null && PAGE_CONNECTOR_TYPES.includes(connectorType);
  const scheduleHours = raw.scheduleHours === undefined || raw.scheduleHours === null || raw.scheduleHours === "" ? 24 : Number(raw.scheduleHours);
  const minHours = isPage ? LIMITS.minPageScheduleHours : 1;
  if (!Number.isInteger(scheduleHours) || scheduleHours < minHours || scheduleHours > LIMITS.maxScheduleHours) {
    errors.push(`The schedule must be a whole number of hours from ${minHours} to ${LIMITS.maxScheduleHours}.`);
  }

  const owner = str(raw.owner);
  if (owner && owner.length > LIMITS.owner) errors.push(`The owner must be at most ${LIMITS.owner} characters.`);

  const termsNote = str(raw.termsNote);
  if (termsNote && termsNote.length > LIMITS.termsNote) errors.push(`The terms note must be at most ${LIMITS.termsNote} characters.`);
  const termsChecked = raw.termsChecked === true;
  const termsPermitAutomation = termsChecked && raw.termsPermitAutomation === true;
  if (termsChecked && !termsNote) errors.push("Record what the terms of use say (and where) when marking them checked.");
  if (raw.termsPermitAutomation === true && !termsChecked) errors.push("Check the terms of use before recording that they permit automated reading.");

  const status = raw.status === undefined ? "disabled" : (SOURCE_STATUSES as readonly string[]).includes(raw.status as string) ? (raw.status as SourceStatus) : null;
  if (!status) errors.push(`The status must be one of: ${SOURCE_STATUSES.join(", ")}.`);
  if (status === "active" && !termsChecked) errors.push("A source stays disabled until its terms of use are checked.");
  else if (status === "active" && !termsPermitAutomation) errors.push("A source whose terms do not permit automated reading stays disabled.");

  let staleAfterDays: number | null = null;
  if (raw.staleAfterDays !== undefined && raw.staleAfterDays !== null && raw.staleAfterDays !== "") {
    staleAfterDays = Number(raw.staleAfterDays);
    if (!Number.isInteger(staleAfterDays) || staleAfterDays < 1 || staleAfterDays > LIMITS.maxStaleDays) {
      errors.push(`Stale after must be a whole number of days from 1 to ${LIMITS.maxStaleDays}.`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      key: key!,
      name: name!,
      jurisdictionKind: jurisdictionKind!,
      jurisdictionCode,
      connectorType: connectorType!,
      connector,
      urls,
      scheduleHours,
      owner,
      status: status!,
      termsNote,
      termsChecked,
      termsPermitAutomation,
      staleAfterDays,
    },
  };
}

/** The source may be read automatically right now. */
export function mayRun(source: { status: string; termsChecked: boolean; termsPermitAutomation: boolean }): boolean {
  return source.status === "active" && source.termsChecked && source.termsPermitAutomation;
}

export function isPageSource(source: { connectorType: string }): boolean {
  return (PAGE_CONNECTOR_TYPES as readonly string[]).includes(source.connectorType);
}

/** A page source is due when it was never checked, or its schedule has passed since the last check. */
export function isDue(source: { scheduleHours: number; lastCheckedAt: Date | null }, now: Date = new Date()): boolean {
  if (!source.lastCheckedAt) return true;
  return now.getTime() - source.lastCheckedAt.getTime() >= source.scheduleHours * 3_600_000;
}

export type FreshnessState = "fresh" | "stale" | "never" | "not_running";

export interface Freshness {
  state: FreshnessState;
  lastSuccessAt: Date | null;
  staleAfterDays: number;
  /** Whole days since the last successful check. */
  ageDays: number | null;
  label: string;
}

/** The days a source may go without a successful check; SOURCE_STALE_DAYS overrides the default. */
export function defaultStaleDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SOURCE_STALE_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= LIMITS.maxStaleDays ? n : DEFAULT_STALE_DAYS;
}

/**
 * Freshness from the last successful check. A running source with no success
 * within its stale window is stale (shown on the admin screen); a source that
 * is not running is reported as such, never as fresh.
 */
export function freshness(
  source: { status: string; termsChecked: boolean; termsPermitAutomation: boolean; staleAfterDays: number | null; lastSuccessAt: Date | null },
  now: Date = new Date(),
  fallbackDays: number = defaultStaleDays(),
): Freshness {
  const staleAfterDays = source.staleAfterDays ?? fallbackDays;
  const last = source.lastSuccessAt;
  const ageDays = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
  if (!mayRun(source)) return { state: "not_running", lastSuccessAt: last, staleAfterDays, ageDays, label: source.status === "active" ? "Not running: terms not checked" : `Not running (${source.status})` };
  if (!last) return { state: "never", lastSuccessAt: null, staleAfterDays, ageDays: null, label: "Never checked successfully" };
  if (now.getTime() - last.getTime() > staleAfterDays * 86_400_000) return { state: "stale", lastSuccessAt: last, staleAfterDays, ageDays, label: `Stale: no successful check for ${ageDays} day${ageDays === 1 ? "" : "s"}` };
  return { state: "fresh", lastSuccessAt: last, staleAfterDays, ageDays, label: "Fresh" };
}
