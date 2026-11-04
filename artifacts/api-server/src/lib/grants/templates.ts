import type { ApplicantType } from "./eligibility";
import { APPLICANT_TYPES } from "./eligibility";

/**
 * Application templates. Each template is a starting structure, not a funder's
 * rules: section limits are placeholders the applicant replaces with the limits
 * in the notice, and every template requirement starts unconfirmed.
 */

export type TemplateKey = "federal_nonprofit" | "federal_business" | "sbir_sttr" | "state_nonprofit" | "state_business";

export interface SectionTemplate {
  key: string;
  title: string;
  guidance: string;
  limitType: "words" | "characters" | "pages" | null;
  limitValue: number | null;
}

export interface RequirementTemplate {
  kind: "section" | "attachment" | "form" | "eligibility" | "formatting" | "deadline" | "criterion";
  label: string;
  detail: string;
  sectionKey?: string;
}

export interface ApplicationTemplate {
  key: TemplateKey;
  label: string;
  sections: SectionTemplate[];
  requirements: RequirementTemplate[];
}

const ABSTRACT: SectionTemplate = {
  key: "abstract",
  title: "Project abstract",
  guidance: "One paragraph a reviewer can read in a minute: who you are, the need, what you will do, for whom, the main outcomes and the amount requested. Write it last. Many notices cap it at one page or a character count; use the notice's limit.",
  limitType: "words",
  limitValue: 300,
};

const NEED: SectionTemplate = {
  key: "need",
  title: "Statement of need",
  guidance: "Show the problem in the community you serve with recent, cited data (local first, then state and national), the people affected and the gap your project fills. Every statistic needs its source. Tie the need to the funder's stated purpose.",
  limitType: "words",
  limitValue: 750,
};

const PROJECT: SectionTemplate = {
  key: "project",
  title: "Project description and approach",
  guidance: "What you will do, who will do it, for whom, where and when. Explain why this approach works (evidence or past results) and how it answers the need. Name partners and their roles.",
  limitType: "words",
  limitValue: 1500,
};

const OBJECTIVES: SectionTemplate = {
  key: "objectives",
  title: "Goals and measurable objectives",
  guidance: "One goal per outcome the funder cares about, each with SMART objectives: specific, measurable, achievable, relevant and time-bound. Include baselines and targets, for example \"increase from 40% to 60% by month 12\".",
  limitType: "words",
  limitValue: 600,
};

const LOGIC: SectionTemplate = {
  key: "logic_model",
  title: "Logic model",
  guidance: "Inputs → activities → outputs → short-term outcomes → long-term outcomes. Keep each column specific to this project; reviewers check that every activity leads to an outcome you measure.",
  limitType: "words",
  limitValue: 400,
};

const WORKPLAN: SectionTemplate = {
  key: "work_plan",
  title: "Work plan and timeline",
  guidance: "Milestones by quarter or month, the person responsible and the deliverable for each. Include start-up time, hiring and reporting dates.",
  limitType: "words",
  limitValue: 600,
};

const EVALUATION: SectionTemplate = {
  key: "evaluation",
  title: "Evaluation plan",
  guidance: "For each objective: the measure, the data source, how often you collect it, who analyses it and how results change the program. Name an external evaluator if the notice asks for one.",
  limitType: "words",
  limitValue: 700,
};

const CAPACITY: SectionTemplate = {
  key: "capacity",
  title: "Organizational capacity and key personnel",
  guidance: "Why your organization can deliver: history, relevant past awards and results, financial management, and the qualifications of key staff. Reviewers look for evidence you can manage federal funds.",
  limitType: "words",
  limitValue: 700,
};

const SUSTAIN: SectionTemplate = {
  key: "sustainability",
  title: "Sustainability",
  guidance: "How the work continues after the award: other funders, earned revenue, partner commitments or policy changes. Be concrete about who pays for what.",
  limitType: "words",
  limitValue: 400,
};

const BUDGET_NARRATIVE: SectionTemplate = {
  key: "budget_justification",
  title: "Budget justification",
  guidance: "Explain every budget line: what it is, how the cost was calculated and why it is needed for the project. The Budget step generates a starting text from your lines; edit it here.",
  limitType: null,
  limitValue: null,
};

const FEDERAL_FORMS: RequirementTemplate[] = [
  { kind: "form", label: "SF-424 Application for Federal Assistance", detail: "The standard cover form for Grants.gov applications. Confirm the exact form set in the opportunity's package in Grants.gov Workspace." },
  { kind: "form", label: "SF-424A Budget Information (Non-Construction)", detail: "Budget form for non-construction programs. Some agencies use their own budget form instead; check the package." },
  { kind: "form", label: "Project/Performance Site Location(s)", detail: "Usually required; confirm in the package." },
  { kind: "form", label: "SF-LLL Disclosure of Lobbying Activities", detail: "Required only if lobbying disclosures apply; check the notice." },
];

const FEDERAL_COMMON: RequirementTemplate[] = [
  { kind: "eligibility", label: "Applicant type is eligible", detail: "Confirm against the notice's eligibility section and any additional eligibility text." },
  { kind: "eligibility", label: "Active SAM.gov registration and UEI", detail: "Federal awards require an active registration (2 CFR Part 25). Registration and renewal can take weeks." },
  { kind: "deadline", label: "Submit before the closing date and time", detail: "Grants.gov validates submissions after they are received. Submit early enough to fix any rejection." },
  { kind: "formatting", label: "Formatting rules", detail: "Font, margins, page size, file type and file naming rules from the notice. Replace this row with the notice's rules." },
  { kind: "attachment", label: "Letters of support or commitment", detail: "If the notice asks for them: who signs, what they commit and any limit on the number." },
];

