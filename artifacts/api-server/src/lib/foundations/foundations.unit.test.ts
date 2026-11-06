/**
 * Foundation giving: parsing and aggregation, hermetic. Reads the committed
 * synthetic funder-graph fixture (scripts/make-foundation-fixture.mjs; every
 * name, EIN and amount in it is invented) with the real Parquet reader.
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FunderSegment,
  GRANT_COLUMNS,
  capKeys,
  categoriesInText,
  categoryOf,
  classifyRow,
  isoDay,
  mergeFunder,
  normalizeEin,
  percentile,
  recentGrants,
  sizeBucket,
  sizeStats,
  type CleanGrant,
  type FunderState,
  type StoredGrant,
} from "./aggregate";
import { cachedRanges, importYears, openPartition, partitionPath, readManifest, readWindows } from "./source";
import { HISTORY_LABEL, causesFor, filingLinks, formatEin, suggestionReasons } from "./profile";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "funder-graph");
const OPTS = { minConfidence: 0.9, recentPerFunder: 5, statesPerFunder: 25 };

async function readYear(year: number) {
  const part = await openPartition(FIXTURE, year);
  expect(part).not.toBeNull();
  const rows: Record<string, unknown>[] = [];
  for await (const w of readWindows(part!, GRANT_COLUMNS, 3)) rows.push(...w.rows);
  await part!.close();
  return rows;
}

/** Runs the importer's logic in memory: newest year first, segments per funder, merged per funder. */
async function importInMemory(formTypes = ["990PF"]) {
  const state = new Map<string, FunderState>();
  const recent = new Map<string, StoredGrant[]>();
  const counts: Record<string, number> = { superseded: 0, alreadyCounted: 0 };
  for (const year of [2025, 2024]) {
    const segments = new Map<string, FunderSegment>();
    for (const raw of await readYear(year)) {
      if (!formTypes.includes(String(raw.funder_form_type))) continue;
      const r = classifyRow(raw, OPTS);
      if (!r.ok) {
        counts[r.reason] = (counts[r.reason] ?? 0) + 1;
        continue;
      }
      const seg = segments.get(r.grant.funderEin) ?? new FunderSegment(r.grant.funderEin, OPTS);
      segments.set(r.grant.funderEin, seg);
      seg.add(r.grant);
    }
    for (const seg of segments.values()) {
      const m = mergeFunder(seg.ein, state.get(seg.ein) ?? null, recent.get(seg.ein) ?? [], seg.chosen(), OPTS);
      counts.superseded += m.superseded;
      counts.alreadyCounted += m.alreadyCounted;
      state.set(seg.ein, m.state);
      recent.set(seg.ein, m.recent);
    }
  }
  return { state, recent, counts };
}

