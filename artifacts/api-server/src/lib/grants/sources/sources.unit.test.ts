/**
 * Hermetic tests for the source registry (docs/SOURCE_REGISTRY.md): registry
 * validation and the terms rule, freshness, page text and links, extraction
 * parsing and grounding with recorded (mocked) AI answers, the demo path,
 * approval through the publication gate, draft edits, the webhook secret, the
 * changedetection.io client with a fake API, the backend selection, and the
 * built-in fetcher's rate limit and User-Agent. No database or network.
 */
import { describe, expect, it } from "vitest";
import { freshness, isDue, mayRun, slugKey, urlProblem, validateSource, defaultStaleDays } from "./registry";
import { amountAppearsIn, contentHash, dateAppearsIn, demoDraft, extractCandidates, extractLinks, htmlPageToText, isoDate, parseJsonBlock, validateCandidates, cheapModelFor, eligibilityCodesFor, type PageSnapshot } from "./extraction";
import { approvalCheck, opportunityFromDraft, pageSourceKey, validateDraftEdit, type DraftForPromotion } from "./promote";
import { MIN_SECRET_LENGTH, NOTIFICATION_BODY, notificationUrl, parseChangeNotification, verifyWebhookSecret, webhookSecret } from "./webhookAuth";
import { ChangeDetectionClient, watcherSettings, type FetchFn } from "./changedetection";
import { DEFAULT_USER_AGENT, HostRateLimiter, userAgent } from "./fetcher";

const NOW = new Date("2026-11-05T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const pageSource = {
  name: "Prairie Community Foundation open calls",
  jurisdictionKind: "foundation",
  connectorType: "watched_page",
  urls: ["https://www.prairie-foundation.example.org/grants/open"],
  scheduleHours: 24,
  owner: "ebyron357",
  termsNote: "Site terms (read 5 Nov 2026) allow automated access to public pages.",
  termsChecked: true,
  termsPermitAutomation: true,
  status: "active",
};

