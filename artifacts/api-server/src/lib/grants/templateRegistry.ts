import { APPLICANT_TYPES, type ApplicantType } from "./eligibility";
import { TEMPLATES, chooseTemplate, type ApplicationTemplate, type RequirementTemplate, type SectionTemplate, type TemplateKey } from "./templates";

/**
 * The template registry (docs/GRANT_STUDIO.md): the built-in templates plus a
 * workspace's own. Pure module, so validation and the automatic choice are
 * unit-tested without a database.
 *
 * Keys: a built-in keeps its key ("federal_nonprofit"); a workspace template
 * is "custom:<id>". Applications store the key they started from.
 */

export const CUSTOM_PREFIX = "custom:";
export const LIMITS = { sections: 40, requirements: 120, label: 120, description: 1000, title: 200, guidance: 4000, detail: 2000, limitValue: 100_000, titleIncludes: 100 } as const;
export const LIMIT_TYPES = ["words", "characters", "pages"] as const;
export const REQUIREMENT_KINDS = ["section", "attachment", "form", "eligibility", "formatting", "deadline", "criterion"] as const;
export const APPLICANT_KINDS = ["any", "nonprofit", "business"] as const;
export const JURISDICTIONS = ["any", "federal", "state"] as const;

export interface AppliesTo {
  applicantKind: (typeof APPLICANT_KINDS)[number];
  jurisdiction: (typeof JURISDICTIONS)[number];
  /** Chosen automatically only when the opportunity title contains this text (case-insensitive). */
  titleIncludes: string | null;
}

export interface TemplateInput {
  label: string;
  description: string | null;
  appliesTo: AppliesTo;
  sections: SectionTemplate[];
  requirements: RequirementTemplate[];
}

/** A workspace template as stored. */
export interface CustomTemplateRow {
  id: string;
  label: string;
  description: string | null;
  basedOn: string | null;
  appliesTo: unknown;
  sections: unknown;
  requirements: unknown;
  status: string;
  version: number;
  updatedAt: Date;
}

export interface RegistryTemplate extends Omit<ApplicationTemplate, "key"> {
  key: string;
  builtIn: boolean;
  description: string | null;
  basedOn: string | null;
  appliesTo: AppliesTo;
  status: "active" | "archived";
  version: number;
  updatedAt: Date | null;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "section";
}

/** The automatic-choice rules a built-in template already follows, written as data for the screen. */
function builtInAppliesTo(key: TemplateKey): AppliesTo {
  switch (key) {
    case "federal_nonprofit":
      return { applicantKind: "nonprofit", jurisdiction: "federal", titleIncludes: null };
    case "federal_business":
      return { applicantKind: "business", jurisdiction: "federal", titleIncludes: null };
    case "sbir_sttr":
      // The built-in rule also matches "STTR" (lib/grants/templates.ts chooseTemplate).
      return { applicantKind: "business", jurisdiction: "federal", titleIncludes: "SBIR" };
    case "state_nonprofit":
      return { applicantKind: "nonprofit", jurisdiction: "state", titleIncludes: null };
    case "state_business":
      return { applicantKind: "business", jurisdiction: "state", titleIncludes: null };
  }
}

export function builtInTemplates(): RegistryTemplate[] {
  return Object.values(TEMPLATES).map((t) => ({
    ...t,
    builtIn: true,
    description: null,
    basedOn: null,
    appliesTo: builtInAppliesTo(t.key),
    status: "active",
    version: 1,
    updatedAt: null,
  }));
}

