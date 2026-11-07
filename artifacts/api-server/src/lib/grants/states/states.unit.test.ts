import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { evaluateGate } from "../gate";
import { FEED_CONNECTORS, validateSource } from "../sources/registry";
import { TooFewRowsError, dollarRange, httpsUrl, usDate } from "./common";
import { IL_LIST_URL, fetchIlRecords, ilDateRange, normalizeIlRow, parseIlOpportunityList } from "./illinois";
import { NC_DIRECTORY_URL, fetchNcRecords, normalizeNcRow, parseNcDirectory } from "./northCarolina";
import { UT_NO_RENDERER, fetchUtRecords, normalizeUtCard, parseUtCards, utUrl } from "./utah";
import { STATE_FEEDS, STATE_SOURCE_LABELS } from "./index";

/**
 * State feed connectors (docs/SOURCE_REGISTRY.md §7), parsed against pages
 * recorded on 7 November 2026 (Illinois, North Carolina; trimmed, markup
 * unchanged) and a synthetic Utah card page (the Looker Studio report cannot be
 * recorded without a browser). Hermetic: no network, no database.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const NOW = new Date("2026-11-07T12:00:00Z");

describe("shared parsing", () => {
  it("reads dollar ranges without guessing", () => {
    expect(dollarRange("$1000 - $250000")).toEqual([1000, 250000]);
    expect(dollarRange("$0 - $250000")).toEqual([250000, 250000]);
    expect(dollarRange("$0 - $0")).toEqual([null, null]);
    expect(dollarRange("Up to $2,500.50")).toEqual([2500.5, 2500.5]);
    expect(dollarRange("Varies by project")).toEqual([null, null]);
  });

  it("reads US dates and rejects impossible ones", () => {
    expect(usDate("11/02/2026")).toBe("2026-11-02");
    expect(usDate("2/30/2026")).toBeNull();
    expect(usDate("No end date")).toBeNull();
  });

  it("keeps only https links", () => {
    expect(httpsUrl("//host.example.gov/a")).toBe("https://host.example.gov/a");
    expect(httpsUrl("http://host.example.gov/a")).toBeNull();
    expect(httpsUrl("TBD")).toBeNull();
    expect(httpsUrl("Opportunity.aspx?nofo=1", IL_LIST_URL)).toBe("https://omb.illinois.gov/public/gata/csfa/Opportunity.aspx?nofo=1");
  });
});

describe("Illinois CSFA opportunity list", () => {
  const rows = parseIlOpportunityList(fixture("il-csfa-opportunity-list.html"));

  it("parses every row of the recorded table, in both link shapes", () => {
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({
      title: "FY27 406-01-3252 Local Food Infrastructure Grant (LFIG)",
      url: "https://il.amplifund.com/Public/Opportunities/Details/9591a098-92f5-4a81-b8c7-47651ac5bc22",
      ref: "gms-9591a098-92f5-4a81-b8c7-47651ac5bc22",
      agency: "AG (406)",
      dateRange: "11/02/2026 - 01/06/2027",
      awardRange: "$1000 - $250000",
    });
    const nofo = rows.find((r) => r.ref === "nofo-2010")!;
    expect(nofo).toMatchObject({ title: "Community Development Block Grant Disaster Response Program", url: "https://omb.illinois.gov/public/gata/csfa/Opportunity.aspx?nofo=2010", dateRange: "04/05/2022 - No end date" });
    // granted's original markup: a relative, single-quoted GMS.aspx link; entities decoded.
    const legacy = rows[rows.length - 1];
    expect(legacy).toMatchObject({ title: "Synthetic Legacy Row & Test", url: "https://il.amplifund.com/Public/Opportunities/Details/00000000-0000-4000-8000-000000000001", ref: "gms-00000000-0000-4000-8000-000000000001" });
  });

  it("reads the application window", () => {
    expect(ilDateRange("11/02/2026 - 01/06/2027")).toEqual({ openDate: "2026-11-02", closeDate: "2027-01-06", noEndDate: false });
    expect(ilDateRange("04/03/2025 - No end date")).toEqual({ openDate: "2025-04-03", closeDate: null, noEndDate: true });
    expect(ilDateRange("")).toEqual({ openDate: null, closeDate: null, noEndDate: false });
  });

  it("normalizes rows into gated state listings", () => {
    const lfig = normalizeIlRow(rows[0], NOW)!;
    expect(lfig).toMatchObject({ sourceRef: "gms-9591a098-92f5-4a81-b8c7-47651ac5bc22", status: "posted", openDate: "2026-11-02", closeDate: "2027-01-06", rollingDeadline: false, awardFloor: 1000, awardCeiling: 250000, jurisdiction: "IL", eligibilityCodes: [] });
    expect(lfig.description).toMatch(/Application period as listed: 11\/02\/2026 - 01\/06\/2027/);
    expect(evaluateGate({ ...lfig, fetchedAt: NOW }, NOW)).toEqual({ publishable: true, missing: [] });

    // "No end date" is the State's own statement, kept as a rolling deadline (as California's "Ongoing").
    const open = normalizeIlRow(rows.find((r) => r.ref === "nofo-2010")!, NOW)!;
    expect(open).toMatchObject({ status: "posted", closeDate: null, rollingDeadline: true, awardFloor: 250000, awardCeiling: 250000 });
    expect(evaluateGate({ ...open, fetchedAt: NOW }, NOW).publishable).toBe(true);

    // "$0 - $0" is no amount.
    const hava = normalizeIlRow(rows.find((r) => /Polling Place/.test(r.title))!, NOW)!;
    expect([hava.awardFloor, hava.awardCeiling]).toEqual([null, null]);

    // Before the window opens it is forecasted; after it ends it is closed and never published.
    expect(normalizeIlRow(rows[0], new Date("2026-10-01T00:00:00Z"))!.status).toBe("forecasted");
    const late = normalizeIlRow(rows[0], new Date("2027-02-01T00:00:00Z"))!;
    expect(late.status).toBe("closed");
    expect(evaluateGate({ ...late, fetchedAt: NOW }, new Date("2027-02-01T00:00:00Z")).publishable).toBe(false);
  });

  it("skips rows it cannot read instead of guessing", () => {
    const html = "<table><tbody><tr><td>No link</td><td>A</td><td>01/01/2026 - 01/02/2026</td><td>$1</td></tr><tr><td><a href='javascript:void(0)'>Script link</a></td><td>A</td><td>x</td><td>y</td></tr><tr><td>Three</td><td>cells</td><td>only</td></tr></tbody></table>";
    expect(parseIlOpportunityList(html)).toEqual([]);
  });

  it("fetches the list and refuses a page that parses too few rows", async () => {
    const seen: string[] = [];
    const ok = await fetchIlRecords(async (url) => (seen.push(url), { status: 200, body: fixture("il-csfa-opportunity-list.html") }), NOW, 5);
    expect(seen).toEqual([IL_LIST_URL]);
    expect(ok).toHaveLength(7);
    await expect(fetchIlRecords(async () => ({ status: 200, body: "<html>maintenance</html>" }), NOW)).rejects.toBeInstanceOf(TooFewRowsError);
    await expect(fetchIlRecords(async () => ({ status: 503, body: "" }), NOW)).rejects.toThrow(/HTTP 503/);
  });
});

describe("NC.gov grant opportunities directory", () => {
  const rows = parseNcDirectory(fixture("nc-grant-opportunities.html"));

  it("parses the recorded table, skipping the details control column, and the older flat shape", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      category: "Agriculture",
      url: "https://www.ncadfp.org/",
      title: "Agricultural Development and Farmland Preservation Trust Fund",
      agency: "AGR",
      description: "This program supports the farming, forestry, and horticulture communities within the agriculture industry.",
    });
    expect(rows[3].category).toBe("Art & Culture");
    expect(rows[4]).toMatchObject({ category: "Synthetic", title: "Synthetic Legacy Program & Fund", url: "https://www.example.nc.gov/legacy" });
  });

  it("stores directory entries as listed, never publishable, with nothing guessed", () => {
    const rec = normalizeNcRow(rows[1])!;
    expect(rec).toMatchObject({ status: "listed", closeDate: null, rollingDeadline: false, awardFloor: null, awardCeiling: null, eligibilityText: null, categories: ["Agriculture"], jurisdiction: "NC", officialUrl: "https://www.labor.nc.gov/safety-and-health/agricultural-safety-and-health/funding-resources-migrant-housing" });
    expect(rec.sourceRef).toMatch(/^nc-[0-9a-f]{12}$/);
    expect(rec.description).toMatch(/does not state deadlines/);
    expect(evaluateGate({ ...rec, fetchedAt: NOW }, NOW)).toEqual({ publishable: false, missing: ["open status (posted or forecasted)"] });
  });

  it("finds no rows without a table body, and refuses too few", async () => {
    expect(parseNcDirectory("<p>No table</p>")).toEqual([]);
    expect(await fetchNcRecords(async (url) => ({ status: url === NC_DIRECTORY_URL ? 200 : 404, body: fixture("nc-grant-opportunities.html") }), 5)).toHaveLength(5);
    await expect(fetchNcRecords(async () => ({ status: 200, body: fixture("nc-grant-opportunities.html") }))).rejects.toBeInstanceOf(TooFewRowsError);
  });
});

describe("Utah Funding Opportunities Portal", () => {
  const cards = parseUtCards(fixture("ut-looker-cards.synthetic.html"));

  it("parses rendered cards and drops a card with no title", () => {
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({
      title: "Synthetic Rural Trails Grant",
      category: "Outdoor Recreation",
      agency: "Synthetic Office of Outdoor Recreation",
      amount: "Up to $250,000",
      grantMatch: "50%",
      loanInterest: "N/A",
      description: "Supports trail building & maintenance in rural communities.",
      url: "https://example.utah.gov/trails",
    });
  });

  it("normalizes cards as listed, with links and amounts only as stated", () => {
    const [trails, water, credit] = cards.map((c) => normalizeUtCard(c)!);
    expect(trails).toMatchObject({ status: "listed", awardFloor: null, awardCeiling: 250000, officialUrl: "https://example.utah.gov/trails", jurisdiction: "UT", categories: ["Outdoor Recreation"] });
    expect(trails.description).toMatch(/Grant match as listed: 50%/);
    expect(water).toMatchObject({ awardFloor: 50000, awardCeiling: 2000000, officialUrl: "https://example.utah.gov/water" });
    expect(water.description).toMatch(/Funding type: Loan \(loan interest as listed: 2\.5%\)/);
    // A placeholder "Learn More" is no link; the gate then refuses it twice over.
    expect(credit).toMatchObject({ officialUrl: "", awardCeiling: null });
    expect(credit.description).toMatch(/Funding type: Tax credit/);
    expect(evaluateGate({ ...credit, fetchedAt: NOW }, NOW).missing).toEqual(["official https source", "open status (posted or forecasted)"]);
    expect(utUrl("http://insecure.example")).toBeNull();
  });

  it("cannot run without a browser renderer, and says so", async () => {
    await expect(fetchUtRecords(null)).rejects.toThrow(UT_NO_RENDERER);
    const html = fixture("ut-looker-cards.synthetic.html");
    expect(await fetchUtRecords(async () => html, 3)).toHaveLength(3);
    await expect(fetchUtRecords(async () => html)).rejects.toBeInstanceOf(TooFewRowsError);
  });
});

describe("registry wiring", () => {
  it("names a connector in code for every state feed, and accepts each as a disabled feed row", () => {
    for (const feed of STATE_FEEDS) {
      expect(FEED_CONNECTORS).toContain(feed.source);
      expect(STATE_SOURCE_LABELS[feed.source]).toBe(feed.name);
      const row = validateSource({ key: feed.source, name: feed.name, jurisdictionKind: "state", jurisdictionCode: feed.jurisdiction, connectorType: "feed", connector: feed.source, urls: [feed.url], status: "disabled" });
      expect(row.ok, feed.source).toBe(true);
      // The terms rule still holds: no state feed can be activated without checked terms that permit automation.
      const active = validateSource({ key: feed.source, name: feed.name, jurisdictionKind: "state", jurisdictionCode: feed.jurisdiction, connectorType: "feed", connector: feed.source, urls: [feed.url], status: "active" });
      expect(active.ok).toBe(false);
    }
  });
});