describe("registry validation", () => {
  it("accepts a page source and derives its key", () => {
    const v = validateSource(pageSource);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toMatchObject({ key: "prairie_community_foundation_open_calls", jurisdictionCode: null, connector: null, status: "active", scheduleHours: 24 });
    expect(slugKey("Illinois GATA — Grants!")).toBe("illinois_gata_grants");
  });

  it("keeps a source disabled until its terms are checked and permit automated reading", () => {
    const unchecked = validateSource({ ...pageSource, termsChecked: false, termsPermitAutomation: false });
    expect(unchecked.ok).toBe(false);
    if (!unchecked.ok) expect(unchecked.errors).toContain("A source stays disabled until its terms of use are checked.");
    const forbids = validateSource({ ...pageSource, termsPermitAutomation: false });
    expect(forbids.ok).toBe(false);
    if (!forbids.ok) expect(forbids.errors).toContain("A source whose terms do not permit automated reading stays disabled.");
    // Recorded as disabled, both are fine: the row exists, it just never runs.
    expect(validateSource({ ...pageSource, termsChecked: false, termsPermitAutomation: false, status: "disabled" }).ok).toBe(true);
    expect(validateSource({ ...pageSource, termsPermitAutomation: false, status: "disabled" }).ok).toBe(true);
    // New rows default to disabled.
    const { status: _s, ...noStatus } = pageSource;
    const def = validateSource({ ...noStatus, termsChecked: false, termsPermitAutomation: false });
    expect(def.ok && def.value.status).toBe("disabled");
    // "Permits automation" cannot be recorded without checking the terms, and a check needs a note.
    const noCheck = validateSource({ ...pageSource, status: "disabled", termsChecked: false });
    expect(!noCheck.ok && noCheck.errors).toContain("Check the terms of use before recording that they permit automated reading.");
    const noNote = validateSource({ ...pageSource, termsNote: "" });
    expect(!noNote.ok && noNote.errors).toContain("Record what the terms of use say (and where) when marking them checked.");
  });

  it("lists every problem with where it is", () => {
    const v = validateSource({ name: "", jurisdictionKind: "county", connectorType: "scraper", urls: ["http://10.0.0.1/x", "ftp://a.example.org"], scheduleHours: 1 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toEqual(expect.arrayContaining([
        "Enter a name.",
        "The jurisdiction must be one of: federal, state, foundation, corporate.",
        "The connector type must be one of: feed, portal_page, watched_page.",
        "URL 1 must use https.",
        "URL 2 must use https.",
      ]));
    }
  });

  it("requires a state code for state sources and a code connector for feeds", () => {
    const state = validateSource({ ...pageSource, jurisdictionKind: "state", connectorType: "portal_page" });
    expect(!state.ok && state.errors).toContain("A state source needs its two-letter state code (for example IL).");
    const il = validateSource({ ...pageSource, jurisdictionKind: "state", jurisdictionCode: "il", connectorType: "portal_page", name: "Illinois GATA CSFA" });
    expect(il.ok && il.value.jurisdictionCode).toBe("IL");
    const feed = validateSource({ ...pageSource, connectorType: "feed", connector: "socrata_generic" });
    expect(!feed.ok && feed.errors[0]).toMatch(/A feed needs a connector in code/);
    // Foundations never carry a state code.
    const f = validateSource({ ...pageSource, jurisdictionCode: "IL" });
    expect(f.ok && f.value.jurisdictionCode).toBeNull();
  });

  it("checks pages no more often than every 6 hours", () => {
    expect(validateSource({ ...pageSource, scheduleHours: 2 }).ok).toBe(false);
    expect(validateSource({ ...pageSource, scheduleHours: 6 }).ok).toBe(true);
    expect(validateSource({ ...pageSource, scheduleHours: 1.5 }).ok).toBe(false);
  });

  it("refuses URLs that are not public https host names", () => {
    expect(urlProblem("https://grants.illinois.gov/x")).toBeNull();
    expect(urlProblem("http://grants.illinois.gov/x")).toBe("must use https");
    expect(urlProblem("https://user:pw@grants.illinois.gov/")).toBe("must not contain a user name or password");
    expect(urlProblem("https://127.0.0.1/")).toBe("must use a host name, not an IP address");
    expect(urlProblem("https://[::1]/")).toBe("must use a host name, not an IP address");
    expect(urlProblem("https://localhost/")).toBe("must be a public host name");
    expect(urlProblem("https://intranet/")).toBe("must be a public host name");
    expect(urlProblem("not a url")).toBe("is not a valid URL");
  });
});

describe("running and freshness", () => {
  const running = { status: "active", termsChecked: true, termsPermitAutomation: true, staleAfterDays: null };

  it("runs only active sources with checked, permissive terms", () => {
    expect(mayRun(running)).toBe(true);
    expect(mayRun({ ...running, status: "paused" })).toBe(false);
    expect(mayRun({ ...running, termsChecked: false })).toBe(false);
    expect(mayRun({ ...running, termsPermitAutomation: false })).toBe(false);
  });

  it("is due when never checked or past its schedule", () => {
    expect(isDue({ scheduleHours: 24, lastCheckedAt: null }, NOW)).toBe(true);
    expect(isDue({ scheduleHours: 24, lastCheckedAt: new Date(NOW.getTime() - 23 * 3_600_000) }, NOW)).toBe(false);
    expect(isDue({ scheduleHours: 24, lastCheckedAt: new Date(NOW.getTime() - 24 * 3_600_000) }, NOW)).toBe(true);
  });

  it("marks a source stale after its window, using SOURCE_STALE_DAYS by default", () => {
    expect(freshness({ ...running, lastSuccessAt: daysAgo(1) }, NOW, 3)).toMatchObject({ state: "fresh", ageDays: 1, staleAfterDays: 3 });
    expect(freshness({ ...running, lastSuccessAt: daysAgo(4) }, NOW, 3)).toMatchObject({ state: "stale", ageDays: 4, label: "Stale: no successful check for 4 days" });
    expect(freshness({ ...running, staleAfterDays: 7, lastSuccessAt: daysAgo(4) }, NOW, 3).state).toBe("fresh");
    expect(freshness({ ...running, lastSuccessAt: null }, NOW, 3).state).toBe("never");
    // A source that does not run is never reported fresh.
    expect(freshness({ ...running, status: "disabled", lastSuccessAt: daysAgo(0) }, NOW, 3)).toMatchObject({ state: "not_running", label: "Not running (disabled)" });
    expect(defaultStaleDays({ SOURCE_STALE_DAYS: "5" })).toBe(5);
    expect(defaultStaleDays({ SOURCE_STALE_DAYS: "0" })).toBe(3);
    expect(defaultStaleDays({})).toBe(3);
  });
});

const PAGE_HTML = `<!doctype html><html><head><title>Open calls</title><script>var nonce="abc123";</script><style>p{}</style></head>
<body><nav><a href="/">Home</a></nav>
<h1>Grant opportunities</h1>
<h2>Rural Health Access Fund</h2>
<p>The Prairie Community Foundation invites proposals from 501(c)(3) nonprofits serving rural counties. Awards range from $10,000 to $50,000.</p>
<p>Applications are due December 15, 2026. <a href="/grants/rural-health">Read the guidelines</a></p>
<h2>Small Business Resilience Grants</h2>
<p>Local small businesses may apply. Grants of up to $25K. Applications are accepted on a rolling basis until funds are exhausted.</p>
<p><a href="https://apply.prairie-foundation.example.org/resilience">Apply online</a> &amp; <a href="mailto:grants@prairie-foundation.example.org">email us</a></p>
<!-- a comment that is not content -->
</body></html>`;

const BASE_URL = "https://www.prairie-foundation.example.org/grants/open";
const page: PageSnapshot = { url: BASE_URL, text: htmlPageToText(PAGE_HTML), links: extractLinks(PAGE_HTML, BASE_URL), checkedAt: NOW };

describe("page text and links", () => {
  it("keeps the readable text and drops scripts, styles and comments", () => {
    expect(page.text).toContain("Rural Health Access Fund");
    expect(page.text).toContain("Apply online & email us");
    expect(page.text).not.toMatch(/nonce|p\{\}|a comment/);
  });

  it("resolves links and skips mail and in-page anchors", () => {
    expect(page.links).toEqual(["https://www.prairie-foundation.example.org/", "https://www.prairie-foundation.example.org/grants/rural-health", "https://apply.prairie-foundation.example.org/resilience"]);
  });

  it("hashes text, not markup", () => {
    const other = PAGE_HTML.replace('nonce="abc123"', 'nonce="zzz999"');
    expect(contentHash(htmlPageToText(other))).toBe(contentHash(page.text));
    expect(contentHash(htmlPageToText(PAGE_HTML.replace("$50,000", "$60,000")))).not.toBe(contentHash(page.text));
  });
});

describe("grounding helpers", () => {
  it("finds dates the way pages write them", () => {
    expect(dateAppearsIn("2026-12-15", "due December 15, 2026")).toBe(true);
    expect(dateAppearsIn("2026-12-15", "due Dec. 15 2026")).toBe(true);
    expect(dateAppearsIn("2026-12-15", "due 15 December 2026")).toBe(true);
    expect(dateAppearsIn("2026-12-15", "due 12/15/2026")).toBe(true);
    expect(dateAppearsIn("2026-09-03", "due Sept. 3, 2026")).toBe(true);
    expect(dateAppearsIn("2026-12-15", "due December 16, 2026")).toBe(false);
    expect(dateAppearsIn("2026-12-15", "due 112/15/2026")).toBe(false);
    expect(dateAppearsIn("2026-03-01", "due Sept. 1, 2026")).toBe(false);
    expect(isoDate("2026-02-30")).toBeNull();
    expect(isoDate("2026-02-28")).toBe("2026-02-28");
  });

  it("finds amounts the way pages write them", () => {
    expect(amountAppearsIn(50000, "up to $50,000")).toBe(true);
    expect(amountAppearsIn(25000, "grants of up to $25K.")).toBe(true);
    expect(amountAppearsIn(1500000, "a $1.5 million pool")).toBe(true);
    expect(amountAppearsIn(2000000, "up to $2M")).toBe(true);
    expect(amountAppearsIn(5000, "up to $50,000")).toBe(false);
    expect(amountAppearsIn(50000, "up to $500,000")).toBe(false);
  });
});

/** A recorded model answer for the page above, with three invented fields and one invented program. */
const MODEL_ANSWER = "Here are the opportunities:\n```json\n" + JSON.stringify([
  {
    title: "Rural Health Access Fund", funder: "Prairie Community Foundation", status: "posted", deadline: "2026-12-15", rollingDeadline: false,
    amountMin: 10000, amountMax: 50000, eligibilitySummary: "501(c)(3) nonprofits serving rural counties.", applicantKinds: ["nonprofit"],
    officialUrl: "https://www.prairie-foundation.example.org/grants/rural-health", evidence: "invites proposals from 501(c)(3) nonprofits serving rural counties",
  },
  {
    title: "Small Business Resilience Grants", funder: "Prairie Bank Charitable Trust", status: "posted", deadline: "2027-01-31", rollingDeadline: true,
    amountMin: null, amountMax: 25000, eligibilitySummary: "Local small businesses.", applicantKinds: ["business", "individual"],
    officialUrl: "https://apply.prairie-foundation.example.org/resilience", evidence: "Local small businesses may apply.",
  },
  { title: "Arts Endowment Challenge", funder: null, deadline: null, amountMax: 75000, officialUrl: "https://elsewhere.example.com/arts", evidence: "Arts organizations are encouraged" },
  { title: "Rural Health Access Fund", funder: "Prairie Community Foundation", officialUrl: "https://www.prairie-foundation.example.org/grants/rural-health" },
  { funder: "no title" },
  "not an object",
]) + "\n```";

describe("extraction parsing and validation (mocked AI answer)", () => {
  const generate = async () => ({ content: MODEL_ANSWER, provider: "openai" });

  it("keeps what the page states and empties what it does not", async () => {
    const out = await extractCandidates(page, { name: "Prairie", jurisdiction: "foundation" }, generate);
    expect(out).toMatchObject({ provider: "openai", demo: false, unparsable: false });
    expect(out.drafts).toHaveLength(3);
    const [health, business, arts] = out.drafts;

    expect(health).toMatchObject({ title: "Rural Health Access Fund", funder: "Prairie Community Foundation", deadline: "2026-12-15", rollingDeadline: false, amountMin: 10000, amountMax: 50000, applicantKinds: ["nonprofit"], officialUrl: "https://www.prairie-foundation.example.org/grants/rural-health", sourceUrl: BASE_URL, checkedAt: NOW, demo: false });
    expect(health.evidence).toBe("invites proposals from 501(c)(3) nonprofits serving rural counties");
    expect(health.notes).toEqual([]);

    // The funder and the deadline are not on the page; the rolling basis is, and so is $25K.
    expect(business).toMatchObject({ funder: null, deadline: null, rollingDeadline: true, amountMin: null, amountMax: 25000, applicantKinds: ["business"] });
    expect(business.notes).toEqual(expect.arrayContaining([
      'Funder "Prairie Bank Charitable Trust" is not named on the page, so it was left empty.',
      "Deadline 2027-01-31 is not written on the page, so it was left empty.",
    ]));

    // An invented program: not on the page, its amount and link are dropped, and it says so.
    expect(arts).toMatchObject({ title: "Arts Endowment Challenge", amountMax: null, officialUrl: null, evidence: null });
    expect(arts.notes).toEqual(expect.arrayContaining([
      "The title is not written this way on the page; check it.",
      "Maximum amount 75000 is not written on the page, so it was left empty.",
      "The official URL is not a link on the page, so it was left empty.",
      "The supporting quote is not on the page, so it was removed.",
      "No official https URL: add the program's own page before approving.",
      "No closing date: add it from the page, or mark a rolling deadline the page states.",
    ]));
  });

  it("drops a rolling deadline the page does not state", () => {
    const text = "Community Grants. Applications due December 15, 2026.";
    const [d] = validateCandidates([{ title: "Community Grants", rollingDeadline: true }], { ...page, text, links: [] });
    expect(d.rollingDeadline).toBe(false);
    expect(d.notes).toContain("A rolling deadline is not stated on the page, so it was not recorded.");
  });

  it("accepts the page itself as the official URL, and refuses http", () => {
    const [a, b] = validateCandidates([{ title: "Rural Health Access Fund", officialUrl: `${BASE_URL}#rural` }, { title: "Small Business Resilience Grants", officialUrl: "http://apply.prairie-foundation.example.org/resilience" }], page);
    expect(a.officialUrl).toBe(`${BASE_URL}#rural`);
    expect(b.officialUrl).toBeNull();
    expect(b.notes).toContain("The official URL is not https, so it was left empty.");
  });

  it("handles answers that are not JSON, objects with a list, and empty lists", async () => {
    expect(parseJsonBlock("I could not find any.")).toBeNull();
    const bad = await extractCandidates(page, { name: "P", jurisdiction: "foundation" }, async () => ({ content: "Sorry, no JSON here", provider: "anthropic" }));
    expect(bad).toMatchObject({ drafts: [], unparsable: true });
    expect(validateCandidates({ opportunities: [{ title: "Rural Health Access Fund" }] }, page)).toHaveLength(1);
    expect(validateCandidates([], page)).toEqual([]);
    expect(validateCandidates(null, page)).toEqual([]);
  });

  it("caps the number of drafts per page", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Program ${i}` }));
    expect(validateCandidates(many, page)).toHaveLength(25);
  });

  it("asks for the cheap model tier and sends only the page", async () => {
    let seen: { model?: string; temperature: number } | null = null;
    let prompt = "";
    await extractCandidates(page, { name: "Prairie", jurisdiction: "foundation" }, async (messages, options) => {
      seen = options;
      prompt = messages.map((m) => m.content).join("\n");
      return { content: "[]", provider: "openai" };
    }, "gpt-4o-mini");
    expect(seen).toMatchObject({ model: "gpt-4o-mini", temperature: 0 });
    expect(prompt).toContain("Never guess");
    expect(prompt).toContain("Rural Health Access Fund");
    expect(cheapModelFor("openai", {})).toBe("gpt-4o-mini");
    expect(cheapModelFor("anthropic", {})).toBe("claude-3-5-haiku-20241022");
    expect(cheapModelFor("gemini", {})).toBe("gemini-2.0-flash-lite");
    expect(cheapModelFor("openai", { SOURCE_EXTRACT_MODEL: "gpt-4.1-nano" })).toBe("gpt-4.1-nano");
  });

  it("labels demo output and leaves every field empty", async () => {
    const out = await extractCandidates(page, { name: "Prairie", jurisdiction: "foundation" }, async () => ({ content: "[DEMO OUTPUT]", provider: "demo" }));
    expect(out).toMatchObject({ demo: true, provider: "demo" });
    expect(out.drafts).toEqual([demoDraft(page)]);
    expect(out.drafts[0]).toMatchObject({ demo: true, funder: null, deadline: null, amountMin: null, amountMax: null, officialUrl: null, eligibilitySummary: null });
    expect(out.drafts[0].title).toMatch(/^DEMO: no AI provider is configured/);
  });

  it("maps who may apply to applicant codes as the California connector does", () => {
    expect(eligibilityCodesFor(["nonprofit"])).toEqual(["12", "13"]);
    expect(eligibilityCodesFor(["business", "nonprofit"])).toEqual(["12", "13", "22", "23"]);
    expect(eligibilityCodesFor([])).toEqual([]);
  });
});

describe("approval and the publication gate", () => {
  const source = { key: "prairie_open_calls", name: "Prairie Community Foundation", jurisdictionKind: "foundation", jurisdictionCode: null };
  const draft: DraftForPromotion = {
    fingerprint: "fp1", title: "Rural Health Access Fund", funder: "Prairie Community Foundation", deadline: "2026-12-15", rollingDeadline: false, opportunityStatus: "posted",
    amountMin: 10000, amountMax: 50000, eligibilitySummary: "501(c)(3) nonprofits.", applicantKinds: ["nonprofit"],
    officialUrl: "https://www.prairie-foundation.example.org/grants/rural-health", sourceUrl: BASE_URL, checkedAt: NOW, demo: false,
  };

  it("approves a complete draft, which becomes a gated opportunity", () => {
    expect(approvalCheck(draft, source, NOW)).toMatchObject({ ok: true, problems: [], gate: { publishable: true } });
    const opp = opportunityFromDraft(draft, source);
    expect(opp).toMatchObject({ source: "page:prairie_open_calls", sourceRef: "fp1", agency: "Prairie Community Foundation", status: "posted", closeDate: "2026-12-15", awardFloor: 10000, awardCeiling: 50000, jurisdiction: null, eligibilityCodes: ["12", "13"], officialUrl: draft.officialUrl, fetchedAt: NOW });
    expect(opp.description).toContain(`read 2026-11-05 and reviewed by a person`);
    expect(pageSourceKey("x")).toBe("page:x");
  });

  it("blocks drafts the gate would not publish", () => {
    expect(approvalCheck({ ...draft, officialUrl: null }, source, NOW).problems).toContain("The publication gate needs: official https source.");
    expect(approvalCheck({ ...draft, deadline: null }, source, NOW).problems).toContain("The publication gate needs: closing date.");
    expect(approvalCheck({ ...draft, deadline: null, rollingDeadline: true }, source, NOW).ok).toBe(true);
    expect(approvalCheck({ ...draft, deadline: "2026-11-01" }, source, NOW).problems).toContain("The publication gate needs: closing date not passed.");
    expect(approvalCheck({ ...draft, deadline: null, opportunityStatus: "forecasted" }, source, NOW).ok).toBe(true);
  });

  it("never approves demo output", () => {
    const demo = { ...demoDraft(page), fingerprint: "demo", applicantKinds: [] };
    const check = approvalCheck({ ...demo, officialUrl: BASE_URL, deadline: "2026-12-15" }, source, NOW);
    expect(check.ok).toBe(false);
    expect(check.problems[0]).toMatch(/^Demo output cannot be approved/);
  });

  it("gives state programs their state, as California records do", () => {
    const il = { key: "il_gata", name: "Illinois GATA", jurisdictionKind: "state", jurisdictionCode: "IL" };
    expect(opportunityFromDraft(draft, il)).toMatchObject({ jurisdiction: "IL", source: "page:il_gata", agency: "Prairie Community Foundation" });
    expect(opportunityFromDraft({ ...draft, funder: null }, il).agency).toBe("Illinois GATA");
  });

  it("validates a reviewer's edits", () => {
    expect(validateDraftEdit({ deadline: "2026-12-20", amountMax: "60000", applicantKinds: ["nonprofit", "business"], officialUrl: "https://www.prairie-foundation.example.org/grants/rural-health" })).toEqual({
      ok: true, value: { deadline: "2026-12-20", amountMax: 60000, applicantKinds: ["nonprofit", "business"], officialUrl: "https://www.prairie-foundation.example.org/grants/rural-health" },
    });
    const bad = validateDraftEdit({ title: " ", deadline: "Dec 20", amountMin: -1, applicantKinds: ["individual"], officialUrl: "http://x.example.org", opportunityStatus: "closed" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toEqual(["Enter a title.", "The deadline must be a date (YYYY-MM-DD).", "The status must be posted or forecasted.", "The minimum amount must be a positive number of dollars.", "Who may apply must be nonprofit, business or both.", "The official URL must use https."]);
    expect(validateDraftEdit({ amountMin: 5, amountMax: 1 }).ok).toBe(false);
    expect(validateDraftEdit({ deadline: null, funder: null })).toEqual({ ok: true, value: { deadline: null, funder: null } });
  });
});

describe("webhook secret", () => {
  const secret = "s".repeat(MIN_SECRET_LENGTH) + "-change-me";

  it("accepts only the configured secret, compared in constant time", () => {
    expect(verifyWebhookSecret(secret, secret)).toBe(true);
    expect(verifyWebhookSecret(`${secret}x`, secret)).toBe(false);
    expect(verifyWebhookSecret("short", secret)).toBe(false);
    expect(verifyWebhookSecret(undefined, secret)).toBe(false);
    expect(verifyWebhookSecret(["a", "b"], secret)).toBe(false);
    expect(verifyWebhookSecret("", secret)).toBe(false);
    expect(verifyWebhookSecret(secret, null)).toBe(false);
  });

  it("treats a short or missing secret as not configured", () => {
    expect(webhookSecret({ CHANGEDETECTION_WEBHOOK_SECRET: "too-short" })).toBeNull();
    expect(webhookSecret({})).toBeNull();
    expect(webhookSecret({ CHANGEDETECTION_WEBHOOK_SECRET: `  ${secret}  ` })).toBe(secret);
  });

  it("reads only the watch id from a notification", () => {
    expect(parseChangeNotification({ event: "watch.changed", watch_uuid: "095BE615-A8AD-4C33-8E9C-C7612FBF6C9F", watch_url: "https://a.example.org" })).toEqual({ watchId: "095be615-a8ad-4c33-8e9c-c7612fbf6c9f", watchUrl: "https://a.example.org" });
    expect(parseChangeNotification({ watch_uuid: "../../etc" })).toBeNull();
    expect(parseChangeNotification("text")).toBeNull();
    expect(parseChangeNotification(null)).toBeNull();
  });

  it("builds the Apprise notification URL with the secret as a header", () => {
    expect(notificationUrl("https://app.example.org/api/watch-events/changedetection", "abc+/=")).toBe("posts://app.example.org/api/watch-events/changedetection?+x-watcher-secret=abc%2B%2F%3D");
    expect(notificationUrl("http://api:8080/api/watch-events/changedetection", "k")).toBe("post://api:8080/api/watch-events/changedetection?+x-watcher-secret=k");
    expect(NOTIFICATION_BODY).toContain("watch_uuid|tojson");
  });
});

function fakeChangeDetection(state: { watches: Record<string, any>; snapshot: string; html: string | null; created?: string }) {
  const calls: { method: string; path: string; headers: Record<string, string>; body: any }[] = [];
  const fetchImpl: FetchFn = async (url, init = {}) => {
    const path = url.replace("https://cd.example.org/api/v1", "");
    calls.push({ method: init.method ?? "GET", path, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
    if (init.headers?.["x-api-key"] !== "cd-key") return reply(403, "forbidden");
    const m = /^\/watch(?:\/([^/?]+))?(\/history\/latest)?(\?html=1)?$/.exec(path);
    if (!m) return reply(404, "no");
    const [, id, history, html] = m;
    if (!id) {
      if (init.method === "POST") {
        const uuid = state.created ?? "7c9e6b8d-f2a1-4e5c-9d3b-8a7f6e4c2d1a";
        state.watches[uuid] = { url: JSON.parse(init.body!).url, last_checked: 0 };
        return reply(201, { uuid });
      }
      return reply(200, state.watches);
    }
    if (!state.watches[id]) return reply(404, "not found");
    if (history) return html ? (state.html ? reply(200, state.html) : reply(404, "no html")) : reply(200, state.snapshot);
    if (init.method === "PUT") return reply(200, "OK");
    if (init.method === "DELETE") {
      delete state.watches[id];
      return reply(204, "");
    }
    return reply(200, state.watches[id]);
  };
  return { fetchImpl, calls };
}

describe("changedetection.io client (fake API)", () => {
  const config = { baseUrl: "https://cd.example.org", apiKey: "cd-key", receiverUrl: "https://app.example.org/api/watch-events/changedetection", webhookSecret: "w".repeat(30), userAgent: DEFAULT_USER_AGENT };

  it("creates a watch with the schedule and the signed notification, then updates it", async () => {
    const fake = fakeChangeDetection({ watches: {}, snapshot: "", html: null });
    const client = new ChangeDetectionClient(config, fake.fetchImpl);
    const id = await client.upsertWatch(null, { name: "Prairie", url: BASE_URL, scheduleHours: 24, paused: false });
    expect(id).toBe("7c9e6b8d-f2a1-4e5c-9d3b-8a7f6e4c2d1a");
    const post = fake.calls[0];
    expect(post).toMatchObject({ method: "POST", path: "/watch", headers: { "x-api-key": "cd-key" } });
    expect(post.body).toMatchObject({ url: BASE_URL, title: "Grant Studio: Prairie", time_between_check: { hours: 24 }, time_between_check_use_default: false, headers: { "User-Agent": DEFAULT_USER_AGENT }, paused: false, notification_body: NOTIFICATION_BODY, notification_format: "text" });
    expect(post.body.notification_urls[0]).toBe(`posts://app.example.org/api/watch-events/changedetection?+x-watcher-secret=${"w".repeat(30)}`);
    expect(await client.upsertWatch(id, { name: "Prairie", url: BASE_URL, scheduleHours: 12, paused: false })).toBe(id);
    expect(fake.calls[1]).toMatchObject({ method: "PUT", path: `/watch/${id}` });
  });

  it("recreates a watch that was deleted on the instance, and finds the id from older versions' OK reply", async () => {
    const fake = fakeChangeDetection({ watches: {}, snapshot: "", html: null });
    const client = new ChangeDetectionClient({ ...config, receiverUrl: null, webhookSecret: null }, fake.fetchImpl);
    const id = await client.upsertWatch("095be615-a8ad-4c33-8e9c-c7612fbf6c9f", { name: "P", url: BASE_URL, scheduleHours: 24, paused: false });
    expect(id).toBe("7c9e6b8d-f2a1-4e5c-9d3b-8a7f6e4c2d1a");
    expect(fake.calls.map((c) => c.method)).toEqual(["PUT", "POST"]);
    // Poll mode: no notification URL is set on the watch.
    expect(fake.calls[1].body.notification_urls).toBeUndefined();
  });

  it("reads the watch state and the latest snapshot", async () => {
    const id = "095be615-a8ad-4c33-8e9c-c7612fbf6c9f";
    const fake = fakeChangeDetection({ watches: { [id]: { url: BASE_URL, last_checked: 1793880000, last_changed: 1793870000, last_error: false } }, snapshot: "Rural Health Access Fund", html: PAGE_HTML });
    const client = new ChangeDetectionClient(config, fake.fetchImpl);
    expect(await client.watchState(id)).toEqual({ lastChecked: new Date(1793880000 * 1000), lastChanged: new Date(1793870000 * 1000), lastError: null });
    expect(await client.latestSnapshot(id)).toEqual({ text: "Rural Health Access Fund", html: PAGE_HTML });
  });

  it("reports API errors without the key", async () => {
    const fake = fakeChangeDetection({ watches: {}, snapshot: "", html: null });
    const client = new ChangeDetectionClient({ ...config, apiKey: "wrong" }, fake.fetchImpl);
    const err = await client.watchState("095be615-a8ad-4c33-8e9c-c7612fbf6c9f").catch((e: Error) => e);
    expect((err as Error).message).toBe("changedetection.io GET /watch/095be615-a8ad-4c33-8e9c-c7612fbf6c9f answered 403");
    expect((err as Error).message).not.toContain("wrong");
  });
});