export function fromRow(row: CustomTemplateRow): RegistryTemplate {
  return {
    key: `${CUSTOM_PREFIX}${row.id}`,
    label: row.label,
    builtIn: false,
    description: row.description,
    basedOn: row.basedOn,
    appliesTo: row.appliesTo as AppliesTo,
    sections: row.sections as SectionTemplate[],
    requirements: row.requirements as RequirementTemplate[],
    status: row.status === "archived" ? "archived" : "active",
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function customId(key: string): string | null {
  return key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : null;
}

/**
 * Checks and normalizes a template from the editor. Returns the cleaned
 * template, or every problem found, each naming where it is.
 */
export function validateTemplate(input: unknown): { ok: true; value: TemplateInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const body = (input ?? {}) as Record<string, unknown>;
  const label = text(body.label);
  if (!label) errors.push("Enter a template name.");
  else if (label.length > LIMITS.label) errors.push(`The name can be at most ${LIMITS.label} characters.`);
  const description = text(body.description) || null;
  if (description && description.length > LIMITS.description) errors.push(`The description can be at most ${LIMITS.description} characters.`);

  const rawApplies = (body.appliesTo ?? {}) as Record<string, unknown>;
  const applicantKind = (APPLICANT_KINDS as readonly string[]).includes(rawApplies.applicantKind as string) ? (rawApplies.applicantKind as AppliesTo["applicantKind"]) : null;
  const jurisdiction = (JURISDICTIONS as readonly string[]).includes(rawApplies.jurisdiction as string) ? (rawApplies.jurisdiction as AppliesTo["jurisdiction"]) : null;
  if (!applicantKind) errors.push(`"Use for" organization type must be one of: ${APPLICANT_KINDS.join(", ")}.`);
  if (!jurisdiction) errors.push(`"Use for" programs must be one of: ${JURISDICTIONS.join(", ")}.`);
  const titleIncludes = text(rawApplies.titleIncludes) || null;
  if (titleIncludes && titleIncludes.length > LIMITS.titleIncludes) errors.push(`"Title contains" can be at most ${LIMITS.titleIncludes} characters.`);

  const rawSections = Array.isArray(body.sections) ? body.sections : [];
  if (!rawSections.length) errors.push("Add at least one section.");
  if (rawSections.length > LIMITS.sections) errors.push(`A template can have at most ${LIMITS.sections} sections.`);
  const sections: SectionTemplate[] = [];
  const keys = new Set<string>();
  rawSections.slice(0, LIMITS.sections).forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const where = `Section ${i + 1}`;
    const title = text(s.title);
    if (!title) errors.push(`${where}: enter a title.`);
    if (title.length > LIMITS.title) errors.push(`${where}: the title can be at most ${LIMITS.title} characters.`);
    const key = text(s.key) ? slugify(text(s.key)) : slugify(title);
    if (keys.has(key)) errors.push(`${where}: another section already uses the key "${key}". Give it a different title or key.`);
    keys.add(key);
    const guidance = text(s.guidance);
    if (guidance.length > LIMITS.guidance) errors.push(`${where}: guidance can be at most ${LIMITS.guidance} characters.`);
    const limitType = s.limitType === null || s.limitType === undefined || s.limitType === "" ? null : (LIMIT_TYPES as readonly string[]).includes(s.limitType as string) ? (s.limitType as SectionTemplate["limitType"]) : undefined;
    if (limitType === undefined) errors.push(`${where}: the limit must be words, characters, pages or none.`);
    let limitValue: number | null = null;
    if (limitType) {
      const n = Number(s.limitValue);
      if (!Number.isInteger(n) || n < 1 || n > LIMITS.limitValue) errors.push(`${where}: the limit must be a whole number from 1 to ${LIMITS.limitValue.toLocaleString("en-US")}.`);
      else limitValue = n;
    }
    sections.push({ key, title, guidance, limitType: limitType ?? null, limitValue });
  });

  const rawReqs = Array.isArray(body.requirements) ? body.requirements : [];
  if (rawReqs.length > LIMITS.requirements) errors.push(`A template can have at most ${LIMITS.requirements} requirements.`);
  const requirements: RequirementTemplate[] = [];
  rawReqs.slice(0, LIMITS.requirements).forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const where = `Requirement ${i + 1}`;
    const kind = (REQUIREMENT_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as RequirementTemplate["kind"]) : null;
    if (!kind) errors.push(`${where}: choose a kind (${REQUIREMENT_KINDS.join(", ")}).`);
    const reqLabel = text(r.label);
    if (!reqLabel) errors.push(`${where}: enter a label.`);
    if (reqLabel.length > LIMITS.title) errors.push(`${where}: the label can be at most ${LIMITS.title} characters.`);
    const detail = text(r.detail);
    if (detail.length > LIMITS.detail) errors.push(`${where}: the detail can be at most ${LIMITS.detail} characters.`);
    const sectionKey = text(r.sectionKey) || undefined;
    if (sectionKey && !keys.has(sectionKey)) errors.push(`${where}: it points to a section ("${sectionKey}") that is not in this template.`);
    requirements.push({ kind: kind ?? "attachment", label: reqLabel, detail, ...(sectionKey ? { sectionKey } : {}) });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { label, description, appliesTo: { applicantKind: applicantKind!, jurisdiction: jurisdiction!, titleIncludes }, sections, requirements } };
}

/** A template in the shape the editor sends, from any registry template (used to duplicate). */
export function toInput(t: Pick<RegistryTemplate, "label" | "description" | "appliesTo" | "sections" | "requirements">, label = t.label): TemplateInput {
  return {
    label,
    description: t.description,
    appliesTo: { ...t.appliesTo },
    sections: t.sections.map((s) => ({ ...s })),
    requirements: t.requirements.map((r) => ({ ...r })),
  };
}

function matches(appliesTo: AppliesTo, applicantType: ApplicantType, title: string, jurisdiction: string | null): boolean {
  const kind = APPLICANT_TYPES[applicantType].kind;
  if (appliesTo.applicantKind !== "any" && appliesTo.applicantKind !== kind) return false;
  if (appliesTo.jurisdiction === "federal" && jurisdiction) return false;
  if (appliesTo.jurisdiction === "state" && !jurisdiction) return false;
  if (appliesTo.titleIncludes && !title.toLowerCase().includes(appliesTo.titleIncludes.toLowerCase())) return false;
  return true;
}

/** How specific a rule is: a title match beats a program type, which beats an organization type. */
function specificity(a: AppliesTo): number {
  return (a.titleIncludes ? 4 : 0) + (a.jurisdiction !== "any" ? 2 : 0) + (a.applicantKind !== "any" ? 1 : 0);
}

/**
 * The template a new application starts from when none is chosen: the most
 * specific active workspace template whose rules match (newest first on a
 * tie), otherwise the built-in choice.
 */
export function chooseRegistryTemplate(custom: RegistryTemplate[], applicantType: ApplicantType, title: string, jurisdiction: string | null): string {
  const candidates = custom
    .filter((t) => !t.builtIn && t.status === "active" && matches(t.appliesTo, applicantType, title, jurisdiction))
    .sort((a, b) => specificity(b.appliesTo) - specificity(a.appliesTo) || (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  return candidates[0]?.key ?? chooseTemplate(applicantType, title, jurisdiction);
}
