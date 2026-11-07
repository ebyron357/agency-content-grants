import { createHash } from "crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import type { BudgetSummary } from "../budget";
import type { BudgetCategory } from "../eligibility";
import { FEDERAL_FORM_DEFINITIONS, SOURCE_COMMIT } from "./definitions";
import { SF424A_TOTALS, formFields, schemaAt } from "./fields";
import { FEDERAL_FORM_KEYS, type FederalFormKey, type FormField, type PrefillValue } from "./types";

/**
 * Federal forms (SF-424, SF-424A, SF-424B, SF-LLL): prefill from what Grant
 * Studio already knows, merge what a person entered, add up the totals, and
 * validate against the form's JSON Schema from Simpler Grants. Nothing here is
 * sent to Grants.gov; the forms go into the package a person submits.
 *
 * A value a person entered always wins over a prefilled one. Prefilled values
 * are recomputed on every read, so a budget change reaches SF-424A unless the
 * person typed their own figure.
 */

export const FORM_SOURCE = {
  repository: "https://github.com/HHS/simpler-grants-gov",
  commit: SOURCE_COMMIT,
  path: "api/src/form_schema/forms/",
  license: "US government work, public domain in the United States; CC0 1.0 waiver worldwide",
};

export interface FormsContext {
  applicant: { name: string; applicantType: string; ein: string | null; uei: string | null; state: string | null };
  opportunity: { title: string; number: string | null; agency: string | null; assistanceListings: string[] };
  application: { title: string };
  budget: BudgetSummary;
  hasBudgetLines: boolean;
}

