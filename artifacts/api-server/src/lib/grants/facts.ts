/**
 * The organization fact library. Grant applications reuse the same facts:
 * history, programs, outcomes, staff, partners, finances and community need.
 * Each fact carries its source and an "as of" date, and only facts a person
 * has confirmed are given to AI drafting, which is told to use nothing else.
 */

export const FACT_CATEGORIES = {
  need: { label: "Community need", hint: "Statistics about the problem, each with its source and year." },
  programs: { label: "Programs and services", hint: "What you deliver, to whom, how often and where." },
  outcomes: { label: "Outcomes and results", hint: "Measured results, with the measure and period." },
  history: { label: "History and track record", hint: "Founding, milestones, prior grants and awards." },
  staff: { label: "Staff and key personnel", hint: "Names, roles, qualifications and time commitment." },
  partners: { label: "Partners", hint: "Partner organizations and what each contributes. Get their agreement first." },
  finances: { label: "Finances and capacity", hint: "Budget, funding mix, audits, systems for managing awards." },
  evaluation: { label: "Evaluation", hint: "Tools, data you collect and who analyzes it." },
  other: { label: "Other", hint: "Anything else funders ask for repeatedly." },
} as const;

export type FactCategory = keyof typeof FACT_CATEGORIES;

export function isFactCategory(value: unknown): value is FactCategory {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FACT_CATEGORIES, value);
}

/** Which categories each template section draws on first. Sections not listed use every category. */
export const SECTION_FACT_CATEGORIES: Record<string, FactCategory[]> = {
  abstract: ["programs", "outcomes", "need", "history"],
  need: ["need"],
  significance: ["need", "history"],
  project: ["programs", "partners"],
  objectives: ["outcomes", "programs"],
  technical_objectives: ["outcomes", "programs"],
  logic_model: ["programs", "outcomes", "need"],
  work_plan: ["programs", "staff", "partners"],
  evaluation: ["evaluation", "outcomes"],
  capacity: ["history", "staff", "finances", "partners"],
  key_personnel: ["staff"],
  related_work: ["history", "outcomes"],
  sustainability: ["finances", "partners", "history"],
  budget_justification: ["finances", "staff"],
  commercialization: ["need", "partners", "finances"],
};

export interface FactLike {
  id: string;
  category: string;
  label: string;
  body: string;
  source: string | null;
  asOf: string | null;
  confirmedAt: Date | string | null;
}

/** Most facts and characters given to one drafting call, so prompts stay bounded. */
export const MAX_FACTS_PER_DRAFT = 25;
export const MAX_FACT_CHARS_PER_DRAFT = 8_000;

/** One fact as the drafting prompt sees it, with its source and date. */
export function factLine(fact: FactLike): string {
  const meta = [fact.source ? `source: ${fact.source}` : "source not recorded", fact.asOf ? `as of ${fact.asOf}` : null].filter(Boolean).join(", ");
  return `${fact.label}: ${fact.body} (${meta})`;
}

/**
 * Confirmed facts for a section: its mapped categories first, then the rest,
 * newest first within each group, cut to the per-draft bounds.
 */
export function factsForSection<T extends FactLike>(facts: T[], sectionKey: string): T[] {
  const confirmed = facts.filter((f) => f.confirmedAt);
  const preferred = SECTION_FACT_CATEGORIES[sectionKey];
  const rank = (f: T) => (preferred ? (preferred.includes(f.category as FactCategory) ? 0 : 1) : 0);
  const time = (f: T) => (f.confirmedAt ? new Date(f.confirmedAt).getTime() : 0);
  const ordered = [...confirmed].sort((a, b) => rank(a) - rank(b) || time(b) - time(a));
  const chosen: T[] = [];
  let chars = 0;
  for (const fact of ordered) {
    const length = factLine(fact).length;
    if (chosen.length >= MAX_FACTS_PER_DRAFT || chars + length > MAX_FACT_CHARS_PER_DRAFT) break;
    chosen.push(fact);
    chars += length;
  }
  return chosen;
}

/** Facts in the categories a section draws on (confirmed only), for showing beside the editor. */
export function factsMappedToSection<T extends FactLike>(facts: T[], sectionKey: string): T[] {
  const preferred = SECTION_FACT_CATEGORIES[sectionKey];
  return facts.filter((f) => f.confirmedAt && (!preferred || preferred.includes(f.category as FactCategory)));
}
