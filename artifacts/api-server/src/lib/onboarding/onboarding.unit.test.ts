/**
 * Hermetic tests for self sign-up configuration, outgoing email and the EIN
 * lookup parser. No database and no network: the ProPublica response is a
 * synthetic fixture in the documented shape.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchOrganization, formatEin, fullAddress, normalizeEin, parseOrganization, revenueBand, setNonprofitFetchForTests, tidyCase } from "./propublica";
import { GENERAL_FOCUS_AREAS, suggestedFocusAreas } from "./focusAreas";
import { emailConfig, resendTransport, setEmailTransportForTests } from "../email/transport";
import { signupConfig, verificationEmail, verifyLink } from "../signup/config";

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "propublica-organization.json"), "utf8"));

afterEach(() => {
  setNonprofitFetchForTests(null);
  setEmailTransportForTests(null);
});

describe("EIN handling", () => {
  it("accepts the dashed and plain forms and rejects anything else", () => {
    expect(normalizeEin("12-3456789")).toBe("123456789");
    expect(normalizeEin(" 123456789 ")).toBe("123456789");
    expect(normalizeEin("12345678")).toBeNull();
    expect(normalizeEin("12-34567890")).toBeNull();
    expect(normalizeEin("AB-CDEFGHI")).toBeNull();
    expect(normalizeEin("00-0000000")).toBeNull();
    expect(normalizeEin(123456789)).toBeNull();
    expect(formatEin("123456789")).toBe("12-3456789");
  });
});

describe("ProPublica organization parsing", () => {
  it("reads only the fields the wizard uses, from the latest filing with revenue", () => {
    const r = parseOrganization(fixture, "000000201")!;
    expect(r).toMatchObject({
      ein: "000000201",
      name: "Piedmont Synthetic Literacy Council Inc",
      address: "100 Example St",
      city: "Durham",
      state: "NC",
      nteeCode: "B92",
      nteeGroup: "B",
      nteeLabel: "Education",
      subsectionCode: 3,
      revenue: 412500,
      revenueYear: 2023,
      revenueFrom: "filing",
      profileUrl: "https://projects.propublica.org/nonprofits/organizations/000000201",
    });
    expect(fullAddress(r)).toBe("100 Example St, Durham, NC 27701-0000");
    expect(Object.keys(r).sort()).toEqual(["address", "city", "ein", "name", "nteeCode", "nteeGroup", "nteeLabel", "profileUrl", "revenue", "revenueFrom", "revenueYear", "state", "subsectionCode", "zipcode"]);
  });

  it("falls back to the master file revenue when no filing has data", () => {
    const r = parseOrganization({ organization: { ...fixture.organization }, filings_with_data: [] }, "000000201")!;
    expect(r.revenue).toBe(398000);
    expect(r.revenueYear).toBe(2022);
    expect(r.revenueFrom).toBe("master_file");
  });

  it("returns null for a body without an organization, and tolerates missing fields", () => {
    expect(parseOrganization({}, "000000201")).toBeNull();
    expect(parseOrganization({ organization: { ein: 5 } }, "000000005")).toBeNull();
    const bare = parseOrganization({ organization: { name: "Bare Org", state: "north carolina" } }, "000000005")!;
    expect(bare).toMatchObject({ name: "Bare Org", state: null, nteeGroup: null, revenue: null, revenueFrom: null });
  });

  it("puts revenue in plain bands", () => {
    expect(revenueBand(0)).toBe("Under $50,000");
    expect(revenueBand(49_999)).toBe("Under $50,000");
    expect(revenueBand(50_000)).toBe("$50,000 to $249,999");
    expect(revenueBand(412_500)).toBe("$250,000 to $999,999");
    expect(revenueBand(30_000_000)).toBe("$25 million or more");
    expect(revenueBand(null)).toBeNull();
    expect(revenueBand(-5)).toBeNull();
  });

  it("tidies all-capitals IRS text only", () => {
    expect(tidyCase("FRIENDS OF THE LIBRARY INC")).toBe("Friends of the Library Inc");
    expect(tidyCase("Already Mixed Case")).toBe("Already Mixed Case");
  });
});

describe("ProPublica fetch outcomes", () => {
  const answer = (status: number, body?: unknown, throws = false) =>
    setNonprofitFetchForTests(async (url) => {
      expect(url).toBe("https://projects.propublica.org/nonprofits/api/v2/organizations/000000201.json");
      if (throws) throw new Error("ECONNREFUSED");
      return { status, ok: status >= 200 && status < 300, json: async () => body };
    });

  it("found", async () => {
    answer(200, fixture);
    const out = await fetchOrganization("000000201", {});
    expect(out.kind).toBe("found");
  });
  it("unknown EIN (404) is not found", async () => {
    answer(404);
    expect(await fetchOrganization("000000201", {})).toEqual({ kind: "not_found" });
  });
  it("an error answer or no network is unavailable, with a plain reason", async () => {
    answer(503);
    expect(await fetchOrganization("000000201", {})).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("HTTP 503") });
    answer(0, undefined, true);
    expect(await fetchOrganization("000000201", {})).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("could not be reached") });
  });
  it("the owner can turn the lookup off", async () => {
    answer(200, fixture);
    expect(await fetchOrganization("000000201", { NONPROFIT_LOOKUP_DISABLED: "true" })).toMatchObject({ kind: "unavailable" });
  });
});

describe("focus area suggestions", () => {
  it("lead with the organization's cause and never repeat", () => {
    const areas = suggestedFocusAreas("B");
    expect(areas.slice(0, 4)).toEqual(["education", "literacy", "STEM education", "after-school"]);
    expect(new Set(areas).size).toBe(areas.length);
    expect(suggestedFocusAreas(null)).toEqual(GENERAL_FOCUS_AREAS.slice(0, 12));
  });
});

describe("email configuration", () => {
  it("needs a provider; resend needs its key and sender; log is refused in production", () => {
    expect(emailConfig({})).toMatchObject({ provider: null, ready: false, missing: ["EMAIL_PROVIDER"] });
    expect(emailConfig({ EMAIL_PROVIDER: "resend" })).toMatchObject({ ready: false, missing: ["RESEND_API_KEY", "EMAIL_FROM"] });
    expect(emailConfig({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_x", EMAIL_FROM: "GrantCrest <hello@example.org>" }).ready).toBe(true);
    expect(emailConfig({ EMAIL_PROVIDER: "log", NODE_ENV: "development" }).ready).toBe(true);
    expect(emailConfig({ EMAIL_PROVIDER: "log", NODE_ENV: "production" })).toMatchObject({ ready: false, problem: expect.stringContaining("not allowed in production") });
    expect(emailConfig({ EMAIL_PROVIDER: "carrier-pigeon" }).problem).toContain("not supported");
  });

  it("sends through Resend's HTTP API without logging the key", async () => {
    const calls: { url: string; init: any }[] = [];
    const transport = resendTransport({ RESEND_API_KEY: "re_test_key", EMAIL_FROM: "GrantCrest <hello@example.org>" }, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{}" };
    });
    await transport.send({ to: "person@example.org", subject: "S", text: "T", tag: "signup_verify" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.headers.Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ from: "GrantCrest <hello@example.org>", to: ["person@example.org"], subject: "S", text: "T" });
    const failing = resendTransport({ RESEND_API_KEY: "k", EMAIL_FROM: "f@example.org" }, async () => ({ ok: false, status: 422, text: async () => "person@example.org is invalid" }));
    await expect(failing.send({ to: "person@example.org", subject: "S", text: "T", tag: "x" })).rejects.toThrow(/^Email provider returned HTTP 422$/);
  });
});

describe("self sign-up switch", () => {
  const ready = { SELF_SIGNUP_ENABLED: "true", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "f@example.org", APP_BASE_URL: "https://app.example.org" };

  it("is off unless the flag is exactly true", () => {
    expect(signupConfig({}).enabled).toBe(false);
    expect(signupConfig({ ...ready, SELF_SIGNUP_ENABLED: "1" }).enabled).toBe(false);
    expect(signupConfig({ ...ready, SELF_SIGNUP_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(signupConfig(ready).enabled).toBe(true);
  });

  it("stays off, naming what is missing, without email or a base URL", () => {
    expect(signupConfig({ SELF_SIGNUP_ENABLED: "true" })).toMatchObject({ flag: true, enabled: false, missing: ["EMAIL_PROVIDER", "APP_BASE_URL"] });
    expect(signupConfig({ ...ready, APP_BASE_URL: "" })).toMatchObject({ enabled: false, missing: ["APP_BASE_URL"] });
    expect(signupConfig({ SELF_SIGNUP_ENABLED: "true", EMAIL_PROVIDER: "log", NODE_ENV: "production", APP_BASE_URL: "https://x.example" }).enabled).toBe(false);
  });

  it("uses the Starter trial unless the owner names another plan", () => {
    expect(signupConfig(ready).trialPlan).toBe("starter");
    expect(signupConfig({ ...ready, SELF_SIGNUP_TRIAL_PLAN: "pro" }).trialPlan).toBe("pro");
  });

  it("puts the token in the link's fragment, so it never reaches a server log", () => {
    const link = verifyLink("tok_abc", { APP_BASE_URL: "https://app.example.org/" });
    expect(link).toBe("https://app.example.org/signup/verify#token=tok_abc");
    expect(new URL(link).pathname).toBe("/signup/verify");
    expect(verificationEmail("Ada", "Org", link).text).toContain(link);
  });
});
