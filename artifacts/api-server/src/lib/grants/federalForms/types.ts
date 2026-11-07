/** The federal forms Grant Studio fills for a Grants.gov application (docs/GRANT_STUDIO.md, Federal forms). */
export type FederalFormKey = "sf424" | "sf424a" | "sf424b" | "sflll";

export const FEDERAL_FORM_KEYS: readonly FederalFormKey[] = ["sf424", "sf424a", "sf424b", "sflll"];

export function isFederalFormKey(value: unknown): value is FederalFormKey {
  return typeof value === "string" && (FEDERAL_FORM_KEYS as readonly string[]).includes(value);
}

/** One form, as extracted from HHS/simpler-grants-gov by scripts/extract-federal-forms.py. */
export interface FederalFormDefinition {
  key: string;
  formName: string;
  shortFormName: string;
  formVersion: string;
  ombNumber: string | null;
  expirationDate: string | null;
  legacyFormId: number | null;
  simplerFormId: string;
  sourcePath: string;
  /** JSON Schema (draft 2020-12), with the shared schemas inlined. */
  jsonSchema: Record<string, any>;
  /** Sections and field order, as Simpler Grants lays the form out. */
  uiSchema: any[];
  /** Pre- and post-population rules (for example "Grants.gov fills this on submission"). */
  ruleSchema: Record<string, any>;
}

/**
 * Who supplies a field's value:
 * - `person`: someone in the workspace enters or confirms it (it may be prefilled).
 * - `computed`: a total Grant Studio adds up from other fields.
 * - `record`: copied from Grant Studio's record (the opportunity or the organization) and shown read only.
 * - `grants_gov`: filled by Grants.gov on submission (signature, date received, date signed).
 * - `attachment`: a file attached in Grants.gov Workspace.
 */
export type FieldEntry = "person" | "computed" | "record" | "grants_gov" | "attachment";

export type FieldControl = "text" | "textarea" | "select" | "multiselect" | "checkbox" | "yesno" | "date" | "money" | "email";

export interface FormField {
  /** Dot path into the form's data, for example `applicant.zip_code` or `activity_line_items.0.activity_title`. */
  id: string;
  section: string;
  label: string;
  description: string | null;
  control: FieldControl;
  /** The JSON type the value is stored as. */
  valueType: "string" | "integer" | "boolean" | "array";
  entry: FieldEntry;
  options?: string[];
  maxLength?: number;
  maxItems?: number;
  /** Required whenever the form is filled in (conditional requirements show up as validation errors). */
  required: boolean;
}

export interface PrefillValue {
  value: unknown;
  /** Where it came from, in plain words, for example "Organization profile" or "Budget". */
  source: string;
}
