/**
 * Publication gate for opportunities (ported from Veteran-Hub's
 * `src/lib/domain/publication-gate.ts` principle: no evidence, no publication).
 *
 * An opportunity reaches applicants only when it has an official https source,
 * a fetch time, an open status and, when posted, a closing date that has not
 * passed (or a source-stated rolling deadline). Anything missing is listed, so the record can be fixed or left hidden.
 */

export interface GateInput {
  title: string | null | undefined;
  officialUrl: string | null | undefined;
  fetchedAt: Date | string | null | undefined;
  status: string | null | undefined;
  closeDate: string | null | undefined;
  /** The source states applications are accepted on a rolling basis. */
  rollingDeadline?: boolean | null;
}

export interface GateResult {
  publishable: boolean;
  missing: string[];
}

const OPEN_STATUSES = new Set(["posted", "forecasted"]);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Today's date (UTC) as YYYY-MM-DD. Closing dates are compared conservatively in UTC. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function evaluateGate(input: GateInput, now: Date = new Date()): GateResult {
  const missing: string[] = [];
  if (!input.title?.trim()) missing.push("title");
  if (!input.officialUrl || !isHttpsUrl(input.officialUrl)) missing.push("official https source");
  if (!input.fetchedAt) missing.push("fetch time");
  const status = (input.status || "").toLowerCase();
  if (!OPEN_STATUSES.has(status)) missing.push("open status (posted or forecasted)");
  if (status === "posted") {
    if (!input.closeDate) {
      if (!input.rollingDeadline) missing.push("closing date");
    }
    else if (input.closeDate < todayIso(now)) missing.push("closing date not passed");
  }
  return { publishable: missing.length === 0, missing };
}

/** Whole days from today (UTC) to a YYYY-MM-DD date; negative when it has passed. */
export function daysUntil(date: string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${todayIso(now)}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}
