import { FEDERAL_FORM_DEFINITIONS } from "./definitions";
import type { FederalFormDefinition, FederalFormKey, FieldControl, FieldEntry, FormField } from "./types";

/**
 * The fields of each federal form, in the order Simpler Grants lays them out,
 * with who supplies each one. SF-424, SF-424B and SF-LLL are read from the
 * form's own layout. SF-424A's layout is a set of budget tables, so its fields
 * are listed here for one activity line (the common case); an application with
 * more program functions adds the others in Grants.gov Workspace.
 */

type Schema = Record<string, any>;

const MONEY_PATTERN = "^(-)?\\d*([.]\\d{2})?$";

/** Resolves a local `#/$defs/x` reference and folds `allOf` parts into one node (conditionals are left to the validator). */
export function flatten(node: Schema | undefined, root: Schema): Schema {
  if (!node) return {};
  let out: Schema = { ...node };
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    const target = node.$ref
      .slice(2)
      .split("/")
      .reduce((acc: any, part: string) => acc?.[part], root);
    const { $ref: _ref, ...rest } = node;
    out = { ...flatten(target, root), ...rest };
  }
  if (Array.isArray(out.allOf)) {
    const parts = out.allOf.filter((p: Schema) => !p.if).map((p: Schema) => flatten(p, root));
    const { allOf: _allOf, ...rest } = out;
    out = parts.reduce<Schema>(
      (acc, part) => ({
        ...part,
        ...acc,
        properties: { ...(part.properties ?? {}), ...(acc.properties ?? {}) },
        required: [...new Set([...(part.required ?? []), ...(acc.required ?? [])])],
      }),
      rest,
    );
    if (!Object.keys(out.properties ?? {}).length) delete out.properties;
    if (!out.required?.length) delete out.required;
  }
  return out;
}

/** The schema node at a field path (`a.b.0.c`), or null when the path is not in the form. */
export function schemaAt(def: FederalFormDefinition, id: string): Schema | null {
  const root = def.jsonSchema;
  let node: Schema | null = flatten(root, root);
  for (const part of id.split(".")) {
    if (!node) return null;
    if (/^\d+$/.test(part)) node = node.items ? flatten(node.items, root) : null;
    else node = node.properties?.[part] ? flatten(node.properties[part], root) : null;
  }
  return node;
}

/** True when every step of the path is in its parent's `required` list. */
function staticallyRequired(def: FederalFormDefinition, id: string): boolean {
  const root = def.jsonSchema;
  let node: Schema = flatten(root, root);
  for (const part of id.split(".")) {
    if (/^\d+$/.test(part)) {
      if ((node.minItems ?? 0) <= Number(part)) return false;
      node = flatten(node.items, root);
      continue;
    }
    if (!(node.required ?? []).includes(part)) return false;
    node = flatten(node.properties?.[part], root);
  }
  return true;
}

function ruleAt(def: FederalFormDefinition, id: string): Schema | null {
  let node: any = def.ruleSchema;
  for (const part of id.split(".").filter((p) => !/^\d+$/.test(p))) {
    node = node?.[part];
    if (!node) return null;
  }
  return node;
}

function controlFor(schema: Schema, widget?: string): FieldControl {
  if (schema.type === "boolean") return widget === "Radio" ? "yesno" : "checkbox";
  if (schema.type === "array" && schema.items?.enum) return "multiselect";
  if (schema.type === "integer") return "text";
  if (Array.isArray(schema.enum)) return "select";
  if (schema.format === "date") return "date";
  if (schema.format === "email") return "email";
  if (schema.pattern === MONEY_PATTERN) return "money";
  if ((schema.maxLength ?? 0) >= 250) return "textarea";
  return "text";
}

function entryFor(def: FederalFormDefinition, id: string, uiType: string, widget?: string): FieldEntry {
  if (widget === "Attachment" || widget === "AttachmentArray") return "attachment";
  const rule = ruleAt(def, id);
  if (rule?.gg_post_population) return "grants_gov";
  if (rule?.gg_pre_population?.rule === "sum_monetary") return "computed";
  if (uiType === "null") return rule?.gg_pre_population ? "record" : "grants_gov";
  return "person";
}

function field(def: FederalFormDefinition, id: string, section: string, opts: { label?: string; entry?: FieldEntry; uiType?: string; widget?: string } = {}): FormField {
  const schema = schemaAt(def, id);
  if (!schema) throw new Error(`${def.shortFormName}: ${id} is not in the form`);
  const control = controlFor(schema, opts.widget);
  return {
    id,
    section,
    label: opts.label ?? schema.title ?? id,
    description: typeof schema.description === "string" && schema.description ? schema.description : null,
    control,
    valueType: schema.type === "integer" || schema.type === "boolean" || schema.type === "array" ? schema.type : "string",
    entry: opts.entry ?? entryFor(def, id, opts.uiType ?? "field", opts.widget),
    ...(Array.isArray(schema.enum) ? { options: schema.enum.map(String) } : {}),
    ...(schema.items?.enum ? { options: schema.items.enum.map(String) } : {}),
    ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
    ...(typeof schema.maxItems === "number" ? { maxItems: schema.maxItems } : {}),
    required: staticallyRequired(def, id),
  };
}