const STATE_COMMON: RequirementTemplate[] = [
  { kind: "eligibility", label: "Applicant type and geography are eligible", detail: "State programs usually limit who can apply and where the project must be. Confirm both against the program's eligibility notes and guidelines." },
  { kind: "form", label: "State application portal and forms", detail: "State agencies use their own portals and forms. Confirm the submission method, account requirements and required attachments on the program page." },
  { kind: "deadline", label: "Submit before the deadline, or early for rolling programs", detail: "Confirm the closing time. Rolling programs fund applications as they arrive until the money runs out." },
  { kind: "formatting", label: "Formatting rules", detail: "Font, page, file type and naming rules from the guidelines. Replace this row with the program's rules." },
  { kind: "attachment", label: "Letters of support or commitment", detail: "If the guidelines ask for them: who signs, what they commit and any limit on the number." },
];

function sectionRequirements(sections: SectionTemplate[]): RequirementTemplate[] {
  return sections.map((section) => ({
    kind: "section" as const,
    label: section.title,
    detail: "Required section in this template. Confirm the notice's name, order and limit for it.",
    sectionKey: section.key,
  }));
}

const NONPROFIT_SECTIONS = [ABSTRACT, NEED, PROJECT, OBJECTIVES, LOGIC, WORKPLAN, EVALUATION, CAPACITY, SUSTAIN, BUDGET_NARRATIVE];

const BUSINESS_SECTIONS: SectionTemplate[] = [
  ABSTRACT,
  { ...NEED, title: "Need and opportunity", guidance: "The problem or market gap the project addresses, with cited evidence, and why it matters to the funder's program goals." },
  PROJECT,
  OBJECTIVES,
  WORKPLAN,
  EVALUATION,
  { ...CAPACITY, guidance: "Company history, relevant contracts and results, financial and management systems, and key personnel. Reviewers look for evidence you can manage federal funds and deliver." },
  { ...SUSTAIN, title: "Economic impact and sustainability", guidance: "Jobs, revenue or community benefit the project creates, and how it continues after the award. State the basis for every number." },
  BUDGET_NARRATIVE,
];

const SBIR_SECTIONS: SectionTemplate[] = [
  ABSTRACT,
  { key: "significance", title: "Identification and significance of the problem or opportunity", guidance: "The technical problem, why it matters to the agency's topic and what an innovative solution would change. Cite prior work.", limitType: "words", limitValue: 800 },
  { key: "technical_objectives", title: "Technical objectives", guidance: "The specific questions this phase answers to prove feasibility. Each objective needs a measurable success criterion.", limitType: "words", limitValue: 500 },
  { key: "work_plan", title: "Work plan", guidance: "Tasks that meet each technical objective: methods, who does them, where, and the timeline. Show how results decide whether to proceed.", limitType: "words", limitValue: 1500 },
  { key: "related_work", title: "Related research and development", guidance: "Your own and others' relevant work, and how this project differs.", limitType: "words", limitValue: 500 },
  { key: "key_personnel", title: "Key personnel and facilities", guidance: "The principal investigator's qualifications and time commitment, the team, and the facilities and equipment you will use.", limitType: "words", limitValue: 600 },
  { key: "commercialization", title: "Commercialization potential", guidance: "Market, customers, competition, intellectual property and the path to revenue. Agencies weigh this heavily; state the basis for every market figure.", limitType: "words", limitValue: 1000 },
  BUDGET_NARRATIVE,
];

export const TEMPLATES: Record<TemplateKey, ApplicationTemplate> = {
  federal_nonprofit: {
    key: "federal_nonprofit",
    label: "Federal grant: nonprofit",
    sections: NONPROFIT_SECTIONS,
    requirements: [...sectionRequirements(NONPROFIT_SECTIONS), ...FEDERAL_COMMON, ...FEDERAL_FORMS],
  },
  federal_business: {
    key: "federal_business",
    label: "Federal grant: business",
    sections: BUSINESS_SECTIONS,
    requirements: [...sectionRequirements(BUSINESS_SECTIONS), ...FEDERAL_COMMON, ...FEDERAL_FORMS],
  },
  sbir_sttr: {
    key: "sbir_sttr",
    label: "SBIR/STTR proposal",
    sections: SBIR_SECTIONS,
    requirements: [
      ...sectionRequirements(SBIR_SECTIONS),
      ...FEDERAL_COMMON,
      { kind: "eligibility", label: "SBIR/STTR small business eligibility", detail: "Ownership, size and (for STTR) research institution partnership rules apply. Confirm them in the solicitation." },
      ...FEDERAL_FORMS,
    ],
  },
  state_nonprofit: {
    key: "state_nonprofit",
    label: "State grant: nonprofit",
    sections: NONPROFIT_SECTIONS,
    requirements: [...sectionRequirements(NONPROFIT_SECTIONS), ...STATE_COMMON],
  },
  state_business: {
    key: "state_business",
    label: "State grant: business",
    sections: BUSINESS_SECTIONS,
    requirements: [...sectionRequirements(BUSINESS_SECTIONS), ...STATE_COMMON],
  },
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && value in TEMPLATES;
}

/** Picks a starting template from the applicant type and the opportunity (state programs get a state template). */
export function chooseTemplate(applicantType: ApplicantType, opportunityTitle: string, jurisdiction: string | null = null): TemplateKey {
  const business = APPLICANT_TYPES[applicantType].kind === "business";
  if (jurisdiction) return business ? "state_business" : "state_nonprofit";
  if (business) {
    return /\b(SBIR|STTR)\b/i.test(opportunityTitle) ? "sbir_sttr" : "federal_business";
  }
  return "federal_nonprofit";
}
