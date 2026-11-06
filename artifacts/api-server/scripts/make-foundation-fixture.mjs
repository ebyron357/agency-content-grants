// Writes the synthetic funder-graph fixture used by the foundation tests.
// Every name, EIN, object id and amount here is invented. The columns follow
// the published funder-graph `grants` schema (README, "Published schema").
//
//   node scripts/make-foundation-fixture.mjs           -> src/lib/foundations/__fixtures__/
//   node scripts/make-foundation-fixture.mjs --sample N --out DIR [--funders F]
//        a larger synthetic sample for the storage and memory measurement
//
// Uses hyparquet-writer (MIT), a dev dependency.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parquetWriteFile } from "hyparquet-writer";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const COLUMNS = [
  ["grant_id", "STRING"],
  ["funder_ein", "STRING"],
  ["funder_name", "STRING"],
  ["funder_state", "STRING"],
  ["funder_form_type", "STRING"],
  ["object_id", "STRING"],
  ["tax_year", "INT32"],
  ["tax_period_end", "STRING"],
  ["filing_submission_date", "STRING"],
  ["filing_year", "INT32"],
  ["return_version", "STRING"],
  ["amount_usd", "INT64"],
  ["amount_type", "STRING"],
  ["grant_purpose", "STRING"],
  ["recipient_name_raw", "STRING"],
  ["recipient_city", "STRING"],
  ["recipient_state", "STRING"],
  ["recipient_country", "STRING"],
  ["recipient_ein_resolved", "STRING"],
  ["match_confidence", "DOUBLE"],
  ["match_tier", "STRING"],
  ["recipient_ntee_code", "STRING"],
  ["recipient_type", "STRING"],
];

function write(file, rows) {
  mkdirSync(dirname(file), { recursive: true });
  parquetWriteFile({
    filename: file,
    codec: "SNAPPY",
    rowGroupSize: Number(arg("--row-group", 100_000)),
    columnData: COLUMNS.map(([name, type]) => ({
      name,
      type,
      data: rows.map((r) => {
        const v = r[name] ?? null;
        return type === "INT64" && v !== null ? BigInt(v) : v;
      }),
    })),
  });
}

const row = (o) => ({
  return_version: "2023v4.0",
  recipient_country: "US",
  match_tier: o.match_confidence >= 0.9 ? "A" : o.match_confidence ? "C" : "U",
  recipient_type: "organization",
  amount_type: "paid",
  funder_form_type: "990PF",
  ...o,
});