describe("funder-graph rows", () => {
  const base = {
    grant_id: "g1", funder_ein: "12-3456789", funder_name: "SYNTHETIC FUND", funder_state: "nc", funder_form_type: "990PF", object_id: "OBJ1", tax_year: 2023,
    tax_period_end: new Date("2023-12-31T00:00:00Z"), filing_submission_date: "2024-05-01", amount_usd: 5000n, amount_type: "paid", grant_purpose: "Literacy",
    recipient_name_raw: "SYNTHETIC ORG", recipient_state: "nc", recipient_country: "US", recipient_ein_resolved: "98-7654321", match_confidence: 0.92, recipient_ntee_code: "B90", recipient_type: "organization",
  };

  it("normalizes a kept row: EINs, dates, bigint amounts, states, trusted EINs and causes", () => {
    const r = classifyRow(base, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grant).toMatchObject({ funderEin: "123456789", funderState: "NC", taxPeriodEnd: "2023-12-31", amountUsd: 5000, recipientState: "NC", recipientEin: "987654321", category: "B", categorySource: "ntee" });
  });

  it("excludes individuals, grants approved for future payment, empty amounts and broken rows", () => {
    expect(classifyRow({ ...base, recipient_type: "individual" })).toEqual({ ok: false, reason: "individual" });
    expect(classifyRow({ ...base, amount_type: "approved_future" })).toEqual({ ok: false, reason: "not_paid" });
    expect(classifyRow({ ...base, amount_usd: 0 })).toEqual({ ok: false, reason: "no_amount" });
    expect(classifyRow({ ...base, amount_usd: null })).toEqual({ ok: false, reason: "no_amount" });
    expect(classifyRow({ ...base, funder_ein: "not-an-ein" })).toEqual({ ok: false, reason: "bad_row" });
    expect(classifyRow({ ...base, object_id: "" })).toEqual({ ok: false, reason: "bad_row" });
  });

  it("uses the recipient EIN and NTEE code only at the minimum confidence (default 0.90)", () => {
    const low = classifyRow({ ...base, match_confidence: 0.89, grant_purpose: "Food pantry" }, OPTS);
    expect(low.ok && low.grant.recipientEin).toBeNull();
    expect(low.ok && low.grant).toMatchObject({ category: "K", categorySource: "purpose" });
    const strict = classifyRow(base, { ...OPTS, minConfidence: 0.95 });
    expect(strict.ok && strict.grant.recipientEin).toBeNull();
    expect(classifyRow({ ...base, match_confidence: null, grant_purpose: null }, OPTS)).toMatchObject({ ok: true, grant: { category: "unclassified", categorySource: "none" } });
  });

  it("marks foreign recipients and leaves unfiled states unknown", () => {
    expect(classifyRow({ ...base, recipient_country: "MX" })).toMatchObject({ grant: { recipientState: "foreign" } });
    expect(classifyRow({ ...base, recipient_state: null })).toMatchObject({ grant: { recipientState: null } });
  });

  it("reads purpose text into NTEE groups", () => {
    expect(categoriesInText("After-school literacy tutoring for youth")).toEqual(["B", "O"]);
    expect(categoriesInText("Mental health counseling")).toEqual(["F", "E"]);
    expect(categoriesInText(null)).toEqual([]);
    expect(categoryOf("Z99", true, "general support")).toEqual({ category: "unclassified", source: "none" });
  });

  it("parses EINs and dates", () => {
    expect(normalizeEin("1234567")).toBe("001234567");
    expect(normalizeEin("12-3456789")).toBe("123456789");
    expect(normalizeEin("12345678901")).toBeNull();
    expect(isoDay("2023")).toBe("2023");
    expect(isoDay(19722)).toBe("2023-12-31");
    expect(isoDay("garbage")).toBeNull();
  });
});

describe("grant size distribution", () => {
  it("buckets on a log scale and estimates percentiles within the observed range", () => {
    expect(sizeBucket(1000)).toBe(30);
    expect(sizeBucket(1259)).toBe(31);
    const amounts = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000];
    const hist: Record<string, number> = {};
    for (const a of amounts) hist[sizeBucket(a)] = (hist[sizeBucket(a)] ?? 0) + 1;
    const s = sizeStats(hist, 1000, 250000);
    expect(s.count).toBe(8);
    // Each estimate lands within one bucket (about 26%) of the true order statistic.
    expect(s.median).toBeGreaterThanOrEqual(10000 / 1.26);
    expect(s.median).toBeLessThanOrEqual(20000 * 1.26);
    expect(s.p25).toBeLessThanOrEqual(s.median);
    expect(s.median).toBeLessThanOrEqual(s.p75);
    expect(percentile({ "40": 1 }, 0.5, 10000, 10000)).toBe(10000);
    expect(sizeStats({}, 0, 0)).toMatchObject({ count: 0, median: 0 });
  });

  it("caps the state breakdown, summing the rest under other", () => {
    expect(capKeys({ NC: 5, CA: 4, NY: 3, TX: 1 }, 2)).toEqual({ NC: 5, CA: 4, other: 4 });
    expect(capKeys({ NC: 5 }, 2)).toEqual({ NC: 5 });
  });

  it("keeps the largest grants of the latest three tax years", () => {
    const g = (id: string, taxYear: number, amountUsd: number) => ({ id, taxYear, amountUsd }) as StoredGrant;
    const picked = recentGrants([g("a", 2018, 9e6), g("b", 2021, 10), g("c", 2022, 30), g("d", 2023, 20), g("e", 2024, 5), g("f", 2024, 50)], 3);
    expect(picked.map((x) => x.id)).toEqual(["f", "c", "d"]);
  });
});

