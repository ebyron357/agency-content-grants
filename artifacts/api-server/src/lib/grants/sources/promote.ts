import { evaluateGate, type GateResult } from "../gate";
import { EXTRACTOR_VERSION, eligibilityCodesFor, isoDate } from "./extraction";
import { urlProblem } from "./registry";

/**
 * From a reviewed draft to an opportunity record (docs/SOURCE_REGISTRY.md).
 * Pure module. A draft becomes an opportunity only when a person approves it
 * and the record passes the publication gate (lib/grants/gate.ts); demo
 * drafts are never approvable.
 */

export interface DraftForPromotion {
  fingerprint: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  rollingDeadline: boolean;
  opportunityStatus: string;
  amountMin: number | null;
  amountMax: number | null;
  eligibilitySummary: string | null;
  applicantKinds: string[];
  officialUrl: string | null;
  sourceUrl: string;
  checkedAt: Date;
  demo: boolean;
}

export interface SourceForPromotion {
  key: string;
  name: string;
  jurisdictionKind: string;
  jurisdictionCode: string | null;
}

/** `grant_opportunities.source` for opportunities that came from a page source. */
export const pageSourceKey = (key: string) => `page:${key}`;

export function opportunityFromDraft(draft: DraftForPromotion, source: SourceForPromotion) {
  return {
    source: pageSourceKey(source.key),
    sourceRef: draft.fingerprint,
    number: null,
    title: draft.title,
    agency: draft.funder ?? source.name,
    agencyCode: null,
    status: draft.opportunityStatus === "forecasted" ? "forecasted" : "posted",
    openDate: null,
    closeDate: draft.deadline,
    rollingDeadline: draft.rollingDeadline && !draft.deadline,
    awardFloor: draft.amountMin,
    awardCeiling: draft.amountMax,
    estimatedFunding: null,
    costSharing: null,
    costSharePercent: null,
    // State programs carry their state, as the California connector does; federal-style null otherwise.
    jurisdiction: source.jurisdictionKind === "state" ? source.jurisdictionCode : null,
    eligibilityCodes: eligibilityCodesFor(draft.applicantKinds),
    eligibilityText: draft.eligibilitySummary,
    categories: [],
    assistanceListings: [],
    description: `From ${source.name}'s page ${draft.sourceUrl}, read ${draft.checkedAt.toISOString().slice(0, 10)} and reviewed by a person.${draft.eligibilitySummary ? ` Eligibility: ${draft.eligibilitySummary}` : ""}`,
    officialUrl: draft.officialUrl ?? "",
    fetchedAt: draft.checkedAt,
    detailFetchedAt: draft.checkedAt,
    checksum: draft.fingerprint,
    connectorVersion: EXTRACTOR_VERSION,
  };
}

export interface ApprovalCheck {
  ok: boolean;
  problems: string[];
  gate: GateResult;
}

/** What stops a draft from being approved: demo output, and anything the publication gate is missing. */
export function approvalCheck(draft: DraftForPromotion, source: SourceForPromotion, now: Date = new Date()): ApprovalCheck {
  const problems: string[] = [];
  if (draft.demo) problems.push("Demo output cannot be approved: it was made without an AI provider and contains nothing from the page.");
  if (draft.deadline && !isoDate(draft.deadline)) problems.push("The deadline must be a date (YYYY-MM-DD).");
  const opp = opportunityFromDraft(draft, source);
  const gate = evaluateGate({ title: opp.title, officialUrl: opp.officialUrl || null, fetchedAt: opp.fetchedAt, status: opp.status, closeDate: opp.closeDate, rollingDeadline: opp.rollingDeadline }, now);
  for (const m of gate.missing) problems.push(`The publication gate needs: ${m}.`);
  return { ok: problems.length === 0, problems, gate };
}

export interface DraftEdit {
  title?: unknown;
  funder?: unknown;
  deadline?: unknown;
  rollingDeadline?: unknown;
  opportunityStatus?: unknown;
  amountMin?: unknown;
  amountMax?: unknown;
  eligibilitySummary?: unknown;
  applicantKinds?: unknown;
  officialUrl?: unknown;
}

/** Validates a reviewer's edit to a pending draft. Returns the fields to store, or the problems. */
export function validateDraftEdit(edit: DraftEdit): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: Record<string, unknown> = {};
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : v === null ? null : undefined);
  if (edit.title !== undefined) {
    const t = text(edit.title, 300);
    if (!t) errors.push("Enter a title.");
    else value.title = t;
  }
  if (edit.funder !== undefined) value.funder = text(edit.funder, 200) ?? null;
  if (edit.eligibilitySummary !== undefined) value.eligibilitySummary = text(edit.eligibilitySummary, 1500) ?? null;
  if (edit.deadline !== undefined) {
    if (edit.deadline === null || edit.deadline === "") value.deadline = null;
    else if (!isoDate(edit.deadline)) errors.push("The deadline must be a date (YYYY-MM-DD).");
    else value.deadline = edit.deadline;
  }
  if (edit.rollingDeadline !== undefined) value.rollingDeadline = edit.rollingDeadline === true;
  if (edit.opportunityStatus !== undefined) {
    if (edit.opportunityStatus !== "posted" && edit.opportunityStatus !== "forecasted") errors.push("The status must be posted or forecasted.");
    else value.opportunityStatus = edit.opportunityStatus;
  }
  for (const k of ["amountMin", "amountMax"] as const) {
    if (edit[k] === undefined) continue;
    if (edit[k] === null || edit[k] === "") value[k] = null;
    else {
      const n = Number(edit[k]);
      if (!Number.isFinite(n) || n <= 0 || n >= 1e12) errors.push(`${k === "amountMin" ? "The minimum" : "The maximum"} amount must be a positive number of dollars.`);
      else value[k] = n;
    }
  }
  if (typeof value.amountMin === "number" && typeof value.amountMax === "number" && value.amountMin > value.amountMax) errors.push("The minimum amount is larger than the maximum.");
  if (edit.applicantKinds !== undefined) {
    const kinds = Array.isArray(edit.applicantKinds) ? edit.applicantKinds : [];
    if (kinds.some((k) => k !== "nonprofit" && k !== "business")) errors.push("Who may apply must be nonprofit, business or both.");
    else value.applicantKinds = [...new Set(kinds)];
  }
  if (edit.officialUrl !== undefined) {
    if (edit.officialUrl === null || edit.officialUrl === "") value.officialUrl = null;
    else if (typeof edit.officialUrl !== "string" || urlProblem(edit.officialUrl.trim())) errors.push(`The official URL ${typeof edit.officialUrl === "string" ? urlProblem(edit.officialUrl.trim()) : "is not valid"}.`);
    else value.officialUrl = edit.officialUrl.trim();
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