/** The hand-written fixture: three synthetic funders, two filing years, an amendment and every exclusion. */
function fixture() {
  const alder = {
    funder_ein: "000000101",
    funder_name: "ALDER SYNTHETIC FAMILY FOUNDATION",
    funder_state: "NC",
  };
  const birch = {
    funder_ein: "000000202",
    funder_name: "BIRCH SYNTHETIC TRUST",
    funder_state: "CA",
  };
  const cedar = {
    funder_ein: "000000303",
    funder_name: "CEDAR SYNTHETIC COMMUNITY FUND",
    funder_state: "NC",
    funder_form_type: "990",
  };
  const y2024 = [
    // Alder, tax year 2023 (original filing, published 2024) — superseded by the 2025 amendment.
    row({
      ...alder,
      grant_id: "g-a23-1",
      object_id: "OBJ-A-2023-ORIG",
      tax_year: 2023,
      tax_period_end: "2023-12-31",
      filing_submission_date: "2024-05-01",
      filing_year: 2024,
      amount_usd: 90000,
      grant_purpose: "GENERAL SUPPORT",
      recipient_name_raw: "PIEDMONT SYNTHETIC LITERACY COUNCIL",
      recipient_city: "DURHAM",
      recipient_state: "NC",
      recipient_ein_resolved: "900000001",
      match_confidence: 1.0,
      recipient_ntee_code: "B92",
    }),
    // Alder, tax year 2022.
    row({
      ...alder,
      grant_id: "g-a22-1",
      object_id: "OBJ-A-2022",
      tax_year: 2022,
      tax_period_end: "2022-12-31",
      filing_submission_date: "2024-02-10",
      filing_year: 2024,
      amount_usd: 50000,
      grant_purpose: "SCHOOL LIBRARY BOOKS",
      recipient_name_raw: "PIEDMONT SYNTHETIC LITERACY COUNCIL",
      recipient_city: "DURHAM",
      recipient_state: "NC",
      recipient_ein_resolved: "900000001",
      match_confidence: 0.95,
      recipient_ntee_code: "B92",
    }),
    row({
      ...alder,
      grant_id: "g-a22-2",
      object_id: "OBJ-A-2022",
      tax_year: 2022,
      tax_period_end: "2022-12-31",
      filing_submission_date: "2024-02-10",
      filing_year: 2024,
      amount_usd: 2500,
      grant_purpose: "FOOD PANTRY OPERATIONS",
      recipient_name_raw: "SYNTHETIC HARBOR FOOD BANK",
      recipient_city: "NORFOLK",
      recipient_state: "VA",
      recipient_ein_resolved: "900000002",
      match_confidence: 0.8,
      recipient_ntee_code: "K31",
    }),
    // Excluded: an individual (scholarship), a grant approved for future payment, a zero amount.
    row({
      ...alder,
      grant_id: "g-a22-x1",
      object_id: "OBJ-A-2022",
      tax_year: 2022,
      tax_period_end: "2022-12-31",
      filing_submission_date: "2024-02-10",
      filing_year: 2024,
      amount_usd: 4000,
      grant_purpose: "SCHOLARSHIP",
      recipient_name_raw: "SYNTHETIC PERSON ONE",
      recipient_state: "NC",
      recipient_type: "individual",
    }),
    row({
      ...alder,
      grant_id: "g-a22-x2",
      object_id: "OBJ-A-2022",
      tax_year: 2022,
      tax_period_end: "2022-12-31",
      filing_submission_date: "2024-02-10",
      filing_year: 2024,
      amount_usd: 70000,
      amount_type: "approved_future",
      grant_purpose: "CAPITAL CAMPAIGN",
      recipient_name_raw: "PIEDMONT SYNTHETIC LITERACY COUNCIL",
      recipient_state: "NC",
    }),
    row({
      ...alder,
      grant_id: "g-a22-x3",
      object_id: "OBJ-A-2022",
      tax_year: 2022,
      tax_period_end: "2022-12-31",
      filing_submission_date: "2024-02-10",
      filing_year: 2024,
      amount_usd: 0,
      grant_purpose: "NONE",
      recipient_name_raw: "SYNTHETIC ZERO ORG",
      recipient_state: "NC",
    }),
    // Birch, tax year 2023, a foreign recipient and an unknown-type recipient (counted, never listed by name).
    row({
      ...birch,
      grant_id: "g-b23-1",
      object_id: "OBJ-B-2023",
      tax_year: 2023,
      tax_period_end: "2023-06-30",
      filing_submission_date: "2024-03-15",
      filing_year: 2024,
      amount_usd: 250000,
      grant_purpose: "WATERSHED CONSERVATION",
      recipient_name_raw: "SYNTHETIC RIVER LAND TRUST",
      recipient_city: "FRESNO",
      recipient_state: "CA",
      recipient_ein_resolved: "900000003",
      match_confidence: 0.6,
      recipient_ntee_code: "C34",
    }),
    row({
      ...birch,
      grant_id: "g-b23-2",
      object_id: "OBJ-B-2023",
      tax_year: 2023,
      tax_period_end: "2023-06-30",
      filing_submission_date: "2024-03-15",
      filing_year: 2024,
      amount_usd: 10000,
      grant_purpose: "HUMANITARIAN RELIEF",
      recipient_name_raw: "SYNTHETIC OVERSEAS AID SOCIETY",
      recipient_country: "CA",
      recipient_state: null,
    }),
    row({
      ...birch,
      grant_id: "g-b23-3",
      object_id: "OBJ-B-2023",
      tax_year: 2023,
      tax_period_end: "2023-06-30",
      filing_submission_date: "2024-03-15",
      filing_year: 2024,
      amount_usd: 1500,
      grant_purpose: "MUSEUM PROGRAMS",
      recipient_name_raw: "SYNTHETIC UNKNOWN RECIPIENT",
      recipient_state: "NC",
      recipient_type: "unknown",
    }),
    // Cedar is a Form 990 filer (Schedule I): left out unless 990 is imported.
    row({
      ...cedar,
      grant_id: "g-c23-1",
      object_id: "OBJ-C-2023",
      tax_year: 2023,
      tax_period_end: "2023-12-31",
      filing_submission_date: "2024-08-01",
      filing_year: 2024,
      amount_usd: 30000,
      grant_purpose: "YOUTH MENTORING",
      recipient_name_raw: "SYNTHETIC YOUTH CLUB",
      recipient_state: "NC",
      recipient_ein_resolved: "900000004",
      match_confidence: 1,
      recipient_ntee_code: "O50",
    }),
  ];
  const y2025 = [
    // Alder's amended 2023 return, published 2025: replaces the original's 90,000 with two grants.
    row({
      ...alder,
      funder_name: "ALDER SYNTHETIC FAMILY FOUNDATION INC",
      grant_id: "g-a23a-1",
      object_id: "OBJ-A-2023-AMEND",
      tax_year: 2023,
      tax_period_end: "2023-12-31",
      filing_submission_date: "2025-01-20",
      filing_year: 2025,
      amount_usd: 80000,
      grant_purpose: "LITERACY TUTORING",
      recipient_name_raw: "PIEDMONT SYNTHETIC LITERACY COUNCIL",
      recipient_city: "DURHAM",
      recipient_state: "NC",
      recipient_ein_resolved: "900000001",
      match_confidence: 1.0,
      recipient_ntee_code: "B92",
    }),
    row({
      ...alder,
      funder_name: "ALDER SYNTHETIC FAMILY FOUNDATION INC",
      grant_id: "g-a23a-2",
      object_id: "OBJ-A-2023-AMEND",
      tax_year: 2023,
      tax_period_end: "2023-12-31",
      filing_submission_date: "2025-01-20",
      filing_year: 2025,
      amount_usd: 15000,
      grant_purpose: "AFTER-SCHOOL READING",
      recipient_name_raw: "SYNTHETIC TRIANGLE BOYS AND GIRLS CLUB",
      recipient_city: "RALEIGH",
      recipient_state: "NC",
      recipient_ein_resolved: null,
      match_confidence: null,
      recipient_ntee_code: null,
    }),
    // Alder, tax year 2024.
    row({
      ...alder,
      funder_name: "ALDER SYNTHETIC FAMILY FOUNDATION INC",
      grant_id: "g-a24-1",
      object_id: "OBJ-A-2024",
      tax_year: 2024,
      tax_period_end: "2024-12-31",
      filing_submission_date: "2025-04-02",
      filing_year: 2025,
      amount_usd: 120000,
      grant_purpose: "EARLY CHILDHOOD LITERACY",
      recipient_name_raw: "PIEDMONT SYNTHETIC LITERACY COUNCIL",
      recipient_city: "DURHAM",
      recipient_state: "NC",
      recipient_ein_resolved: "900000001",
      match_confidence: 1.0,
      recipient_ntee_code: "B92",
    }),
  ];
  const out = join(here, "../src/lib/foundations/__fixtures__/funder-graph");
  write(join(out, "grants/filing_year=2024/part-0000.parquet"), y2024);
  write(join(out, "grants/filing_year=2025/part-0000.parquet"), y2025);
  console.log(`fixture written to ${out}`);
}