describe("the synthetic Parquet fixture", () => {
  it("is read a window at a time with only the importer's columns", async () => {
    const part = await openPartition(FIXTURE, 2024);
    expect(part!.rows).toBe(10);
    const windows: number[] = [];
    for await (const w of readWindows(part!, GRANT_COLUMNS, 4)) {
      windows.push(w.rows.length);
      expect(Object.keys(w.rows[0])).not.toContain("return_version");
    }
    await part!.close();
    expect(windows).toEqual([4, 4, 2]);
    expect(await openPartition(FIXTURE, 2019)).toBeNull();
    expect(partitionPath("https://example.test/fg/latest/", 2024)).toBe("https://example.test/fg/latest/grants/filing_year=2024/part-0000.parquet");
  });

  it("aggregates per funder: the amendment replaces the original, exclusions are counted, 990 filers left out", async () => {
    const { state, recent, counts } = await importInMemory();
    expect([...state.keys()].sort()).toEqual(["000000101", "000000202"]);
    expect(counts).toMatchObject({ individual: 1, not_paid: 1, no_amount: 1, superseded: 1 });

    const alder = state.get("000000101")!;
    // 2024: 120,000. 2023 (amended): 80,000 + 15,000. 2022: 50,000 + 2,500. The original 2023 filing's 90,000 is not counted.
    expect(alder.totalPaidUsd).toBe(267500);
    expect(alder.grantCount).toBe(5);
    expect(alder.givingByYear).toEqual({ "2022": 52500, "2023": 95000, "2024": 120000 });
    expect(alder.givingByState).toEqual({ NC: 265000, VA: 2500 });
    expect(alder.filings).toEqual({ "2024-12-31": "OBJ-A-2024", "2023-12-31": "OBJ-A-2023-AMEND", "2022-12-31": "OBJ-A-2022" });
    expect(alder).toMatchObject({ name: "ALDER SYNTHETIC FAMILY FOUNDATION INC", state: "NC", firstTaxYear: 2022, lastTaxYear: 2024, latestObjectId: "OBJ-A-2024", latestTaxPeriodEnd: "2024-12-31" });
    // Education by NTEE (B92 at >= 0.90); "after-school reading" for an unresolved recipient reads as education from its purpose ("school"
    // comes first in the table); the food grant, below the confidence minimum, is classified from its purpose.
    expect(alder.givingByCategory).toEqual({ B: 265000, K: 2500 });
    expect(alder.categorySources).toEqual({ ntee: 3, purpose: 2 });
    expect(alder.sizeStats).toMatchObject({ count: 5, min: 2500, max: 120000 });
    expect(recent.get("000000101")!.map((g) => g.amountUsd)).toEqual([120000, 80000, 50000, 15000, 2500]);
    // The recipient EIN is kept only at the minimum confidence.
    expect(recent.get("000000101")!.find((g) => g.amountUsd === 2500)!.recipientEin).toBeNull();

    const birch = state.get("000000202")!;
    expect(birch.givingByState).toEqual({ CA: 250000, foreign: 10000, NC: 1500 });
    // The unknown-type recipient is counted but never listed by name.
    expect(birch.grantCount).toBe(3);
    expect(recent.get("000000202")!.map((g) => g.recipientName)).toEqual(["SYNTHETIC RIVER LAND TRUST", "SYNTHETIC OVERSEAS AID SOCIETY"]);
  });

  it("imports Form 990 Schedule I filers when asked", async () => {
    const { state } = await importInMemory(["990PF", "990"]);
    expect(state.get("000000303")).toMatchObject({ formType: "990", totalPaidUsd: 30000, givingByCategory: { O: 30000 } });
  });

  it("never counts a filing twice when a year is imported again", async () => {
    const segs = new Map<string, FunderSegment>();
    for (const raw of await readYear(2025)) {
      const r = classifyRow(raw, OPTS);
      if (!r.ok) continue;
      const s = segs.get(r.grant.funderEin) ?? new FunderSegment(r.grant.funderEin, OPTS);
      segs.set(r.grant.funderEin, s);
      s.add(r.grant);
    }
    const seg = segs.get("000000101")!;
    const once = mergeFunder(seg.ein, null, [], seg.chosen(), OPTS);
    const twice = mergeFunder(seg.ein, once.state, once.recent, seg.chosen(), OPTS);
    expect(twice.alreadyCounted).toBe(2);
    expect(twice.added).toBe(0);
    expect(twice.state.totalPaidUsd).toBe(once.state.totalPaidUsd);
  });

  it("chooses the latest submitted filing when one partition holds two for a period", () => {
    const seg = new FunderSegment("000000999", OPTS);
    const g = (objectId: string, submittedOn: string, amountUsd: number): CleanGrant => ({
      id: objectId, funderEin: "000000999", funderName: "X", funderState: "NC", formType: "990PF", objectId, taxYear: 2023, taxPeriodEnd: "2023-12-31", submittedOn, amountUsd,
      purpose: null, recipientName: "R", recipientCity: null, recipientState: "NC", recipientEin: null, matchConfidence: null, recipientType: "organization", category: "unclassified", categorySource: "none",
    });
    seg.add(g("OLD", "2024-01-01", 10));
    seg.add(g("NEW", "2024-06-01", 20));
    expect(seg.chosen().map((f) => f.objectId)).toEqual(["NEW"]);
  });
});

