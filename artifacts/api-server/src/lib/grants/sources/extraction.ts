import { createHash } from "crypto";

/**
 * Turns a watched page's text into candidate opportunities (docs/SOURCE_REGISTRY.md).
 *
 * The model's answer is untrusted. Every field it returns is checked against
 * the page itself, and a field the page does not support is left empty with a
 * note, never guessed:
 * - a deadline is kept only when that date is written on the page;
 * - an amount only when that figure is written on the page;
 * - the funder and the supporting quote only when they appear on the page;
 * - the official URL only when it is an https link on the page (or the page itself).
 * Drafts never publish: a person reviews each one, and an approved draft still
 * has to pass the publication gate (lib/grants/gate.ts).
 *
 * Pure module (no database or provider import), so parsing and validation are
 * unit-tested with recorded model answers.
 */

export const EXTRACTOR_VERSION = "page-extract-1";
export const MAX_PAGE_CHARS = 40_000;
export const MAX_DRAFTS_PER_PAGE = 25;
export const APPLICANT_KINDS = ["nonprofit", "business"] as const;

export interface PageSnapshot {
  /** The watched page. */
  url: string;
  /** The page as text (scripts and markup removed). */
  text: string;
  /** Absolute links found on the page. */
  links: string[];
  checkedAt: Date;
}

export interface CandidateDraft {
  fingerprint: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  rollingDeadline: boolean;
  opportunityStatus: "posted" | "forecasted";
  amountMin: number | null;
  amountMax: number | null;
  eligibilitySummary: string | null;
  applicantKinds: string[];
  officialUrl: string | null;
  sourceUrl: string;
  checkedAt: Date;
  evidence: string | null;
  notes: string[];
  demo: boolean;
}

// ── HTML to text ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Plain text of an HTML page, with block breaks kept and scripts, styles and comments removed. */
export function htmlPageToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|dd|dt|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Absolute http(s) links on the page, resolved against its URL, without fragments, at most 500. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (let m = re.exec(html); m && out.size < 500; m = re.exec(html)) {
    const raw = decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.hash = "";
      out.add(url.toString());
    } catch {
      // not a URL
    }
  }
  return [...out];
}

/** A stable hash of the page's text, so markup-only changes (nonces, timestamps in attributes) are not changes. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

// ── Model output ─────────────────────────────────────────────────────────────

/** Finds the first JSON array or object in model output and parses it. */
export function parseJsonBlock(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const close = candidate[start] === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A YYYY-MM-DD date that is a real calendar date. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? v.trim() : null;
}

