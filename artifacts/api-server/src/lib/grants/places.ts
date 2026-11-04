/**
 * Place-based designations ("zones"): Opportunity Zones, HUBZones, HUD
 * Qualified Census Tracts and Difficult Development Areas, persistent-poverty
 * counties and USDA rural areas (docs/GRANT_STUDIO.md, Place designations).
 *
 * Funders give eligibility or priority points for these. Grant Studio does not
 * decide them: a person checks the organization's location on the agency's
 * own lookup tool and records the result here, with the date. Matching then
 * names a designation the notice mentions and what the organization recorded.
 *
 * Pure module: no database access, so it is unit tested directly.
 */

export const PLACE_STATUSES = ["unknown", "in", "not_in"] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

/** A recorded result older than this is shown as due for a recheck. */
export const RECHECK_AFTER_DAYS = 365;

export interface PlaceDesignationSpec {
  label: string;
  /** The plural used mid-sentence, when it differs from the label's plural ("persistent-poverty counties"). */
  plural?: string;
  /** What the designation is drawn on. */
  geography: "census tract" | "county" | "ZIP Code Tabulation Area" | "address";
  authority: string;
  /** The agency's own lookup tool. */
  lookupUrl: string;
  /** Primary sources for the definition. */
  sources: { label: string; url: string }[];
  /** What to know when checking. */
  guidance: string;
  /** Words in a notice that refer to it. */
  noticeTerms: RegExp[];
}

export const PLACE_DESIGNATIONS = {
  opportunity_zone: {
    label: "Qualified Opportunity Zone",
    geography: "census tract",
    authority: "U.S. Treasury (CDFI Fund and IRS)",
    lookupUrl: "https://www.cdfifund.gov/opportunity-zones",
    sources: [
      { label: "CDFI Fund: Opportunity Zones resources (list, map and shapefile)", url: "https://www.cdfifund.gov/opportunity-zones" },
      { label: "IRS: Opportunity zones frequently asked questions", url: "https://www.irs.gov/credits-deductions/opportunity-zones-frequently-asked-questions" },
    ],
    guidance:
      "Designated by census tract. Find the tract with the Census Geocoder, then check it on the CDFI Fund list or map. The 2018 designations use the tract boundaries of that year. Treasury opened a new designation round in 2026, so recheck when new designations take effect.",
    noticeTerms: [/\bopportunity zones?\b/i, /\bQOZs?\b/],
  },
  hubzone: {
    label: "HUBZone",
    geography: "address",
    authority: "U.S. Small Business Administration",
    lookupUrl: "https://maps.certify.sba.gov/hubzone/map",
    sources: [
      { label: "SBA HUBZone map", url: "https://maps.certify.sba.gov/hubzone/map" },
      { label: "SBA HUBZone map help", url: "https://maps.certify.sba.gov/hubzone/map/help" },
    ],
    guidance:
      "Search the principal office's full street address, not a city. Some results (redesignated, disaster or governor-designated areas) show an expiration date: record the later one as Valid through.",
    noticeTerms: [/\bHUB\s?Zones?\b/i],
  },
  qct: {
    label: "HUD Qualified Census Tract",
    geography: "census tract",
    authority: "HUD Office of Policy Development and Research",
    lookupUrl: "https://www.huduser.gov/portal/sadda/sadda_qct.html",
    sources: [
      { label: "HUD User: QCT and DDA mapping tool", url: "https://www.huduser.gov/portal/sadda/sadda_qct.html" },
      { label: "HUD User: Qualified Census Tracts data", url: "https://www.huduser.gov/portal/datasets/qct.html" },
    ],
    guidance: "Designated each year, effective 1 January, on 2020 census tracts. Record the designation year in the note and recheck each January.",
    noticeTerms: [/\bqualified census tracts?\b/i, /\bQCTs?\b/],
  },
  dda: {
    label: "HUD Difficult Development Area",
    geography: "ZIP Code Tabulation Area",
    authority: "HUD Office of Policy Development and Research",
    lookupUrl: "https://www.huduser.gov/portal/sadda/sadda_qct.html",
    sources: [{ label: "HUD User: QCT and DDA mapping tool", url: "https://www.huduser.gov/portal/sadda/sadda_qct.html" }],
    guidance: "Metro DDAs use ZIP Code Tabulation Areas, which differ from the USPS ZIP code: use HUD's locator, not the mailing ZIP. Designated each year, effective 1 January.",
    noticeTerms: [/\bdifficult development areas?\b/i],
  },
  persistent_poverty: {
    label: "Persistent-poverty county",
    plural: "persistent-poverty counties",
    geography: "county",
    authority: "USDA Economic Research Service; U.S. Census Bureau",
    lookupUrl: "https://www.ers.usda.gov/data-products/poverty-area-measures/",
    sources: [
      { label: "USDA ERS: Poverty Area Measures", url: "https://www.ers.usda.gov/data-products/poverty-area-measures/" },
      { label: "Census Bureau: Persistent Poverty in Counties and Census Tracts (2023)", url: "https://www.census.gov/library/publications/2023/acs/acs-51.html" },
      { label: "Congressional Research Service: The 10-20-30 provision (R45100)", url: "https://crsreports.congress.gov/product/details?prodcode=R45100" },
    ],
    guidance:
      "Generally a county where 20% or more of residents have lived in poverty for about 30 years, but statutes and agencies measure it with different years and data. Use the definition the notice gives. Some programs also use persistent-poverty census tracts.",
    noticeTerms: [/\bpersistent[-\s]poverty\b/i, /\b10-20-30\b/],
  },
  usda_rural: {
    label: "USDA rural area",
    geography: "address",
    authority: "USDA Rural Development",
    lookupUrl: "https://eligibility.sc.egov.usda.gov/",
    sources: [{ label: "USDA Income and Property Eligibility site", url: "https://eligibility.sc.egov.usda.gov/" }],
    guidance:
      "Rural eligibility differs by program: choose the program the notice names on USDA's site, then check the address. Eligible areas are reviewed after each census, so recheck before applying.",
    // Only explicit rural-eligibility language: "rural communities" alone describes a focus, not a designation.
    noticeTerms: [/\bUSDA Rural Development\b/i, /\beligible rural areas?\b/i, /\brural areas?,? as defined\b/i, /\brural eligibility\b/i, /\bRural[-\s]Urban Commuting Area/i, /\bRUCA\b/],
  },
} as const satisfies Record<string, PlaceDesignationSpec>;