export interface StoredForm {
  formKey: string;
  values: Record<string, unknown>;
  notApplicable: boolean;
  notApplicableReason: string | null;
  notApplicableBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewedHash: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export type FormStatus = "not_started" | "in_progress" | "ready_to_review" | "complete" | "not_applicable";

export interface FieldView extends FormField {
  value: unknown;
  /** `entered`, `prefill`, `computed`, or null when empty. */
  origin: "entered" | "prefill" | "computed" | null;
  /** For a prefilled value: where it came from. */
  source: string | null;
  errors: string[];
}

export interface FormView {
  key: FederalFormKey;
  formName: string;
  shortFormName: string;
  formVersion: string;
  ombNumber: string | null;
  expirationDate: string | null;
  /** Only SF-LLL can be marked not applicable: it is needed only when the organization pays someone to lobby. */
  canBeNotApplicable: boolean;
  status: FormStatus;
  notApplicable: boolean;
  notApplicableReason: string | null;
  notApplicableBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  /** True when the last review covered exactly the values the form holds now. */
  reviewCurrent: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
  errorCount: number;
  /** Errors that are not tied to one field. */
  formErrors: string[];
  /** Attachments the form asks for, added in Grants.gov Workspace. */
  attachmentNotes: string[];
  counts: { toComplete: number; prefilled: number; entered: number };
  sections: { title: string; fields: FieldView[] }[];
  /** The filled data in Simpler Grants' JSON shape (what the schema validates). */
  data: Record<string, unknown>;
  dataHash: string;
}

// ── Values ────────────────────────────────────────────────────────────────

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function parseMoney(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim() || !/^(-)?\d*([.]\d{2})?$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

function setPath(target: Record<string, any>, id: string, value: unknown): void {
  const parts = id.split(".");
  let node: any = target;
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    const key: string | number = /^\d+$/.test(part) ? Number(part) : part;
    if (last) {
      node[key] = value;
      return;
    }
    if (node[key] === undefined) node[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    node = node[key];
  });
}

function getPath(source: Record<string, any>, id: string): unknown {
  return id.split(".").reduce<any>((acc, part) => (acc == null ? undefined : acc[/^\d+$/.test(part) ? Number(part) : part]), source);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashData(data: unknown): string {
  return createHash("sha256").update(stableStringify(data)).digest("hex");
}

/** "CA" → "CA: California", using the form's own list of states. */
function stateOption(key: FederalFormKey, fieldId: string, state: string | null): string | null {
  if (!state) return null;
  const options = schemaAt(FEDERAL_FORM_DEFINITIONS[key], fieldId)?.enum;
  if (!Array.isArray(options)) return null;
  const code = state.trim().toUpperCase();
  return (options.find((o: unknown) => typeof o === "string" && o.startsWith(`${code}:`)) as string | undefined) ?? null;
}

const APPLICANT_TYPE_CODES: Record<string, string> = {
  nonprofit_501c3: "M: Nonprofit with 501C3 IRS Status (Other than Institution of Higher Education)",
  nonprofit_other: "N: Nonprofit without 501C3 IRS Status (Other than Institution of Higher Education)",
  small_business: "R: Small Business",
  for_profit: "Q: For-Profit Organization (Other than Small Business)",
};

const CATEGORY_TO_SF424A: Record<BudgetCategory, string> = {
  personnel: "personnel_amount",
  fringe: "fringe_benefits_amount",
  travel: "travel_amount",
  equipment: "equipment_amount",
  supplies: "supplies_amount",
  contractual: "contractual_amount",
  construction: "construction_amount",
  other: "other_amount",
};

// ── Prefill ───────────────────────────────────────────────────────────────

/**
 * What Grant Studio can fill from its own records. Only facts it holds are
 * used: nothing is guessed (for example, state and local funding are left for a
 * person, because the budget does not record them).
 */
export function prefillFor(key: FederalFormKey, ctx: FormsContext, sf424: Record<string, unknown> = {}): Record<string, PrefillValue> {
  const out: Record<string, PrefillValue> = {};
  const put = (id: string, value: unknown, source: string) => {
    if (!isEmpty(value)) out[id] = { value, source };
  };
  const listing = ctx.opportunity.assistanceListings[0] ?? null;
  if (key === "sf424") {
    put("organization_name", ctx.applicant.name, "Organization profile");
    put("employer_taxpayer_identification_number", ctx.applicant.ein, "Organization profile");
    put("sam_uei", ctx.applicant.uei, "Organization profile");
    const state = stateOption("sf424", "applicant.state", ctx.applicant.state);
    put("applicant.state", state, "Organization profile");
    if (state) put("applicant.country", "USA: UNITED STATES", "Organization profile (a US state is recorded)");
    const typeCode = APPLICANT_TYPE_CODES[ctx.applicant.applicantType];
    if (typeCode) put("applicant_type_code", [typeCode], "Organization type");
    put("agency_name", ctx.opportunity.agency, "Opportunity record");
    put("assistance_listing_number", listing, "Opportunity record");
    put("funding_opportunity_number", ctx.opportunity.number, "Opportunity record");
    put("funding_opportunity_title", ctx.opportunity.title, "Opportunity record");
    put("project_title", ctx.application.title, "Application title");
    if (ctx.hasBudgetLines) {
      put("federal_estimated_funding", money(ctx.budget.requested), "Budget: amount requested");
      put("applicant_estimated_funding", money(ctx.budget.match), "Budget: cost share or match");
    }
  } else if (key === "sf424a") {
    const line = "activity_line_items.0";
    put(`${line}.assistance_listing_number`, listing, "Opportunity record");
    if (ctx.hasBudgetLines) {
      put(`${line}.budget_summary.federal_new_or_revised_amount`, money(ctx.budget.requested), "Budget: amount requested");
      put(`${line}.budget_summary.non_federal_new_or_revised_amount`, money(ctx.budget.match), "Budget: cost share or match");
      for (const c of ctx.budget.categories) put(`${line}.budget_categories.${CATEGORY_TO_SF424A[c.category]}`, money(c.total), `Budget: ${c.label}`);
      put(`${line}.budget_categories.total_indirect_charge_amount`, money(ctx.budget.indirect), `Budget: indirect at ${ctx.budget.indirectRatePercent}%`);
      put(`${line}.non_federal_resources.applicant_amount`, money(ctx.budget.match), "Budget: cost share or match");
    }
  } else if (key === "sf424b") {
    put("title", sf424.authorized_representative_title, "SF-424, item 21");
    put("applicant_organization", sf424.organization_name, "SF-424, item 8a");
  } else if (key === "sflll") {
    const base = "reporting_entity.applicant_reporting_entity";
    put(`${base}.organization_name`, ctx.applicant.name, "Organization profile");
    put(`${base}.address.state`, stateOption("sflll", `${base}.address.state`, ctx.applicant.state), "Organization profile");
    put("federal_agency_department", ctx.opportunity.agency?.slice(0, 40), "Opportunity record");
    put("assistance_listing_number", listing, "Opportunity record");
  }
  return out;
}

// ── Totals ────────────────────────────────────────────────────────────────

function sumInto(data: Record<string, any>, target: string, parts: string[], requireAll = false): void {
  const values = parts.map((p) => getPath(data, p));
  const present = values.filter((v) => !isEmpty(v));
  if (!present.length || (requireAll && present.length < parts.length)) return;
  const nums = present.map(parseMoney);
  if (nums.some((n) => n === null)) return;
  setPath(data, target, money((nums as number[]).reduce((a, b) => a + b, 0)));
}

/** Adds up the totals the form computes (Simpler Grants' `sum_monetary` rules). */
export function computeTotals(key: FederalFormKey, data: Record<string, any>): void {
  if (key === "sf424") {
    sumInto(data, "total_estimated_funding", ["federal", "applicant", "state", "local", "other", "program_income"].map((p) => `${p}_estimated_funding`), true);
    return;
  }
  if (key !== "sf424a") return;
  const line = "activity_line_items.0";
  sumInto(data, `${line}.budget_summary.total_amount`, ["federal_estimated_unobligated_amount", "non_federal_estimated_unobligated_amount", "federal_new_or_revised_amount", "non_federal_new_or_revised_amount"].map((p) => `${line}.budget_summary.${p}`));
  sumInto(data, `${line}.budget_categories.total_direct_charge_amount`, Object.values(CATEGORY_TO_SF424A).map((p) => `${line}.budget_categories.${p}`));
  sumInto(data, `${line}.budget_categories.total_amount`, ["total_direct_charge_amount", "total_indirect_charge_amount"].map((p) => `${line}.budget_categories.${p}`));
  sumInto(data, `${line}.non_federal_resources.total_amount`, ["applicant_amount", "state_amount", "other_amount"].map((p) => `${line}.non_federal_resources.${p}`));
  const quarters = ["first_quarter_amount", "second_quarter_amount", "third_quarter_amount", "fourth_quarter_amount"];
  for (const side of ["federal_forecasted_cash_needs", "non_federal_forecasted_cash_needs"]) sumInto(data, `forecasted_cash_needs.${side}.total_amount`, quarters.map((q) => `forecasted_cash_needs.${side}.${q}`));
  for (const q of [...quarters, "total_amount"]) sumInto(data, `forecasted_cash_needs.total_forecasted_cash_needs.${q}`, ["federal_forecasted_cash_needs", "non_federal_forecasted_cash_needs"].map((s) => `forecasted_cash_needs.${s}.${q}`));
  // With one activity line, each total row equals the line (amounts only; the program name is not totalled).
  for (const [total, from] of SF424A_TOTALS) {
    const source = getPath(data, from);
    if (!source || typeof source !== "object") continue;
    for (const [k, v] of Object.entries(source as Record<string, unknown>)) if (k !== "grant_program" && parseMoney(v) !== null) setPath(data, `${total}.${k}`, v);
  }
}

// ── Validation ────────────────────────────────────────────────────────────

const validators = new Map<FederalFormKey, ValidateFunction>();

function validatorFor(key: FederalFormKey): ValidateFunction {
  const hit = validators.get(key);
  if (hit) return hit;
  const AjvClass = ((Ajv2020 as any).default ?? Ajv2020) as typeof Ajv2020;
  const formats = ((addFormats as any).default ?? addFormats) as typeof addFormats;
  const ajv = new AjvClass({ allErrors: true, strict: false });
  formats(ajv, ["date", "email", "uuid"]);
  const fn = ajv.compile(FEDERAL_FORM_DEFINITIONS[key].jsonSchema);
  validators.set(key, fn);
  return fn;
}

function messageFor(key: FederalFormKey, err: ErrorObject, field: FormField | undefined): string | null {
  const p = err.params as Record<string, any>;
  switch (err.keyword) {
    case "required":
      return "Required.";
    case "minLength":
      return p.limit <= 1 ? "Required." : `Enter at least ${p.limit} characters.`;
    case "maxLength":
      return `Use at most ${p.limit} characters.`;
    case "pattern":
      return field?.control === "money" ? "Enter an amount in dollars and cents, such as 1250.00." : "Check the format (see the field's help).";
    case "format":
      return p.format === "date" ? "Enter a date." : p.format === "email" ? "Enter an email address." : "Check the format.";
    case "enum":
    case "const":
      return field?.control === "checkbox" ? "Check this box to confirm." : "Choose one of the options.";
    case "minItems":
      return `Choose at least ${p.limit}.`;
    case "maxItems":
      return `Choose at most ${p.limit}.`;
    case "minimum":
    case "maximum": {
      const schema = field ? schemaAt(FEDERAL_FORM_DEFINITIONS[key], field.id) : null;
      return schema && typeof schema.minimum === "number" && typeof schema.maximum === "number" ? `Enter a number from ${schema.minimum} to ${schema.maximum}.` : "Enter a number in the allowed range.";
    }
    case "type":
      return "Enter a valid value.";
    case "if":
    case "allOf":
    case "anyOf":
    case "prefixItems":
      return null; // The specific error (for example a required field) is reported on its own.
    default:
      return err.message ? `${err.message[0].toUpperCase()}${err.message.slice(1)}.` : "Check this value.";
  }
}

export interface ValidationResult {
  byField: Map<string, string[]>;
  formErrors: string[];
  attachmentNotes: string[];
}

export function validateForm(key: FederalFormKey, data: Record<string, unknown>): ValidationResult {
  const fields = formFields(key);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const validate = validatorFor(key);
  validate(data);
  const byField = new Map<string, string[]>();
  const formErrors: string[] = [];
  const attachmentNotes: string[] = [];
  const add = (id: string, message: string) => {
    const field = byId.get(id);
    if (field?.entry === "grants_gov") return;
    if (field?.entry === "attachment") {
      const note = `${field.label}: attach this file in Grants.gov Workspace when you submit.`;
      if (!attachmentNotes.includes(note)) attachmentNotes.push(note);
      return;
    }
    const list = byField.get(id) ?? [];
    if (!list.includes(message)) list.push(message);
    byField.set(id, list);
  };
  for (const err of validate.errors ?? []) {
    const base = err.instancePath.split("/").filter(Boolean).join(".");
    const id = err.keyword === "required" ? [base, (err.params as any).missingProperty].filter(Boolean).join(".") : base;
    const field = byId.get(id);
    const message = messageFor(key, err, field);
    if (!message) continue;
    if (field) {
      add(id, message);
      continue;
    }
    // A whole object is missing (for example no address yet): report it on the fields it needs.
    const children = fields.filter((f) => f.id.startsWith(`${id}.`) && f.required);
    if (children.length) children.forEach((c) => add(c.id, "Required."));
    else if (!formErrors.includes(`${id || "Form"}: ${message}`)) formErrors.push(`${id || "Form"}: ${message}`);
  }
  return { byField, formErrors, attachmentNotes };
}

// ── View ──────────────────────────────────────────────────────────────────

/** Accepts only values of the field's type; anything else is refused before it reaches the store. */
export function coerceValue(field: FormField, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, value: null };
  switch (field.valueType) {
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false, error: `${field.label}: choose yes or no.` };
    case "integer": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, error: `${field.label}: enter a whole number.` };
    }
    case "array":
      return Array.isArray(raw) && raw.every((v) => typeof v === "string" && v.length <= 300) && raw.length <= 20
        ? { ok: true, value: [...new Set(raw as string[])] }
        : { ok: false, error: `${field.label}: choose from the list.` };
    default:
      if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: `${field.label}: enter text.` };
      return String(raw).length > 4000 ? { ok: false, error: `${field.label} is too long.` } : { ok: true, value: String(raw).trim() };
  }
}