/** A larger synthetic sample with a realistic shape, for measuring storage and memory. Deterministic. */
function sample(rowsPerYear, outDir, funders, years) {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const STATES = [
    "CA",
    "NY",
    "TX",
    "FL",
    "IL",
    "PA",
    "OH",
    "GA",
    "NC",
    "MI",
    "NJ",
    "VA",
    "WA",
    "AZ",
    "MA",
    "TN",
    "IN",
    "MO",
    "MD",
    "WI",
    "CO",
    "MN",
    "SC",
    "AL",
    "LA",
  ];
  const NTEE = [
    "A20",
    "B20",
    "B82",
    "C30",
    "D20",
    "E20",
    "F30",
    "G30",
    "K31",
    "L20",
    "O50",
    "P20",
    "Q30",
    "S20",
    "T20",
    "X20",
    null,
  ];
  const PURPOSES = [
    "GENERAL OPERATING SUPPORT",
    "SCHOLARSHIP FUND",
    "FOOD PANTRY",
    "YOUTH PROGRAMS",
    "CAPITAL CAMPAIGN",
    "HOUSING ASSISTANCE",
    "MUSEUM EXHIBITS",
    "MEDICAL RESEARCH",
    "CHURCH MINISTRY",
    "CONSERVATION",
    null,
  ];
  for (const year of years) {
    const rows = [];
    // Grants per funder follow a heavy tail: most funders give a few grants, a few give hundreds.
    let ein = 0;
    while (rows.length < rowsPerYear) {
      ein = (ein % funders) + 1;
      const n = Math.max(1, Math.floor(1 / Math.max(0.004, rand()) ** 0.9));
      const funderEin = String(100000000 + ein * 7).padStart(9, "0");
      const fState = STATES[ein % STATES.length];
      const taxYear = year - 1 - (rand() < 0.15 ? 1 : 0);
      const objectId = `SYN${year}${funderEin}${taxYear}`;
      for (let i = 0; i < n && rows.length < rowsPerYear; i++) {
        const r = rand();
        const confidence =
          r < 0.5 ? 1 : r < 0.6 ? 0.95 : r < 0.75 ? 0.92 : r < 0.9 ? 0.8 : null;
        rows.push(
          row({
            grant_id: `${objectId}-${i}`,
            funder_ein: funderEin,
            funder_name: `SYNTHETIC FOUNDATION ${ein}`,
            funder_state: fState,
            object_id: objectId,
            tax_year: taxYear,
            tax_period_end: `${taxYear}-12-31`,
            filing_submission_date: `${year}-0${1 + (ein % 9)}-15`,
            filing_year: year,
            amount_usd: Math.round(500 * Math.exp(rand() * 7)),
            amount_type: rand() < 0.06 ? "approved_future" : "paid",
            grant_purpose: PURPOSES[Math.floor(rand() * PURPOSES.length)],
            recipient_name_raw: `SYNTHETIC RECIPIENT ${Math.floor(rand() * 200000)}`,
            recipient_city: "SYNTHETIC CITY",
            recipient_state: STATES[Math.floor(rand() * STATES.length)],
            recipient_ein_resolved: confidence
              ? String(800000000 + Math.floor(rand() * 9e7))
              : null,
            match_confidence: confidence,
            recipient_ntee_code: confidence
              ? NTEE[Math.floor(rand() * NTEE.length)]
              : null,
            recipient_type: rand() < 0.04 ? "individual" : "organization",
          }),
        );
      }
    }
    rows.sort((a, b) => a.funder_ein.localeCompare(b.funder_ein));
    write(join(outDir, `grants/filing_year=${year}/part-0000.parquet`), rows);
    console.log(`sample ${year}: ${rows.length} rows`);
  }
}

if (args.includes("--sample")) {
  const years = arg("--years", "2024").split(",").map(Number);
  sample(
    Number(arg("--sample", "100000")),
    arg("--out", join(here, "../.foundation-sample")),
    Number(arg("--funders", "20000")),
    years,
  );
} else {
  fixture();
}
