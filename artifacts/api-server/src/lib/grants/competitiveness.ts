/**
 * Competitiveness rating (docs/GRANT_STUDIO.md, Competitiveness rating).
 *
 * A 0–100 rating of how ready an application is to compete: how well the
 * opportunity fits, how reviewers scored the sections (weighted by the
 * notice's criterion points), how complete the package is, and readiness and
 * time. Every point traces to a stated component.
 *
 * It is NOT a probability of approval. No published data gives applicant
 * counts or funder decisions for these opportunities, so no probability can be
 * stated honestly. Instead the rating is frozen when a submission is recorded,
 * and calibration() reports the organization's real award rate for each band
 * once enough decisions are recorded. That is the measured likelihood.
 *
 * Pure module: no database access, so it is unit tested directly.
 */

export const RATING_BANDS = {
  strong: { label: "Strong", min: 80, hint: "Complete, well reviewed and a close fit." },
  competitive: { label: "Competitive", min: 60, hint: "Solid, with a few gaps that cost points." },
  needs_work: { label: "Needs work", min: 40, hint: "Several components are weak or missing." },
  not_ready: { label: "Not ready", min: 0, hint: "Much of the application is not done or not reviewed yet." },
} as const;
export type RatingBand = keyof typeof RATING_BANDS | "not_eligible";
export const BAND_ORDER = ["strong", "competitive", "needs_work", "not_ready"] as const;

/** Fewest decided applications in a band before its award rate is shown. */
export const MIN_DECISIONS_FOR_RATE = 5;

export const COMPONENT_MAX = { fit: 25, review: 35, completeness: 25, readinessTime: 15 } as const;

export interface RatingInput {
  /** The organization's match against the opportunity; null if it could not be computed. */
  match: { eligible: boolean; score: number; exclusions: string[] } | null;
  sections: { key: string; title: string; status: string; reviewScore: number | null; demoContent: boolean }[];
  requirements: { kind: string; sectionKey: string | null; points: number | null }[];
  checks: { id: string; ok: boolean; label: string }[];
  daysLeft: number | null;
  rollingDeadline: boolean;
  forecast: boolean;
  estimatedFunding: number | null;
  awardCeiling: number | null;
  /** The organization's own recorded decisions. */
  history: { awarded: number; declined: number };
}