export function entryFields(key: FederalFormKey): Map<string, FormField> {
  return new Map(formFields(key).filter((f) => f.entry === "person").map((f) => [f.id, f]));
}

export function buildFormView(key: FederalFormKey, stored: StoredForm | undefined, prefill: Record<string, PrefillValue>): FormView {
  const def = FEDERAL_FORM_DEFINITIONS[key];
  const fields = formFields(key);
  const entered = (stored?.values ?? {}) as Record<string, unknown>;
  const data: Record<string, any> = {};
  const origin = new Map<string, FieldView["origin"]>();
  for (const f of fields) {
    if (f.entry === "grants_gov" || f.entry === "attachment" || f.entry === "computed") continue;
    if (f.entry === "person" && Object.prototype.hasOwnProperty.call(entered, f.id)) {
      if (!isEmpty(entered[f.id])) {
        setPath(data, f.id, entered[f.id]);
        origin.set(f.id, "entered");
      }
    } else if (prefill[f.id]) {
      setPath(data, f.id, prefill[f.id].value);
      origin.set(f.id, "prefill");
    }
  }
  computeTotals(key, data);
  for (const f of fields) if (f.entry === "computed" && !isEmpty(getPath(data, f.id))) origin.set(f.id, "computed");
  const { byField, formErrors, attachmentNotes } = validateForm(key, data);
  const dataHash = hashData(data);
  const notApplicable = key === "sflll" && Boolean(stored?.notApplicable);
  const errorCount = notApplicable ? 0 : [...byField.values()].reduce((n, l) => n + l.length, 0) + formErrors.length;
  const reviewCurrent = Boolean(stored?.reviewedHash && stored.reviewedHash === dataHash);
  const views: FieldView[] = fields.map((f) => ({
    ...f,
    value: f.entry === "grants_gov" || f.entry === "attachment" ? null : getPath(data, f.id) ?? null,
    origin: origin.get(f.id) ?? null,
    source: origin.get(f.id) === "prefill" ? prefill[f.id]?.source ?? null : null,
    errors: notApplicable ? [] : byField.get(f.id) ?? [],
  }));
  const sections: FormView["sections"] = [];
  for (const v of views) {
    const last = sections[sections.length - 1];
    if (last && last.title === v.section) last.fields.push(v);
    else sections.push({ title: v.section, fields: [v] });
  }
  const anyEntered = Object.values(entered).some((v) => !isEmpty(v));
  const status: FormStatus = notApplicable
    ? "not_applicable"
    : errorCount === 0
      ? reviewCurrent
        ? "complete"
        : "ready_to_review"
      : anyEntered
        ? "in_progress"
        : "not_started";
  return {
    key,
    formName: def.formName,
    shortFormName: def.shortFormName,
    formVersion: def.formVersion,
    ombNumber: def.ombNumber,
    expirationDate: def.expirationDate,
    canBeNotApplicable: key === "sflll",
    status,
    notApplicable,
    notApplicableReason: notApplicable ? stored?.notApplicableReason ?? null : null,
    notApplicableBy: notApplicable ? stored?.notApplicableBy ?? null : null,
    reviewedBy: stored?.reviewedBy ?? null,
    reviewedAt: stored?.reviewedAt ?? null,
    reviewCurrent,
    updatedBy: stored?.updatedBy ?? null,
    updatedAt: stored?.updatedAt ?? null,
    errorCount,
    formErrors: notApplicable ? [] : formErrors,
    attachmentNotes: notApplicable ? [] : attachmentNotes,
    counts: {
      toComplete: views.filter((v) => v.errors.length > 0).length,
      prefilled: views.filter((v) => v.origin === "prefill").length,
      entered: views.filter((v) => v.origin === "entered").length,
    },
    sections,
    data,
    dataHash,
  };
}

