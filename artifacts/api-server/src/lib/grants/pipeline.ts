/**
 * Application outcomes and the pipeline summary. An outcome is a person's
 * record of what happened after the package left Grant Studio: they submitted
 * it (Grant Studio never submits), and later the funder awarded or declined
 * it, or they withdrew it. Pure functions; the routes enforce ownership.
 */

export const OUTCOMES = ["submitted", "awarded", "declined", "withdrawn"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}

export interface OutcomeState {
  status: string;
  outcome: string | null;
}

/**
 * Whether an outcome may be recorded from the current state. A submission
 * needs the final package (exported); a decision or withdrawal needs a
 * recorded submission first. Re-recording the same outcome (to correct a date
 * or amount) is allowed.
 */
export function outcomeTransitionError(current: OutcomeState, next: Outcome): string | null {
  if (next === "submitted") {
    if (current.status !== "exported" && current.outcome === null) return "Download the final package before recording a submission.";
    if (current.outcome && current.outcome !== "submitted") return "A decision is already recorded. Clear it first to change it.";
    return null;
  }
  if (current.outcome === null) return "Record the submission first.";
  return null;
}

export interface PipelineRow {
  status: string;
  outcome: string | null;
  requested: number | null;
  awardedAmount: number | null;
  daysLeft: number | null;
}

export interface PipelineSummary {
  inProgress: number;
  dueWithin30Days: number;
  awaitingDecision: number;
  awarded: number;
  declined: number;
  withdrawn: number;
  requestedSubmitted: number;
  awardedTotal: number;
  /** Awarded divided by decided (awarded plus declined); null until something is decided. */
  winRate: number | null;
}

export function summarizePipeline(rows: PipelineRow[]): PipelineSummary {
  const s: PipelineSummary = { inProgress: 0, dueWithin30Days: 0, awaitingDecision: 0, awarded: 0, declined: 0, withdrawn: 0, requestedSubmitted: 0, awardedTotal: 0, winRate: null };
  for (const r of rows) {
    if (!r.outcome) {
      s.inProgress++;
      if (r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30) s.dueWithin30Days++;
      continue;
    }
    if (r.outcome !== "withdrawn") s.requestedSubmitted += r.requested ?? 0;
    if (r.outcome === "submitted") s.awaitingDecision++;
    else if (r.outcome === "awarded") {
      s.awarded++;
      s.awardedTotal += r.awardedAmount ?? 0;
    } else if (r.outcome === "declined") s.declined++;
    else if (r.outcome === "withdrawn") s.withdrawn++;
  }
  const decided = s.awarded + s.declined;
  s.winRate = decided > 0 ? Math.round((s.awarded / decided) * 100) / 100 : null;
  return s;
}
