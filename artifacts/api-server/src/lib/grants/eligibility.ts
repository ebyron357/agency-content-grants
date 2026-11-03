/**
 * Applicant types, readiness items and budget categories for Grant Studio.
 *
 * Applicant types map to the Grants.gov applicant-type (eligibility) codes. The
 * codes and labels are the ones the Grants.gov search2 API returns in its
 * `eligibilities` facet (observed 3 November 2026).
 */

export const APPLICANT_TYPES = {
  nonprofit_501c3: {
    label: "Nonprofit with 501(c)(3) status",
    grantsGovCodes: ["12"],
    kind: "nonprofit",
  },
  nonprofit_other: {
    label: "Nonprofit without 501(c)(3) status",
    grantsGovCodes: ["13"],
    kind: "nonprofit",
  },
  small_business: {
    label: "Small business",
    grantsGovCodes: ["23"],
    kind: "business",
  },
  for_profit: {
    label: "For-profit organization (not a small business)",
    grantsGovCodes: ["22"],
    kind: "business",
  },
} as const;

export type ApplicantType = keyof typeof APPLICANT_TYPES;

export function isApplicantType(value: unknown): value is ApplicantType {
  return typeof value === "string" && value in APPLICANT_TYPES;
}

/** Grants.gov code "25" means "Others (see text field entitled Additional Information on Eligibility)". */
export const GRANTS_GOV_OTHERS_CODE = "25";
/** Code "99" means "Unrestricted (i.e., open to any type of entity above), subject to any clarification in text field". */
export const GRANTS_GOV_UNRESTRICTED_CODE = "99";

/** The codes the connector searches, so every applicant type above is covered. */
export const INGEST_ELIGIBILITY_CODES = ["12", "13", "22", "23", GRANTS_GOV_OTHERS_CODE, GRANTS_GOV_UNRESTRICTED_CODE];

export const GRANTS_GOV_CODE_LABELS: Record<string, string> = {
  "00": "State governments",
  "01": "County governments",
  "02": "City or township governments",
  "04": "Special district governments",
  "05": "Independent school districts",
  "06": "Public and State controlled institutions of higher education",
  "07": "Native American tribal governments (Federally recognized)",
  "08": "Public housing authorities and Indian housing authorities",
  "11": "Native American tribal organizations (other than Federally recognized tribal governments)",
  "12": "Nonprofits having a 501(c)(3) status with the IRS, other than institutions of higher education",
  "13": "Nonprofits that do not have a 501(c)(3) status with the IRS, other than institutions of higher education",
  "20": "Private institutions of higher education",
  "21": "Individuals",
  "22": "For profit organizations other than small businesses",
  "23": "Small businesses",
  "25": "Others (see the notice's additional eligibility information)",
  "99": "Unrestricted, subject to any clarification in the notice",
};

/**
 * Readiness items. Federal awards require an active SAM.gov registration and a
 * UEI (2 CFR Part 25); submitting through Grants.gov requires an Authorized
 * Organization Representative (AOR). The others are documents funders commonly
 * ask for. Each funder controls its own requirements.
 */
export const READINESS_KINDS = {
  sam_registration: { label: "Active SAM.gov registration and UEI", federal: true, blocking: true, appliesTo: ["nonprofit", "business"] },
  grants_gov_aor: { label: "Grants.gov account with an Authorized Organization Representative", federal: true, blocking: true, appliesTo: ["nonprofit", "business"] },
  irs_determination: { label: "IRS 501(c)(3) determination letter", federal: false, blocking: true, appliesTo: ["nonprofit_501c3"] },
  financial_statements: { label: "Most recent financial statements or audit", federal: false, blocking: false, appliesTo: ["nonprofit", "business"] },
  board_list: { label: "Board of directors list", federal: false, blocking: false, appliesTo: ["nonprofit"] },
  capability_statement: { label: "Capability statement and past performance", federal: false, blocking: false, appliesTo: ["business"] },
  indirect_rate: { label: "Negotiated indirect cost rate agreement (if you have one)", federal: false, blocking: false, appliesTo: ["nonprofit", "business"] },
} as const;

export type ReadinessKind = keyof typeof READINESS_KINDS;

export function isReadinessKind(value: unknown): value is ReadinessKind {
  return typeof value === "string" && value in READINESS_KINDS;
}

export const READINESS_STATUSES = ["missing", "in_progress", "ready"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/** The readiness kinds that apply to an applicant type. */
export function readinessKindsFor(type: ApplicantType): ReadinessKind[] {
  const kind = APPLICANT_TYPES[type].kind;
  return (Object.keys(READINESS_KINDS) as ReadinessKind[]).filter((key) => {
    const applies = READINESS_KINDS[key].appliesTo as readonly string[];
    return applies.includes(kind) || applies.includes(type);
  });
}

/** SF-424A object-class categories. */
export const BUDGET_CATEGORIES = {
  personnel: "Personnel",
  fringe: "Fringe benefits",
  travel: "Travel",
  equipment: "Equipment",
  supplies: "Supplies",
  contractual: "Contractual",
  construction: "Construction",
  other: "Other",
} as const;

export type BudgetCategory = keyof typeof BUDGET_CATEGORIES;

export function isBudgetCategory(value: unknown): value is BudgetCategory {
  return typeof value === "string" && value in BUDGET_CATEGORIES;
}