/** Every federal form for an application, SF-424 first so SF-424B can copy from it. */
export function buildFormViews(ctx: FormsContext, stored: StoredForm[]): FormView[] {
  const byKey = new Map(stored.map((s) => [s.formKey, s]));
  const views: FormView[] = [];
  const sf424 = buildFormView("sf424", byKey.get("sf424"), prefillFor("sf424", ctx));
  views.push(sf424);
  for (const key of FEDERAL_FORM_KEYS.filter((k) => k !== "sf424")) views.push(buildFormView(key, byKey.get(key), prefillFor(key, ctx, sf424.data)));
  return views;
}

export const FORM_SHORT_LABELS: Record<FederalFormKey, string> = { sf424: "SF-424", sf424a: "SF-424A", sf424b: "SF-424B", sflll: "SF-LLL" };

/** The package check: every form complete (validated and reviewed), or SF-LLL marked not applicable. */
export function formsCheck(views: FormView[]): { ok: boolean; detail: string } {
  const open = views.filter((v) => v.status !== "complete" && v.status !== "not_applicable");
  if (!open.length) return { ok: true, detail: `${views.map((v) => FORM_SHORT_LABELS[v.key]).join(", ")} complete or marked not applicable.` };
  const parts = open.map((v) => {
    const label = FORM_SHORT_LABELS[v.key];
    if (v.status === "ready_to_review") return `${label}: review and mark it complete`;
    if (v.key === "sflll" && v.status === "not_started") return `${label}: complete it, or mark it not applicable if no one is paid to lobby for this award`;
    return `${label}: ${v.counts.toComplete} field${v.counts.toComplete === 1 ? "" : "s"} to complete`;
  });
  return { ok: false, detail: `${parts.join("; ")}.` };
}