function fromLayout(def: FederalFormDefinition): FormField[] {
  const out: FormField[] = [];
  const walk = (nodes: any[], section: string) => {
    for (const node of nodes) {
      if (node.type === "section") walk(node.children ?? [], node.label ?? section);
      else if ((node.type === "field" || node.type === "null") && typeof node.definition === "string") {
        const id = node.definition.replace(/^\/properties\//, "").split("/properties/").join(".");
        out.push(field(def, id, section, { uiType: node.type, widget: node.widget }));
      }
    }
  };
  walk(def.uiSchema, def.formName);
  return out;
}

const LINE = "activity_line_items.0";
const CATEGORY_FIELDS: [string, string][] = [
  ["personnel_amount", "a. Personnel"],
  ["fringe_benefits_amount", "b. Fringe benefits"],
  ["travel_amount", "c. Travel"],
  ["equipment_amount", "d. Equipment"],
  ["supplies_amount", "e. Supplies"],
  ["contractual_amount", "f. Contractual"],
  ["construction_amount", "g. Construction"],
  ["other_amount", "h. Other"],
];
const QUARTERS: [string, string][] = [
  ["first_quarter_amount", "1st quarter"],
  ["second_quarter_amount", "2nd quarter"],
  ["third_quarter_amount", "3rd quarter"],
  ["fourth_quarter_amount", "4th quarter"],
];

function sf424aFields(def: FederalFormDefinition): FormField[] {
  const a = "Section A: Budget summary";
  const b = "Section B: Budget categories";
  const c = "Section C: Non-federal resources";
  const d = "Section D: Forecasted cash needs";
  const e = "Section E: Federal funds needed for the balance of the project";
  const f = "Section F: Other budget information";
  const fields: FormField[] = [
    field(def, `${LINE}.activity_title`, a, { label: "Grant program function or activity" }),
    field(def, `${LINE}.assistance_listing_number`, a, { label: "Assistance listing number" }),
    field(def, `${LINE}.budget_summary.federal_estimated_unobligated_amount`, a, { label: "Estimated unobligated funds: federal" }),
    field(def, `${LINE}.budget_summary.non_federal_estimated_unobligated_amount`, a, { label: "Estimated unobligated funds: non-federal" }),
    field(def, `${LINE}.budget_summary.federal_new_or_revised_amount`, a, { label: "New or revised budget: federal" }),
    field(def, `${LINE}.budget_summary.non_federal_new_or_revised_amount`, a, { label: "New or revised budget: non-federal" }),
    field(def, `${LINE}.budget_summary.total_amount`, a, { label: "Total", entry: "computed" }),
    ...CATEGORY_FIELDS.map(([key, label]) => field(def, `${LINE}.budget_categories.${key}`, b, { label })),
    field(def, `${LINE}.budget_categories.total_direct_charge_amount`, b, { label: "i. Total direct charges", entry: "computed" }),
    field(def, `${LINE}.budget_categories.total_indirect_charge_amount`, b, { label: "j. Indirect charges" }),
    field(def, `${LINE}.budget_categories.total_amount`, b, { label: "k. Total", entry: "computed" }),
    field(def, `${LINE}.budget_categories.program_income_amount`, b, { label: "7. Program income" }),
    field(def, `${LINE}.non_federal_resources.grant_program`, c, { label: "Grant program" }),
    field(def, `${LINE}.non_federal_resources.applicant_amount`, c, { label: "Applicant" }),
    field(def, `${LINE}.non_federal_resources.state_amount`, c, { label: "State" }),
    field(def, `${LINE}.non_federal_resources.other_amount`, c, { label: "Other sources" }),
    field(def, `${LINE}.non_federal_resources.total_amount`, c, { label: "Total", entry: "computed" }),
    ...QUARTERS.map(([key, label]) => field(def, `forecasted_cash_needs.federal_forecasted_cash_needs.${key}`, d, { label: `Federal: ${label}` })),
    field(def, "forecasted_cash_needs.federal_forecasted_cash_needs.total_amount", d, { label: "Federal: total for the first year", entry: "computed" }),
    ...QUARTERS.map(([key, label]) => field(def, `forecasted_cash_needs.non_federal_forecasted_cash_needs.${key}`, d, { label: `Non-federal: ${label}` })),
    field(def, "forecasted_cash_needs.non_federal_forecasted_cash_needs.total_amount", d, { label: "Non-federal: total for the first year", entry: "computed" }),
    field(def, `${LINE}.federal_fund_estimates.grant_program`, e, { label: "Grant program" }),
    field(def, `${LINE}.federal_fund_estimates.first_year_amount`, e, { label: "First future funding period" }),
    field(def, `${LINE}.federal_fund_estimates.second_year_amount`, e, { label: "Second future funding period" }),
    field(def, `${LINE}.federal_fund_estimates.third_year_amount`, e, { label: "Third future funding period" }),
    field(def, `${LINE}.federal_fund_estimates.fourth_year_amount`, e, { label: "Fourth future funding period" }),
    field(def, "direct_charges_explanation", f, { label: "21. Direct charges" }),
    field(def, "indirect_charges_explanation", f, { label: "22. Indirect charges" }),
    field(def, "remarks", f, { label: "23. Remarks" }),
    field(def, "confirmation", f, { label: "I confirm this budget information is complete and correct" }),
  ];
  // Row 1's activity title is always required (the schema's prefixItems rule).
  return fields.map((x) => (x.id === `${LINE}.activity_title` || x.id === "confirmation" ? { ...x, required: true } : x));
}

const cache = new Map<FederalFormKey, FormField[]>();

export function formFields(key: FederalFormKey): FormField[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const def = FEDERAL_FORM_DEFINITIONS[key];
  const fields = key === "sf424a" ? sf424aFields(def) : fromLayout(def);
  cache.set(key, fields);
  return fields;
}

/** The totals SF-424A repeats outside the activity line; with one line they equal it. */
export const SF424A_TOTALS: [string, string][] = [
  ["total_budget_summary", `${LINE}.budget_summary`],
  ["total_budget_categories", `${LINE}.budget_categories`],
  ["total_non_federal_resources", `${LINE}.non_federal_resources`],
  ["total_federal_fund_estimates", `${LINE}.federal_fund_estimates`],
];