/** The ways a page may write a date: 2026-12-15, 12/15/2026, December 15, 2026, Dec. 15 2026, 15 December 2026. */
export function dateAppearsIn(iso: string, pageText: string): boolean {
  const [y, mo, d] = iso.split("-").map(Number);
  const month = MONTHS[mo - 1];
  const names = [month, `${month.slice(0, 3)}\\.?`, ...(mo === 9 ? ["sept\\.?"] : [])].join("|");
  const text = norm(pageText);
  const patterns = [
    `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    `(?<!\\d)0?${mo}/0?${d}/(${y}|${String(y).slice(2)})(?!\\d)`,
    `\\b(${names}) 0?${d}(st|nd|rd|th)?,? ${y}`,
    `(?<!\\d)0?${d}(st|nd|rd|th)? (of )?(${names}),? ${y}`,
  ];
  return patterns.some((p) => new RegExp(p).test(text));
}

/** Whether the page writes this amount: 50,000 / 50000 / $50K / 1.5 million / $2M. */
export function amountAppearsIn(amount: number, pageText: string): boolean {
  const text = norm(pageText).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const n = Math.round(amount);
  const forms = [String(n)];
  const scaled = (div: number, words: string[]) => {
    if (n % (div / 10) !== 0 || n < div) return;
    const v = (n / div).toString();
    for (const w of words) forms.push(`${v} ?${w}`);
  };
  scaled(1_000_000, ["million", "m\\b", "mil\\b"]);
  scaled(1_000, ["thousand", "k\\b"]);
  scaled(1_000_000_000, ["billion", "b\\b"]);
  return forms.some((f) => new RegExp(`(?<![\\d.])\\$? ?${f.replace(".", "\\.")}(?![\\d])`).test(text));
}

function toAmount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1e12 ? n : null;
}

function sameUrl(a: string, b: string): boolean {
  const clean = (u: string) => {
    try {
      const x = new URL(u);
      x.hash = "";
      return x.toString().replace(/\/$/, "");
    } catch {
      return u;
    }
  };
  return clean(a) === clean(b);
}

export function fingerprintOf(title: string, officialUrl: string | null): string {
  return createHash("sha256").update(`${norm(title)}|${officialUrl ?? ""}`).digest("hex").slice(0, 32);
}

/**
 * Validates the model's answer against the page. Returns at most
 * MAX_DRAFTS_PER_PAGE drafts, each with notes on every field that was removed.
 */
export function validateCandidates(value: unknown, page: PageSnapshot): CandidateDraft[] {
  const rows: unknown[] = Array.isArray(value) ? value : Array.isArray((value as { opportunities?: unknown })?.opportunities) ? (value as { opportunities: unknown[] }).opportunities : [];
  const pageText = page.text;
  const pageNorm = norm(pageText);
  const seen = new Set<string>();
  const out: CandidateDraft[] = [];
  for (const row of rows) {
    if (out.length >= MAX_DRAFTS_PER_PAGE) break;
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const notes: string[] = [];
    const title = str(r.title, 300);
    if (!title) continue;
    if (!pageNorm.includes(norm(title))) notes.push("The title is not written this way on the page; check it.");

    let funder = str(r.funder ?? r.agency, 200);
    if (funder && !pageNorm.includes(norm(funder))) {
      notes.push(`Funder "${funder}" is not named on the page, so it was left empty.`);
      funder = null;
    }

    let deadline = r.deadline === null || r.deadline === undefined || r.deadline === "" ? null : isoDate(r.deadline);
    if (r.deadline && !deadline) notes.push("The deadline was not a valid date, so it was left empty.");
    if (deadline && !dateAppearsIn(deadline, pageText)) {
      notes.push(`Deadline ${deadline} is not written on the page, so it was left empty.`);
      deadline = null;
    }

    let rollingDeadline = r.rollingDeadline === true || r.rolling === true;
    if (rollingDeadline && !/\b(rolling|ongoing|open until (funds|filled)|until funds are (exhausted|expended)|accepted (year[- ]round|continuously)|no deadline)\b/i.test(pageText)) {
      notes.push("A rolling deadline is not stated on the page, so it was not recorded.");
      rollingDeadline = false;
    }
    if (deadline) rollingDeadline = false;

    const rawStatus = typeof r.status === "string" ? r.status.toLowerCase() : "";
    const opportunityStatus: "posted" | "forecasted" = rawStatus === "forecasted" || rawStatus === "forecast" || rawStatus === "upcoming" ? "forecasted" : "posted";
    if (rawStatus !== "posted" && rawStatus !== "open" && opportunityStatus === "posted") notes.push("The page's status (open or upcoming) was not stated; confirm it is open.");

    let amountMin = toAmount(r.amountMin ?? r.awardFloor);
    let amountMax = toAmount(r.amountMax ?? r.awardCeiling);
    if (amountMin !== null && !amountAppearsIn(amountMin, pageText)) {
      notes.push(`Minimum amount ${amountMin} is not written on the page, so it was left empty.`);
      amountMin = null;
    }
    if (amountMax !== null && !amountAppearsIn(amountMax, pageText)) {
      notes.push(`Maximum amount ${amountMax} is not written on the page, so it was left empty.`);
      amountMax = null;
    }
    if (amountMin !== null && amountMax !== null && amountMin > amountMax) [amountMin, amountMax] = [amountMax, amountMin];

    const eligibilitySummary = str(r.eligibilitySummary ?? r.eligibility, 1500);
    const applicantKinds = Array.isArray(r.applicantKinds) ? [...new Set(r.applicantKinds.filter((k): k is string => typeof k === "string" && (APPLICANT_KINDS as readonly string[]).includes(k)))] : [];

    let officialUrl = str(r.officialUrl ?? r.url, 2000);
    if (officialUrl) {
      let ok = false;
      try {
        ok = new URL(officialUrl).protocol === "https:";
      } catch {
        ok = false;
      }
      const onPage = sameUrl(officialUrl, page.url) || page.links.some((l) => sameUrl(l, officialUrl!)) || pageText.includes(officialUrl);
      if (!ok || !onPage) {
        notes.push(ok ? "The official URL is not a link on the page, so it was left empty." : "The official URL is not https, so it was left empty.");
        officialUrl = null;
      }
    }

    let evidence = str(r.evidence ?? r.quote, 500);
    if (evidence && !pageNorm.includes(norm(evidence))) {
      notes.push("The supporting quote is not on the page, so it was removed.");
      evidence = null;
    }
    if (!officialUrl) notes.push("No official https URL: add the program's own page before approving.");
    if (!deadline && !rollingDeadline && opportunityStatus === "posted") notes.push("No closing date: add it from the page, or mark a rolling deadline the page states.");

    const fingerprint = fingerprintOf(title, officialUrl);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({ fingerprint, title, funder, deadline, rollingDeadline, opportunityStatus, amountMin, amountMax, eligibilitySummary, applicantKinds, officialUrl, sourceUrl: page.url, checkedAt: page.checkedAt, evidence, notes, demo: false });
  }
  return out;
}

// ── Prompt and demo output ──────────────────────────────────────────────────

export function extractionMessages(page: PageSnapshot, source: { name: string; jurisdiction: string }) {
  return [
    {
      role: "system" as const,
      content:
        "You read a funder's web page and list the grant or funding opportunities it announces. You only report what the page says. Never guess: when the page does not state a field, return null for it. Copy dates and amounts exactly as the page states them, converted to the formats asked. Output JSON only.",
    },
    {
      role: "user" as const,
      content:
        `Source: ${source.name} (${source.jurisdiction}). Page: ${page.url}\n\n` +
        'Return a JSON array with one item per opportunity that is open or announced as upcoming. Skip closed or past programs, news items and general information. Each item: {"title": the program name as written, "funder": the organization offering it as written, "status": "posted" if open now or "forecasted" if announced for later, "deadline": the application deadline as YYYY-MM-DD or null, "rollingDeadline": true only if the page says applications are accepted on a rolling or ongoing basis, "amountMin": smallest award in dollars as a number or null, "amountMax": largest award in dollars as a number or null, "eligibilitySummary": one or two sentences on who may apply, from the page, or null, "applicantKinds": any of "nonprofit" and "business" that the page says may apply, "officialUrl": the https link on the page for this program, or null, "evidence": a short exact quote from the page that names the program}. Return [] when the page announces none.\n\nPAGE TEXT:\n' +
        page.text.slice(0, MAX_PAGE_CHARS),
    },
  ];
}

/** Without an AI provider: one clearly labelled demo draft, with every field empty. It can never be approved. */
export function demoDraft(page: PageSnapshot): CandidateDraft {
  let host = page.url;
  try {
    host = new URL(page.url).hostname;
  } catch {
    // keep the URL
  }
  const title = `DEMO: no AI provider is configured, so nothing was extracted from ${host}`;
  return {
    fingerprint: "demo",
    title,
    funder: null,
    deadline: null,
    rollingDeadline: false,
    opportunityStatus: "posted",
    amountMin: null,
    amountMax: null,
    eligibilitySummary: null,
    applicantKinds: [],
    officialUrl: null,
    sourceUrl: page.url,
    checkedAt: page.checkedAt,
    evidence: null,
    notes: ["Demo output: the page changed, but extraction needs an AI provider (Settings, AI Providers). Read the page and add opportunities by hand, or configure a provider and check again."],
    demo: true,
  };
}

export type GenerateFn = (messages: ReturnType<typeof extractionMessages>, options: { maxTokens: number; temperature: number; model?: string }) => Promise<{ content: string; provider: string }>;

export interface ExtractionOutcome {
  drafts: CandidateDraft[];
  provider: string;
  demo: boolean;
  /** The model answered, but not with JSON this parser understands. */
  unparsable: boolean;
}

/** Sends the page to the AI provider and validates the answer; the demo provider gives one labelled demo draft. */
export async function extractCandidates(page: PageSnapshot, source: { name: string; jurisdiction: string }, generate: GenerateFn, model?: string): Promise<ExtractionOutcome> {
  const result = await generate(extractionMessages(page, source), { maxTokens: 4000, temperature: 0, ...(model ? { model } : {}) });
  if (result.provider === "demo") return { drafts: [demoDraft(page)], provider: "demo", demo: true, unparsable: false };
  const parsed = parseJsonBlock(result.content);
  return { drafts: validateCandidates(parsed, page), provider: result.provider, demo: false, unparsable: parsed === null };
}

/** The cheapest model each provider offers in this product, unless SOURCE_EXTRACT_MODEL names one. */
export function cheapModelFor(provider: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const override = env.SOURCE_EXTRACT_MODEL?.trim();
  if (override) return override;
  return ({ openai: "gpt-4o-mini", anthropic: "claude-3-5-haiku-20241022", gemini: "gemini-2.0-flash-lite" } as Record<string, string>)[provider];
}

/** Grants.gov-style applicant codes for the kinds a page names, as the California connector maps them. */
export function eligibilityCodesFor(kinds: string[]): string[] {
  const codes = new Set<string>();
  if (kinds.includes("nonprofit")) ["12", "13"].forEach((c) => codes.add(c));
  if (kinds.includes("business")) ["22", "23"].forEach((c) => codes.add(c));
  return [...codes].sort();
}