describe("backend selection", () => {
  const secret = "x".repeat(32);

  it("uses the built-in fetcher unless changedetection.io is fully configured", () => {
    expect(watcherSettings({}, null)).toMatchObject({ backend: "builtin", problem: null });
    expect(watcherSettings({ SOURCE_WATCHER_BACKEND: "changedetection" }, null)).toMatchObject({ backend: "builtin", problem: expect.stringMatching(/CHANGEDETECTION_URL or CHANGEDETECTION_API_KEY is not set/) });
    expect(watcherSettings({ SOURCE_WATCHER_BACKEND: "changedetection", CHANGEDETECTION_URL: "nope", CHANGEDETECTION_API_KEY: "k" }, null).backend).toBe("builtin");
  });

  it("receives webhooks when a receiver and secret are set, and polls otherwise", () => {
    const env = { SOURCE_WATCHER_BACKEND: "changedetection", CHANGEDETECTION_URL: "http://changedetection:5000", CHANGEDETECTION_API_KEY: "k" };
    expect(watcherSettings(env, null)).toMatchObject({ backend: "changedetection", mode: "poll", problem: null });
    expect(watcherSettings({ ...env, CHANGEDETECTION_RECEIVER_URL: "http://api:8080/api/watch-events/changedetection" }, secret)).toMatchObject({ mode: "webhook", changeDetection: { webhookSecret: secret } });
    expect(watcherSettings({ ...env, CHANGEDETECTION_RECEIVER_URL: "http://api:8080/x", CHANGEDETECTION_MODE: "poll" }, secret)).toMatchObject({ mode: "poll", changeDetection: { receiverUrl: null, webhookSecret: null } });
    expect(watcherSettings({ ...env, CHANGEDETECTION_MODE: "webhook" }, null)).toMatchObject({ mode: "poll", problem: expect.stringMatching(/polling instead/) });
  });
});

describe("built-in fetcher", () => {
  it("sends an honest User-Agent with no personal email", () => {
    expect(userAgent({})).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).not.toMatch(/@/);
    expect(userAgent({ SOURCE_FETCH_USER_AGENT: "Agency bot (+https://agency.example.org/bot)" })).toBe("Agency bot (+https://agency.example.org/bot)");
    expect(userAgent({ SOURCE_FETCH_USER_AGENT: "bot (me@example.org)" })).toBe(DEFAULT_USER_AGENT);
  });

  it("spaces requests to the same host", async () => {
    let t = 0;
    const slept: number[] = [];
    const limiter = new HostRateLimiter(10_000, () => t, async (ms) => {
      slept.push(ms);
    });
    expect(await limiter.wait("a.example.org")).toBe(0);
    expect(await limiter.wait("a.example.org")).toBe(10_000);
    expect(await limiter.wait("b.example.org")).toBe(0);
    t = 25_000;
    expect(await limiter.wait("a.example.org")).toBe(0);
    expect(slept).toEqual([10_000]);
  });
});
