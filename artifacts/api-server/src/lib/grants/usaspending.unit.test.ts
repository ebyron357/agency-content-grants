/**
 * USAspending past awards, without a network or a database: request bodies
 * against the published contract, parsing of the synthetic fixtures, the
 * summaries, and failures.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { awardsRequest, countRequest, fiscalYear, normalizeProgramNumber, parseAwards, parseCount, readListing, searchWindow, summarize, UsaspendingError, type FetchLike } from "./usaspending";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/usaspending");
const awardsBody = JSON.parse(readFileSync(join(DIR, "spending_by_award.json"), "utf8"));
const countBody = JSON.parse(readFileSync(join(DIR, "spending_by_award_count.json"), "utf8"));
const NOW = new Date("2026-11-06T12:00:00Z");

describe("requests", () => {
  it("asks for grants under one listing, newest first, over four fiscal years", () => {
    expect(searchWindow(NOW)).toEqual({ start: "2023-10-01", end: "2026-11-06" });
    const body = awardsRequest("10.500", searchWindow(NOW));
    expect(body).toMatchObject({ sort: "Start Date", order: "desc", limit: 100, page: 1, subawards: false });
    expect(body.filters).toEqual({ program_numbers: ["10.500"], award_type_codes: ["02", "03", "04", "05"], time_period: [{ start_date: "2023-10-01", end_date: "2026-11-06" }] });
    expect(body.fields).toContain("Recipient Location");
    expect(countRequest("10.500", searchWindow(NOW)).filters.program_numbers).toEqual(["10.500"]);
  });

  it("accepts only Assistance Listing numbers", () => {
    expect(normalizeProgramNumber(" 84.425u ")).toBe("84.425U");
    expect(normalizeProgramNumber("10.500")).toBe("10.500");
    expect(normalizeProgramNumber("10.5")).toBeNull();
    expect(normalizeProgramNumber("10.500; DROP")).toBeNull();
  });

  it("counts fiscal years from October", () => {
    expect(fiscalYear("2025-09-30")).toBe(2025);
    expect(fiscalYear("2025-10-01")).toBe(2026);
    expect(fiscalYear("bad")).toBeNull();
  });
});

describe("parsing and summaries", () => {
  const awards = parseAwards(awardsBody);

  it("keeps recipient, amount, year and state, and skips zero awards", () => {
    expect(awards).toHaveLength(5);
    expect(awards[0]).toEqual({ awardId: "SYN-24-0001", generatedId: "ASST_NON_SYN240001_9999", recipient: "PIEDMONT SYNTHETIC LITERACY COUNCIL", amountUsd: 250000, startDate: "2026-08-15", fiscalYear: 2026, state: "NC" });
    expect(awards.find((a) => a.recipient.includes("INTERNATIONAL"))!.state).toBeNull();
    expect(parseCount(countBody)).toBe(6);
    expect(() => parseAwards({ detail: "error" })).toThrow(/results list/);
  });

  it("summarizes sizes, years, states and in-state winners", () => {
    const s = summarize(awards, "NC");
    expect(s.amounts).toEqual({ min: 60000, p25: 125000, median: 250000, p75: 480000, max: 900000, total: 1815000 });
    expect(s.byFiscalYear).toEqual([
      { fiscalYear: 2026, count: 3, usd: 855000 },
      { fiscalYear: 2025, count: 2, usd: 960000 },
    ]);
    expect(s.topStates[0]).toEqual({ state: "NC", count: 2, usd: 375000 });
    expect(s.inState).toMatchObject({ state: "NC", count: 2, usd: 375000 });
    expect(s.inState!.awards.map((a) => a.recipient)).toEqual(["PIEDMONT SYNTHETIC LITERACY COUNCIL", "SYNTHETIC COASTAL READING PROJECT"]);
    expect(summarize([], null)).toMatchObject({ sampleSize: 0, amounts: null, inState: null });
  });
});

describe("readListing", () => {
  it("posts both searches and reads the fixtures", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(url.includes("_count") ? countBody : awardsBody), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const r = await readListing("10.500", { apiBase: "https://example.test/", fetchImpl, now: NOW });
    expect(calls.map((c) => c.url)).toEqual(["https://example.test/api/v2/search/spending_by_award/", "https://example.test/api/v2/search/spending_by_award_count/"]);
    expect(r).toMatchObject({ programNumber: "10.500", totalAwards: 6, window: { start: "2023-10-01" } });
    expect(r.awards).toHaveLength(5);
  });

  it("reports an unreachable API as retryable and a rejected request as permanent", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(readListing("10.500", { fetchImpl: down, now: NOW })).rejects.toMatchObject({ permanent: false, message: expect.stringMatching(/could not be reached/) });
    const rejected: FetchLike = async () => new Response("{}", { status: 422 });
    const err = await readListing("10.500", { fetchImpl: rejected, now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(UsaspendingError);
    expect(err.permanent).toBe(true);
    const busy: FetchLike = async () => new Response("{}", { status: 503 });
    expect((await readListing("10.500", { fetchImpl: busy, now: NOW }).catch((e) => e)).permanent).toBe(false);
  });
});