describe("source configuration", () => {
  it("chooses years from the setting, the manifest, or 2019 to now", () => {
    expect(importYears("2024, 2021-2022", null)).toEqual([2021, 2022, 2024]);
    expect(importYears(undefined, { datasetVersion: "x", years: [2023, 2024] })).toEqual([2023, 2024]);
    expect(importYears("", null, new Date("2021-06-01"))).toEqual([2019, 2020, 2021]);
  });

  it("reads a manifest's version and years, and tolerates its absence", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ dataset_version: "2026.08.0", partitions: [{ path: "grants/filing_year=2023/part-0000.parquet", rows: 1 }, { path: "grants/filing_year=2024/part-0000.parquet" }] }));
    expect(await readManifest("https://example.test/fg", fetchImpl)).toEqual({ datasetVersion: "2026.08.0", years: [2023, 2024] });
    expect(await readManifest("https://example.test/fg", async () => new Response("nope", { status: 404 }))).toBeNull();
    expect(await readManifest(FIXTURE)).toBeNull();
  });

  it("caches repeated byte ranges and stays under its cap", async () => {
    let reads = 0;
    const file = { byteLength: 100, slice: (s: number, e?: number) => { reads += 1; return new ArrayBuffer((e ?? 100) - s); } };
    const cached = cachedRanges(file, 50);
    await cached.slice(0, 30);
    await cached.slice(0, 30);
    expect(reads).toBe(1);
    await cached.slice(30, 70);
    expect(cached.cachedBytes()).toBeLessThanOrEqual(50);
    await cached.slice(0, 30);
    expect(reads).toBe(3);
  });

  it("reads a remote partition with range requests through the given fetch", async () => {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(partitionPath(FIXTURE, 2025));
    const ranges: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (!url.endsWith("filing_year=2025/part-0000.parquet")) return new Response(null, { status: 404 });
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(bytes.length) } });
      const range = new Headers(init?.headers).get("Range")!;
      ranges.push(range);
      const [, s, e] = range.match(/bytes=(\d+)-(\d*)/)!;
      const chunk = bytes.subarray(Number(s), e ? Number(e) + 1 : bytes.length);
      return new Response(chunk, { status: 206 });
    };
    expect(await openPartition("https://example.test/fg", 2024, { fetchImpl })).toBeNull();
    const part = await openPartition("https://example.test/fg", 2025, { fetchImpl });
    const rows: unknown[] = [];
    for await (const w of readWindows(part!, GRANT_COLUMNS, 100)) rows.push(...w.rows);
    expect(rows).toHaveLength(3);
    expect(ranges.length).toBeGreaterThan(0);
  });
});

describe("profiles and suggestions", () => {
  it("labels history, formats EINs and gives filing links without inventing a per-filing URL", () => {
    expect(HISTORY_LABEL).toBe("Funding history from tax filings, not an open call");
    expect(formatEin("000000101")).toBe("00-0000101");
    expect(filingLinks("000000101", "OBJ-1")).toMatchObject({ objectId: "OBJ-1", irsDownloads: expect.stringMatching(/^https:\/\/www\.irs\.gov\//), propublica: "https://projects.propublica.org/nonprofits/organizations/000000101" });
  });

  it("finds causes in focus areas and mission, and states reasons without overclaiming", () => {
    const causes = causesFor({ state: "NC", focusAreas: ["literacy", "youth mentoring"], mission: "We fight hunger." });
    expect(causes.map((c) => c.key)).toEqual(["B", "O", "K"]);
    const reasons = suggestionReasons(
      { ein: "000000101", name: "X", state: "NC", totalPaidUsd: 200000, firstTaxYear: 2022, lastTaxYear: 2024, givingByState: { NC: 150000 }, givingByCategory: { B: 100000 }, categorySources: { ntee: 1, purpose: 3 } },
      "NC",
      causes,
    );
    expect(reasons[0]).toBe("Paid $150,000 to recipients in NC (75% of its giving), tax years 2022–2024.");
    expect(reasons).toContain("Paid $100,000 to education recipients, all states.");
    expect(reasons.some((r) => /approximate/.test(r))).toBe(true);
    expect(reasons.at(-1)).toMatch(/does not show that its in-state grants were for your cause/);
  });
});
