/**
 * Whether a private foundation accepts applications, from its Form 990-PF
 * (docs/GRANT_STUDIO.md, Foundations: "Accepts applications").
 *
 * Pure module: no database import. Reads one 990-PF e-file XML document and
 * returns Part XIV line 2 (Part XV line 2 on forms before tax year 2022):
 *
 *   "Check here if the foundation only makes contributions to preselected
 *    charitable organizations and does not accept unsolicited requests for
 *    funds."
 *
 * Element names come from the IRS e-file schema, as mapped by the Nonprofit
 * Open Data Collective's IRS e-file master concordance (variables
 * F9_15_PF_SIOCTPIND and F9_15_PF_SUINONCOTOPR, "PF_15_CONTR_PRESELECTED_X"),
 * the same map IRSx (jsfenfen/990-xml-reader, MIT) is built on:
 *
 *   2013 schemas on: /Return/ReturnData/IRS990PF/SupplementaryInformationGrp/OnlyContriToPreselectedInd
 *   2009–2012:       /Return/ReturnData/IRS990PF/SupplementaryInformation/OnlyContributesToPreselected
 *                    (also filed under the misspelt SupplementaryInfomation)
 *
 * Line 2a–2d (how to apply) sits under ApplicationSubmissionInfoGrp
 * (AppicationSubmissionInfo, as the IRS spelt it, before 2013). Only the form,
 * deadline and restriction text is kept; the contact person's name, address,
 * phone and email are never read.
 *
 * Never a guess: the result is "invitation_only" only when the box is checked,
 * "accepts_applications" only when the filing carries its supplementary
 * information and the box is not checked, and "unknown" otherwise (not a
 * 990-PF, no supplementary information, an unreadable document).
 */

export type ApplicationPolicy = "invitation_only" | "accepts_applications" | "unknown";

export const POLICY_LABELS: Record<ApplicationPolicy, string> = {
  invitation_only: "Invitation only",
  accepts_applications: "Accepts applications",
  unknown: "Unknown",
};

/** The concordance entries this module reads, for the record and the docs. */
export const CONCORDANCE = {
  preselected: [
    { xpath: "/Return/ReturnData/IRS990PF/SupplementaryInformationGrp/OnlyContriToPreselectedInd", variable: "F9_15_PF_SIOCTPIND", versions: "2013v3.0 on" },
    { xpath: "/Return/ReturnData/IRS990PF/SupplementaryInformation/OnlyContributesToPreselected", variable: "F9_15_PF_SUINONCOTOPR", versions: "2009v1.0–2012v3.0" },
  ],
  formAndMaterials: "F9_15_PF_SIASIFAIAMAT",
  deadlines: "F9_15_PF_SIASISDEADLI",
  restrictions: "F9_15_PF_SIASIROAWARD",
  source: "https://github.com/Nonprofit-Open-Data-Collective/irs-efile-master-concordance-file",
} as const;

export interface PolicyReading {
  /** The filer's EIN from the return header (nine digits), or null. */
  ein: string | null;
  returnType: string | null;
  taxYear: number | null;
  taxPeriodEnd: string | null;
  policy: ApplicationPolicy;
  /** Why, in a sentence a person can check against the filing. */
  basis: string;
  /** Part XIV line 2b–2d as filed, trimmed to 300 characters each. Empty when not filed. */
  info: { formAndMaterials?: string; deadlines?: string; restrictions?: string };
}

const TEXT_CAP = 300;

/** The text of the first element with one of these local names inside `xml` (namespace prefixes allowed). */
function firstElement(xml: string, names: readonly string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>)`);
    const m = re.exec(xml);
    if (m) return m[1] ?? "";
  }
  return null;
}

/** The inner XML of the first element with one of these names, or null. */
function section(xml: string, names: readonly string[]): string | null {
  return firstElement(xml, names);
}

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function capped(text: string | null): string | undefined {
  if (text === null) return undefined;
  const t = decode(text);
  if (!t) return undefined;
  return t.length > TEXT_CAP ? `${t.slice(0, TEXT_CAP - 1)}…` : t;
}

/** IRS CheckboxType is "X"; some filers' software wrote "1" or "true". */
function checked(value: string | null): boolean {
  if (value === null) return false;
  const v = decode(value).toUpperCase();
  return v === "X" || v === "1" || v === "TRUE";
}

export function readApplicationPolicy(xml: string): PolicyReading {
  const header = section(xml, ["ReturnHeader"]) ?? "";
  const filer = section(header, ["Filer"]) ?? "";
  const einText = firstElement(filer, ["EIN"]);
  const ein = einText && /^\d{9}$/.test(decode(einText)) ? decode(einText) : null;
  const typeText = firstElement(header, ["ReturnTypeCd", "ReturnType"]);
  const returnType = typeText ? decode(typeText).toUpperCase() : null;
  const yearText = firstElement(header, ["TaxYr", "TaxYear"]);
  const taxYear = yearText && /^\d{4}$/.test(decode(yearText)) ? Number(decode(yearText)) : null;
  const periodText = firstElement(header, ["TaxPeriodEndDt", "TaxPeriodEndDate"]);
  const taxPeriodEnd = periodText && /^\d{4}-\d{2}-\d{2}/.test(decode(periodText)) ? decode(periodText).slice(0, 10) : null;
  const base = { ein, returnType, taxYear: taxYear ?? (taxPeriodEnd ? Number(taxPeriodEnd.slice(0, 4)) : null), taxPeriodEnd, info: {} };

  if (returnType !== "990PF") return { ...base, policy: "unknown", basis: "Not a Form 990-PF: only private foundations file Part XIV line 2." };
  const pf = section(xml, ["IRS990PF"]);
  if (pf === null) return { ...base, policy: "unknown", basis: "The filing has no Form 990-PF return data." };
  const supplementary = section(pf, ["SupplementaryInformationGrp", "SupplementaryInformation", "SupplementaryInfomation"]);
  if (supplementary === null) return { ...base, policy: "unknown", basis: "The filing has no Part XIV (supplementary information), so it does not say." };

  const box = firstElement(supplementary, ["OnlyContriToPreselectedInd", "OnlyContributesToPreselected"]);
  const apply = section(supplementary, ["ApplicationSubmissionInfoGrp", "AppicationSubmissionInfo", "ApplicationSubmissionInfo"]) ?? "";
  const info = {
    formAndMaterials: capped(firstElement(apply, ["FormAndInfoAndMaterialsTxt", "FormAndInfoAndMaterials"])),
    deadlines: capped(firstElement(apply, ["SubmissionDeadlinesTxt", "SubmissionDeadlines"])),
    restrictions: capped(firstElement(apply, ["RestrictionsOnAwardsTxt", "RestrictionsOnAwards"])),
  };
  const cleanInfo = Object.fromEntries(Object.entries(info).filter(([, v]) => v)) as PolicyReading["info"];
  const year = base.taxYear ? `tax year ${base.taxYear}` : "this";
  if (checked(box)) {
    return { ...base, info: cleanInfo, policy: "invitation_only", basis: `The ${year} Form 990-PF checks Part XIV line 2: it only makes contributions to preselected charitable organizations and does not accept unsolicited requests.` };
  }
  return {
    ...base,
    info: cleanInfo,
    policy: "accepts_applications",
    basis: `The ${year} Form 990-PF does not check Part XIV line 2 (contributions only to preselected organizations)${Object.keys(cleanInfo).length ? " and gives how to apply" : ""}.`,
  };
}
