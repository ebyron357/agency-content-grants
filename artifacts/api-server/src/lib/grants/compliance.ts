import { READINESS_KINDS, readinessKindsFor, type ApplicantType, type ReadinessKind } from "./eligibility";
import { checkLimit } from "./text";
import type { BudgetSummary } from "./budget";
import { placeholders, type FormatCheck } from "./writing";

/**
 * Package compliance: every check that must pass before the authorized
 * representative can approve and export the final package. Each failing check
 * says what to fix. A draft export is always possible and is marked as a draft.
 */

export interface ComplianceInput {
  applicantType: ApplicantType;
  eligibilityConfirmed: boolean;
  closeDate: string | null;
  /** False for state programs: federal-only readiness items are not required. */
  federal?: boolean;
  requirements: { label: string; status: string; confirmed: boolean }[];
  sections: { title: string; content: string; limitType: string | null; limitValue: number | null; status: string; demoContent: boolean }[];
  budget: BudgetSummary;
  readiness: { kind: string; status: string; expiresOn: string | null }[];
  packageApproved: boolean;
  /** Words per page from the format profile, for page limits. Defaults to 500. */
  wordsPerPage?: number;
  /** The format check, when the application has a format profile. */
  format?: FormatCheck;
  /** Letters of support being tracked for this application. */
  letters?: { name: string; organization: string | null; status: string }[];
}

export interface ComplianceCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ComplianceReport {
  checks: ComplianceCheck[];
  /** True when everything except the final authorized-representative approval passes. */
  readyForApproval: boolean;
  /** True when the package can be exported as final. */
  readyToExport: boolean;
}

function list(items: string[], max = 4): string {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; and ${items.length - max} more` : shown;
}

export function evaluateCompliance(input: ComplianceInput): ComplianceReport {
  const checks: ComplianceCheck[] = [];

  checks.push({
    id: "eligibility",
    label: "Eligibility confirmed against the notice",
    ok: input.eligibilityConfirmed,
    detail: input.eligibilityConfirmed ? "Confirmed by the applicant." : "Confirm eligibility on the Requirements step.",
  });

  const unconfirmed = input.requirements.filter((r) => !r.confirmed).map((r) => r.label);
  checks.push({
    id: "matrix_confirmed",
    label: "Compliance matrix confirmed",
    ok: input.requirements.length > 0 && unconfirmed.length === 0,
    detail: input.requirements.length === 0 ? "Add the notice's requirements." : unconfirmed.length ? `Confirm: ${list(unconfirmed)}.` : "Every requirement is confirmed.",
  });

  const open = input.requirements.filter((r) => r.status === "open").map((r) => r.label);
  checks.push({
    id: "matrix_covered",
    label: "Every requirement covered",
    ok: input.requirements.length > 0 && open.length === 0,
    detail: open.length ? `Still open: ${list(open)}.` : "No open requirements.",
  });

  const empty = input.sections.filter((s) => !checkLimit(s.content, null, null).words).map((s) => s.title);
  checks.push({
    id: "sections_written",
    label: "Every section written",
    ok: empty.length === 0,
    detail: empty.length ? `Write: ${list(empty)}.` : "All sections have content.",
  });

  const over = input.sections
    .map((s) => ({ s, check: checkLimit(s.content, s.limitType, s.limitValue, input.wordsPerPage) }))
    .filter(({ check }) => check.over)
    .map(({ s, check }) => `${s.title} (${check.used} of ${check.limit} ${check.unit})`);
  checks.push({
    id: "limits",
    label: "Every section within its limit",
    ok: over.length === 0,
    detail: over.length ? `Over the limit: ${list(over)}.` : "All sections are within their limits.",
  });

  const demo = input.sections.filter((s) => s.demoContent).map((s) => s.title);
  checks.push({
    id: "no_demo",
    label: "No demo scaffold text left",
    ok: demo.length === 0,
    detail: demo.length ? `Replace the demo scaffold in: ${list(demo)}.` : "No demo text.",
  });

  const unfilled = input.sections.filter((s) => !s.demoContent && placeholders(s.content).length > 0).map((s) => s.title);
  checks.push({
    id: "no_placeholders",
    label: "No placeholders left to fill",
    ok: unfilled.length === 0,
    detail: unfilled.length ? `Fill the [Add: …] or TBD markers in: ${list(unfilled)}.` : "No placeholders.",
  });

  if (input.format) {
    const f = input.format;
    const blockingName = f.fileNameIssues.filter((i) => i.blocking);
    const problems = [
      f.over ? `About ${f.estimatedPages} pages against a ${f.pageLimit}-page limit at ${f.profile.font} ${f.profile.sizePt} pt, ${f.profile.lineSpacing}-spaced` : null,
      ...blockingName.map((i) => `File name: ${i.message}`),
    ].filter((p): p is string => Boolean(p));
    checks.push({
      id: "format",
      label: "Fits the notice's format and page limit",
      ok: problems.length === 0,
      detail: problems.length ? `${list(problems)}.` : f.pageLimit ? `About ${f.estimatedPages} of ${f.pageLimit} pages (an estimate; check the exported file).` : "No overall page limit recorded.",
    });
  }

  if (input.letters && input.letters.length > 0) {
    const outstanding = input.letters.filter((l) => l.status === "to_request" || l.status === "requested").map((l) => (l.organization ? `${l.name} (${l.organization})` : l.name));
    checks.push({
      id: "letters",
      label: "Letters of support received",
      ok: outstanding.length === 0,
      detail: outstanding.length ? `Still waiting for: ${list(outstanding)}. Mark a letter Declined if it will not come.` : "Every tracked letter is received or closed.",
    });
  }

  const unapproved = input.sections.filter((s) => s.status !== "approved").map((s) => s.title);
  checks.push({
    id: "sections_approved",
    label: "Every section approved by a reviewer",
    ok: unapproved.length === 0,
    detail: unapproved.length ? `Awaiting review: ${list(unapproved)}.` : "All sections approved.",
  });

  checks.push({
    id: "budget",
    label: "Budget complete and within the award ceiling",
    ok: input.budget.issues.length === 0,
    detail: input.budget.issues.length ? list(input.budget.issues) : `Request: $${input.budget.requested.toLocaleString("en-US")}.`,
  });

  const byKind = new Map(input.readiness.map((r) => [r.kind, r]));
  const notReady: string[] = [];
  for (const kind of readinessKindsFor(input.applicantType)) {
    const spec = READINESS_KINDS[kind as ReadinessKind];
    if (!spec.blocking) continue;
    if (spec.federal && input.federal === false) continue;
    const item = byKind.get(kind);
    if (!item || item.status !== "ready") notReady.push(spec.label);
    else if (item.expiresOn && input.closeDate && item.expiresOn < input.closeDate) notReady.push(`${spec.label} (expires before the closing date)`);
  }
  checks.push({
    id: "readiness",
    label: "Registrations and required documents ready",
    ok: notReady.length === 0,
    detail: notReady.length ? `Not ready: ${list(notReady)}.` : "All blocking readiness items are ready.",
  });

  const readyForApproval = checks.every((c) => c.ok);
  checks.push({
    id: "package_approval",
    label: "Final package approved by the authorized representative",
    ok: input.packageApproved,
    detail: input.packageApproved ? "Approved." : readyForApproval ? "Ready for the authorized representative's approval." : "Available once every check above passes.",
  });

  return { checks, readyForApproval, readyToExport: readyForApproval && input.packageApproved };
}