export type PlaceKind = keyof typeof PLACE_DESIGNATIONS;
export const PLACE_KINDS = Object.keys(PLACE_DESIGNATIONS) as PlaceKind[];

export function isPlaceKind(value: unknown): value is PlaceKind {
  return typeof value === "string" && value in PLACE_DESIGNATIONS;
}

/** The finding a person recorded for one designation. */
export interface PlaceRecord {
  status: PlaceStatus;
  /** Which location was checked, for example "Principal office" or "Project site, 12 Main St". */
  place: string | null;
  /** Census tract GEOID (11 digits), county FIPS (5 digits) or ZCTA (5 digits), when known. */
  geoRef: string | null;
  /** ISO date the person checked the official tool. */
  checkedOn: string | null;
  /** ISO date the designation ends, when the tool shows one (HUBZone redesignations). */
  validThrough: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
}

export type PlaceDesignations = Partial<Record<PlaceKind, PlaceRecord>>;

/** The census tract GEOID: 2-digit state, 3-digit county and 6-digit tract. */
export const TRACT_GEOID = /^\d{11}$/;
export const COUNTY_FIPS = /^\d{5}$/;

export function validGeoRef(kind: PlaceKind, value: string): boolean {
  const geography = PLACE_DESIGNATIONS[kind].geography;
  if (geography === "census tract") return TRACT_GEOID.test(value);
  if (geography === "county") return COUNTY_FIPS.test(value) || TRACT_GEOID.test(value);
  if (geography === "ZIP Code Tabulation Area") return /^\d{5}$/.test(value);
  return value.length <= 60;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The recorded result that holds today: an expired designation counts as unknown. */
export function effectiveStatus(record: PlaceRecord | undefined, now: Date = new Date()): PlaceStatus {
  if (!record) return "unknown";
  if (record.status === "in" && record.validThrough && record.validThrough < isoDay(now)) return "unknown";
  return record.status;
}

/** True when the result was recorded more than a year ago, or never. */
export function needsRecheck(record: PlaceRecord | undefined, now: Date = new Date()): boolean {
  if (!record || record.status === "unknown") return false;
  if (!record.checkedOn) return true;
  const age = (now.getTime() - Date.parse(`${record.checkedOn}T00:00:00Z`)) / 86_400_000;
  return age > RECHECK_AFTER_DAYS;
}

/** Designations a notice's text refers to. */
export function mentionedDesignations(text: string): PlaceKind[] {
  if (!text) return [];
  return PLACE_KINDS.filter((kind) => PLACE_DESIGNATIONS[kind].noticeTerms.some((re) => re.test(text)));
}

export interface PlaceMatch {
  kinds: PlaceKind[];
  reasons: string[];
  gaps: string[];
  /** True when the notice mentions a designation the organization recorded it is in. */
  inMentioned: boolean;
}

function plural(spec: PlaceDesignationSpec): string {
  if (spec.plural) return spec.plural;
  return spec.label.endsWith("y") ? `${spec.label.slice(0, -1)}ies` : `${spec.label}s`;
}

/**
 * What a notice's mention of a designation means for this organization. Never
 * an eligibility conclusion: each line sends the person to the notice.
 */
export function matchPlaces(designations: PlaceDesignations | null | undefined, noticeText: string, now: Date = new Date()): PlaceMatch {
  const kinds = mentionedDesignations(noticeText);
  const reasons: string[] = [];
  const gaps: string[] = [];
  let inMentioned = false;
  for (const kind of kinds) {
    const spec: PlaceDesignationSpec = PLACE_DESIGNATIONS[kind];
    const record = designations?.[kind];
    const status = effectiveStatus(record, now);
    if (status === "in") {
      inMentioned = true;
      reasons.push(`The notice mentions ${plural(spec)}, and you recorded that ${record?.place || "your location"} is in one${record?.checkedOn ? ` (checked ${record.checkedOn})` : ""}. Check whether it brings priority points or is required.`);
      if (needsRecheck(record, now)) gaps.push(`Your ${spec.label} result is more than a year old. Recheck it on the official tool.`);
    } else if (status === "not_in") {
      gaps.push(`The notice mentions ${plural(spec)}; you recorded that ${record?.place || "your location"} is not in one. Check whether that affects eligibility or scoring.`);
    } else if (record?.status === "in") {
      gaps.push(`The notice mentions ${plural(spec)}; your recorded designation ended on ${record.validThrough}. Recheck it on the official tool.`);
    } else {
      gaps.push(`The notice mentions ${plural(spec)}. Record whether your location is in one (Place designations tab).`);
    }
  }
  return { kinds, reasons, gaps, inMentioned };
}

/** Confirmed "in" designations as plain statements, for grounded drafting. */
export function placeStatements(designations: PlaceDesignations | null | undefined, now: Date = new Date()): string[] {
  if (!designations) return [];
  const out: string[] = [];
  for (const kind of PLACE_KINDS) {
    const record = designations[kind];
    if (effectiveStatus(record, now) !== "in" || !record) continue;
    const spec = PLACE_DESIGNATIONS[kind];
    const where = record.place || "The organization's location";
    const ref = record.geoRef ? ` (${spec.geography} ${record.geoRef})` : "";
    const checked = record.checkedOn ? `, checked on ${record.checkedOn} using ${spec.authority}'s lookup` : "";
    out.push(`${where}${ref} is in a ${spec.label}${checked}.`);
  }
  return out;
}

export function placeCatalog() {
  return PLACE_KINDS.map((key) => {
    const { noticeTerms: _terms, ...spec } = PLACE_DESIGNATIONS[key];
    return { key, ...spec };
  });
}