export interface RatingComponent {
  key: keyof typeof COMPONENT_MAX;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface CompetitivenessRating {
  score: number;
  band: RatingBand;
  bandLabel: string;
  components: RatingComponent[];
  /** What would raise the rating most, in order. */
  actions: string[];
  /** Context shown beside the rating; not part of the score. */
  context: string[];
  disclaimer: string;
}

export const RATING_DISCLAIMER =
  "A rating of how ready this application is to compete, not a probability of approval. Funders decide, and no published data gives their applicant counts. Once you record enough decisions, Grant Studio shows your real award rate for each rating band.";

function bandFor(score: number): keyof typeof RATING_BANDS {
  return BAND_ORDER.find((b) => score >= RATING_BANDS[b].min) ?? "not_ready";
}

/** Weight of each section: the points of the criteria mapped to it, or 1 when the notice gives no points. */
function sectionWeights(input: RatingInput): Map<string, number> {
  const weights = new Map<string, number>();
  for (const r of input.requirements) {
    if (!r.sectionKey || !r.points || r.points <= 0) continue;
    if (r.kind !== "criterion" && r.kind !== "section") continue;
    weights.set(r.sectionKey, (weights.get(r.sectionKey) ?? 0) + r.points);
  }
  const anyPoints = weights.size > 0;
  const out = new Map<string, number>();
  for (const s of input.sections) out.set(s.key, anyPoints ? weights.get(s.key) ?? 0 : 1);
  // Points mapped only to keys with no section are ignored; if nothing is left, weigh sections equally.
  if ([...out.values()].every((w) => w === 0)) for (const s of input.sections) out.set(s.key, 1);
  return out;
}

export function rateCompetitiveness(input: RatingInput): CompetitivenessRating {
  const components: RatingComponent[] = [];
  const gains: { gain: number; text: string }[] = [];

  // ── Fit (25) ─────────────────────────────────────────────────────────────
  const fitPoints = input.match ? Math.round((Math.max(0, Math.min(100, input.match.score)) / 100) * COMPONENT_MAX.fit) : 0;
  components.push({
    key: "fit",
    label: "Fit with the opportunity",
    points: fitPoints,
    max: COMPONENT_MAX.fit,
    detail: input.match ? `Match score ${input.match.score} of 100, from the stated match reasons.` : "No match score: complete the organization's profile.",
  });
  if (fitPoints < COMPONENT_MAX.fit - 5) gains.push({ gain: COMPONENT_MAX.fit - fitPoints, text: "Close the gaps listed on the opportunity's match (readiness, cost share, focus areas)." });

  // ── Review strength (35), weighted by criterion points ─────────────────
  const weights = sectionWeights(input);
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  let weighted = 0;
  const unscored: { title: string; weight: number }[] = [];
  const weak: { title: string; weight: number; score: number }[] = [];
  for (const s of input.sections) {
    const w = weights.get(s.key) ?? 0;
    const score = s.demoContent || s.reviewScore == null ? null : Math.max(0, Math.min(100, s.reviewScore));
    if (score === null) {
      if (w > 0) unscored.push({ title: s.title, weight: w });
      continue;
    }
    weighted += w * score;
    if (score < 70 && w > 0) weak.push({ title: s.title, weight: w, score });
  }
  const reviewAvg = weighted / totalWeight;
  const reviewPoints = Math.round((reviewAvg / 100) * COMPONENT_MAX.review);
  const pointsBased = input.requirements.some((r) => r.sectionKey && (r.points ?? 0) > 0);
  components.push({
    key: "review",
    label: "Reviewer scores",
    points: reviewPoints,
    max: COMPONENT_MAX.review,
    detail: `${input.sections.length - unscored.length} of ${input.sections.length} sections scored; weighted ${pointsBased ? "by the notice's criterion points" : "equally (no criterion points recorded)"}. Unscored sections count as 0.`,
  });
  unscored.sort((a, b) => b.weight - a.weight);
  if (unscored.length) {
    const top = unscored.slice(0, 3).map((u) => (pointsBased ? `${u.title} (${u.weight} points)` : u.title));
    gains.push({ gain: Math.round((unscored.reduce((a, u) => a + u.weight, 0) / totalWeight) * COMPONENT_MAX.review * 0.75), text: `Run Review on ${top.join(", ")}${unscored.length > 3 ? ` and ${unscored.length - 3} more` : ""}.` });
  }
  weak.sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score));
  for (const w of weak.slice(0, 2)) {
    gains.push({ gain: Math.round(((w.weight * (85 - w.score)) / 100 / totalWeight) * COMPONENT_MAX.review), text: `Strengthen ${w.title} (reviewer score ${w.score}) using its review notes.` });
  }
  if (!pointsBased && input.sections.length > 1) gains.push({ gain: 1, text: "Record the notice's review criteria with their points on the Requirements step, so the rating weighs sections as reviewers will." });

  // ── Completeness (25) ───────────────────────────────────────────────────
  const counted = input.checks.filter((c) => c.id !== "package_approval" && c.id !== "readiness");
  const passed = counted.filter((c) => c.ok).length;
  const completenessPoints = counted.length ? Math.round((passed / counted.length) * COMPONENT_MAX.completeness) : 0;
  components.push({
    key: "completeness",
    label: "Package completeness",
    points: completenessPoints,
    max: COMPONENT_MAX.completeness,
    detail: `${passed} of ${counted.length} package checks pass.`,
  });
  const failing = counted.filter((c) => !c.ok);
  if (failing.length) gains.push({ gain: Math.round((failing.length / Math.max(1, counted.length)) * COMPONENT_MAX.completeness), text: `Fix the failing package checks: ${failing.slice(0, 3).map((c) => c.label.toLowerCase()).join("; ")}${failing.length > 3 ? "; and more" : ""}.` });

  // ── Readiness and time (15) ─────────────────────────────────────────────
  const readinessOk = input.checks.find((c) => c.id === "readiness")?.ok ?? false;
  let timePoints = 0;
  let timeText: string;
  if (input.daysLeft === null) {
    timePoints = input.rollingDeadline || input.forecast ? 7 : 0;
    timeText = input.rollingDeadline ? "rolling deadline (earlier is better)" : input.forecast ? "forecast, not yet open" : "no closing date recorded";
  } else if (input.daysLeft >= 30) {
    timePoints = 7;
    timeText = `${input.daysLeft} days left`;
  } else if (input.daysLeft >= 14) {
    timePoints = 4;
    timeText = `${input.daysLeft} days left`;
  } else if (input.daysLeft >= 0) {
    timePoints = 1;
    timeText = `only ${input.daysLeft} day${input.daysLeft === 1 ? "" : "s"} left`;
  } else timeText = "the closing date has passed";
  const readinessTime = (readinessOk ? 8 : 0) + timePoints;
  components.push({
    key: "readinessTime",
    label: "Registrations and time",
    points: readinessTime,
    max: COMPONENT_MAX.readinessTime,
    detail: `${readinessOk ? "Registrations and required documents ready" : "Registrations or required documents not ready"}; ${timeText}.`,
  });
  if (!readinessOk) gains.push({ gain: 8, text: "Get the registrations and required documents ready on the organization's Readiness tab (SAM.gov can take weeks)." });

  const score = Math.max(0, Math.min(100, components.reduce((a, c) => a + c.points, 0)));
  const eligible = input.match ? input.match.eligible : true;
  const band: RatingBand = eligible ? bandFor(score) : "not_eligible";
  const actions = eligible
    ? gains.sort((a, b) => b.gain - a.gain).map((g) => g.text).slice(0, 5)
    : [`As recorded, the organization is excluded: ${input.match!.exclusions.join(" ")} Check the notice; if the record is wrong, fix the profile.`];

  // ── Context (not scored) ────────────────────────────────────────────────
  const context: string[] = [];
  if (input.estimatedFunding && input.awardCeiling && input.awardCeiling > 0) {
    const n = Math.floor(input.estimatedFunding / input.awardCeiling);
    if (n >= 1) context.push(`The notice estimates $${Math.round(input.estimatedFunding).toLocaleString("en-US")} in total: about ${n} award${n === 1 ? "" : "s"} at the $${Math.round(input.awardCeiling).toLocaleString("en-US")} ceiling, more if awards are smaller. The number of applicants is not published.`);
  } else {
    context.push("The record does not give total funding and an award ceiling, so the number of awards cannot be estimated. Check the notice.");
  }
  const decided = input.history.awarded + input.history.declined;
  context.push(
    decided === 0
      ? "No decisions recorded for this organization yet."
      : decided < MIN_DECISIONS_FOR_RATE
        ? `This organization has ${input.history.awarded} award${input.history.awarded === 1 ? "" : "s"} in ${decided} recorded decision${decided === 1 ? "" : "s"}: too few to judge a rate.`
        : `This organization's recorded award rate: ${Math.round((input.history.awarded / decided) * 100)}% (${input.history.awarded} of ${decided} decisions).`,
  );

  return {
    score,
    band,
    bandLabel: band === "not_eligible" ? "Not eligible as recorded" : RATING_BANDS[band].label,
    components,
    actions,
    context,
    disclaimer: RATING_DISCLAIMER,
  };
}

export interface CalibrationRow {
  band: RatingBand | null;
  outcome: string | null;
}

export interface CalibrationBand {
  band: keyof typeof RATING_BANDS;
  label: string;
  awarded: number;
  declined: number;
  pending: number;
  /** Awarded divided by decided; null until MIN_DECISIONS_FOR_RATE decisions are recorded in the band. */
  awardRate: number | null;
}

/** Real award rates by the rating band frozen at submission. */
export function calibration(rows: CalibrationRow[]): { bands: CalibrationBand[]; decided: number; minDecisions: number } {
  const bands: CalibrationBand[] = BAND_ORDER.map((band) => ({ band, label: RATING_BANDS[band].label, awarded: 0, declined: 0, pending: 0, awardRate: null }));
  let decided = 0;
  for (const r of rows) {
    const entry = bands.find((b) => b.band === r.band);
    if (!entry) continue;
    if (r.outcome === "awarded") entry.awarded++;
    else if (r.outcome === "declined") entry.declined++;
    else if (r.outcome === "submitted") entry.pending++;
  }
  for (const b of bands) {
    const n = b.awarded + b.declined;
    decided += n;
    b.awardRate = n >= MIN_DECISIONS_FOR_RATE ? Math.round((b.awarded / n) * 100) / 100 : null;
  }
  return { bands, decided, minDecisions: MIN_DECISIONS_FOR_RATE };
}
