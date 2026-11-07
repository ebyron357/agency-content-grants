import { createHash } from "crypto";
import { htmlToText } from "./text";
import { splitSentences } from "./writing";

/**
 * The unsupported-claim check (GRANT_PLATFORM_PLAN.md §6, item 2; docs/GRANT_STUDIO.md).
 *
 * Every factual claim in a drafted section (a number, a date, a stated result,
 * a named partner, a credential) must be backed by something a person
 * confirmed: a fact in the organization's library, the application's own
 * record (budget, opportunity, received letters, recorded place designations,
 * confirmed requirements), or a source cited in the sentence itself. Anything
 * else is flagged with the reason, and an open flag blocks approval until a
 * person links it to a fact, edits the text, or dismisses it with a reason.
 *
 * These are deterministic rules, labelled as such: they match numbers, dates
 * and names literally. They cannot judge whether a fact really supports a
 * sentence, so a match is a prompt, not a verdict. With an AI provider, the
 * section review also asks the model for claims the rules miss (see
 * acceptAiClaims); it can add flags, never remove them.
 */

export const CLAIM_RULES_VERSION = "rules-1";

export type ClaimKind = "number" | "date" | "outcome" | "partner" | "credential";
export const CLAIM_KINDS: readonly ClaimKind[] = ["number", "date", "outcome", "partner", "credential"];
export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  number: "Number",
  date: "Date",
  outcome: "Result",
  partner: "Named partner",
  credential: "Credential",
};

export interface SupportSource {
  /** fact | budget | opportunity | profile | letter | requirement | place | form */
  kind: string;
  label: string;
  /** The library fact's id, for a fact. */
  factId?: string;
  text: string;
  /** Extra numbers the source holds that are not written in its text (for example budget arithmetic). */
  numbers?: number[];
}

export interface ClaimFinding {
  kind: ClaimKind;
  claim: string;
  sentence: string;
  reason: string;
  fingerprint: string;
}

export interface SupportedClaim {
  kind: ClaimKind;
  claim: string;
  by: string;
}

export interface ClaimCheck {
  findings: ClaimFinding[];
  supported: SupportedClaim[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function claimFingerprint(kind: string, claim: string, sentence: string): string {
  return createHash("sha256").update(`${kind}|${norm(claim)}|${norm(sentence)}`).digest("hex").slice(0, 32);
}

// ── Numbers ───────────────────────────────────────────────────────────────

const MULTIPLIERS: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };
const NUMBER_RE = /(?<![\w.,:/-])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(thousand|million|billion))?(\s?%|\s?percent\b)?(?![\w:(/-]|[.,]\d)/gi;
/** Words before a number that make it a label rather than a claim ("Goal 2", "Year 1", "Section 4"). */
const LABEL_BEFORE = /(?:\b(?:cfr|u\.s\.c\.|goal|objective|phase|year|step|section|part|tier|activity|outcome|output|strategy|aim|criterion|item|table|figure|appendix|page|pages|quarter|month|week|grade|level|title|line|no\.|number|chapter|form|schedule|exhibit|attachment|cohort|round|session|module|unit|day)s?|#|§)\s*$/i;
/** Words after a number that make it a citation or code ("2 CFR 200", "42 U.S.C."). */
const CODE_AFTER = /^\s*(?:cfr|c\.f\.r\.|u\.s\.c\.|usc|stat\.|fr\b)/i;
/** A street number ("123 Main Street") is an address, not a claim. */
const STREET_AFTER = /^\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Place|Pl\.?|Court|Ct\.?|Highway|Hwy\.?|Parkway|Suite)\b/;

export interface NumberToken {
  text: string;
  value: number;
  /** True when the number carries thousand/million/billion: it may be a rounded figure. */
  rounded: boolean;
  index: number;
}

export function numbersIn(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const [whole, dollar, digits, decimals, mult, percent] = m;
    const index = m.index ?? 0;
    const value = Number(digits.replace(/,/g, "") + (decimals ?? "")) * (mult ? MULTIPLIERS[mult.toLowerCase()] : 1);
    if (!Number.isFinite(value)) continue;
    const isYear = !dollar && !percent && !mult && !decimals && /^(19|20)\d{2}$/.test(digits);
    if (isYear) continue; // Years are checked as dates.
    out.push({ text: whole.trim(), value, rounded: Boolean(mult), index });
  }
  return out;
}

function sourceNumbers(source: SupportSource): number[] {
  const found = numbersIn(source.text).map((n) => n.value);
  // Years in a source support a number written the same way only as dates, but plain counts can equal a year's digits rarely; keep both.
  for (const m of source.text.matchAll(/(?<!\d)(19|20)\d{2}(?!\d)/g)) found.push(Number(m[0]));
  return [...found, ...(source.numbers ?? [])];
}

function numberSupported(token: NumberToken, sources: SupportSource[]): SupportSource | null {
  for (const s of sources) {
    for (const v of sourceNumbers(s)) {
      if (Math.abs(v - token.value) < 0.005) return s;
      if (token.rounded && v > 0 && Math.abs(v - token.value) / v <= 0.05) return s;
    }
  }
  return null;
}

// ── Dates ─────────────────────────────────────────────────────────────────

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE_RE = new RegExp(
  [
    `\\b${MONTH_RE}\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?(?:19|20)\\d{2}\\b`,
    "\\b\\d{1,2}/\\d{1,2}/(?:19|20)?\\d{2}\\b",
    "\\b(?:19|20)\\d{2}-\\d{2}-\\d{2}\\b",
    "\\bFY\\s?(?:19|20)?\\d{2}\\b",
    "(?<![\\w$.,-])(?:19|20)\\d{2}(?![\\w%-]|[.,]\\d)",
  ].join("|"),
  "gi",
);

export interface DateToken {
  text: string;
  year: number;
  month: number | null;
  index: number;
}

export function datesIn(text: string): DateToken[] {
  const out: DateToken[] = [];
  const taken: [number, number][] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const index = m.index ?? 0;
    if (taken.some(([a, b]) => index >= a && index < b)) continue;
    taken.push([index, index + m[0].length]);
    const t = m[0];
    let year: number | null = null;
    let month: number | null = null;
    let iso: RegExpMatchArray | null;
    if ((iso = t.match(/^((?:19|20)\d{2})-(\d{2})-\d{2}$/))) {
      year = Number(iso[1]);
      month = Number(iso[2]);
    } else if ((iso = t.match(/^(\d{1,2})\/\d{1,2}\/((?:19|20)?\d{2})$/))) {
      year = iso[2].length === 2 ? 2000 + Number(iso[2]) : Number(iso[2]);
      month = Number(iso[1]);
    } else if ((iso = t.match(/^FY\s?((?:19|20)?\d{2})$/i))) {
      year = iso[1].length === 2 ? 2000 + Number(iso[1]) : Number(iso[1]);
    } else {
      const y = t.match(/(19|20)\d{2}/);
      year = y ? Number(y[0]) : null;
      const mon = t.match(/^[A-Za-z]+/);
      if (mon) month = MONTHS.findIndex((name) => name.startsWith(mon[0].toLowerCase().slice(0, 3))) + 1 || null;
    }
    if (year) out.push({ text: t, year, month, index });
  }
  return out;
}

function dateSupported(token: DateToken, sources: SupportSource[]): SupportSource | null {
  for (const s of sources) {
    for (const d of datesIn(s.text)) {
      if (d.year === token.year && (token.month === null || d.month === null || d.month === token.month)) return s;
    }
  }
  return null;
}

// ── Sentences ─────────────────────────────────────────────────────────────

/** A plan or target ("We will serve 300 students by June 2028") is a commitment a person sets, not a claim of fact. */
const PLAN = /\b(?:will|shall|plans? to|planned|aims? to|proposes? to|proposed|intends? to|seeks? to|expects? to|goal|target|by the end of|anticipate[sd]?|projected)\b/i;
const PAST_MARKER = /\b(?:served|serves|has|have|had|was|were|since|last year|previously|achieved|reached|completed|increased|decreased|reduced|improved|grew|founded|established)\b/i;

export function isPlanSentence(sentence: string): boolean {
  return PLAN.test(sentence) && !PAST_MARKER.test(sentence);
}

const CITATION = /https?:\/\/\S+|\bsources?:\s*\S|\(\s*(?:source|see)\b[^)]*\)|\([A-Z][^()]{2,80},\s*(?:19|20)\d{2}\)|\baccording to (?:the )?[A-Z][\w.&'-]+/i;

/** The citation a sentence carries itself, if any (a link, "Source: …", "(Agency, 2024)", "according to …"). */
export function citationIn(sentence: string): string | null {
  const m = sentence.match(CITATION);
  return m ? m[0].slice(0, 120) : null;
}

// ── Results, partners, credentials ────────────────────────────────────────

const OUTCOME = /\b(increased|decreased|reduced|improved|raised|doubled|tripled|lowered|grew|boosted|expanded|eliminated|prevented|achieved|resulted in|led to|cut)\b((?:\s+[\w%$,.'-]+){0,6})/i;
const ORG_SUFFIX = "(?:Inc\\.?|LLC|L\\.L\\.C\\.|Foundation|University|College|Institute|Department|Council|Association|Hospital|Clinic|Center|Centre|Bank|Agency|District|Coalition|Alliance|Church|Schools?|Library|Society|Corporation|Company|Co\\.|Partners|Network|Authority|Commission|Board|Trust|Fund|Museum|YMCA|YWCA|Club|Cooperative|Ministries|Collaborative|Consortium)";
const ORG_RE = new RegExp(`\\b((?:[A-Z][\\w&'.-]*\\s+(?:(?:of|for|&|the|on)\\s+)?){0,6}${ORG_SUFFIX})(?:\\s+of(?:\\s+[A-Z][\\w&'.-]*){1,4})?`, "g");
const PARTNER_PHRASE = /\b(?:in partnership with|partnering with|partnered with|partners? (?:include|includes|are|such as)|collaborat(?:e|es|ed|ing) with|in collaboration with|together with|with support from|supported by|funded by)\s+((?:the\s+)?[A-Z][\w&'.-]*(?:\s+(?:of|for|and|&|the|[A-Z][\w&'.-]*)){0,8})/g;
const CREDENTIAL_WORDS = /\b(accredited|accreditation|board[- ]certified|certified|licensed|award[- ]winning|nationally recognized|internationally recognized|recognized as|evidence[- ]based|research[- ]based|top[- ]rated|ranked)\b/gi;
const CREDENTIAL_LETTERS = /(?<![\w.])(Ph\.?D\.?|M\.D\.|MSW|LCSW|LMSW|LPC|CPA|J\.D\.|MBA|M\.Ed\.|MPH|Ed\.D\.|PMP)(?![\w])/g;

function cleanName(name: string): string {
  return name.replace(/^(?:the|our|their|a|an)\s+/i, "").replace(/[\s,.;:]+$/, "").trim();
}

function textHas(sources: SupportSource[], phrase: string): SupportSource | null {
  const needle = norm(phrase.replace(/[-]/g, " "));
  if (needle.length < 3) return null;
  return sources.find((s) => norm(s.text.replace(/[-]/g, " ")).includes(needle)) ?? null;
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "our", "their", "was", "were", "has", "have", "had", "than", "more", "less", "over", "by", "of", "in", "to", "a", "an", "on", "at", "as", "is", "are"]);

function contentWords(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
}

// ── The check ─────────────────────────────────────────────────────────────

export interface ClaimCheckInput {
  html: string;
  sources: SupportSource[];
  /** Names that are not partner claims: the applicant itself and the funder. */
  ownNames: string[];
}

const describe = (s: SupportSource) => s.label;

const ABBREVIATION = /\b(U\.S|U\.K|e\.g|i\.e|Dr|Mr|Mrs|Ms|St|No|Inc|Co|Corp|Ltd|vs|etc|Jr|Sr|Ph\.D|M\.D|J\.D|Ed\.D|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec)\.(?=\s)/g;
const KEEP_DOT = "\u2024";

/** Sentences, without breaking at "U.S.", "Dr." or "Inc.". */
export function claimSentences(text: string): string[] {
  return splitSentences(text.replace(ABBREVIATION, (_m, word: string) => `${word}${KEEP_DOT}`)).map((s) => s.split(KEEP_DOT).join("."));
}

export function checkClaims(input: ClaimCheckInput): ClaimCheck {
  // Placeholders are blocked by their own check; links are citations, not claims.
  const text = htmlToText(input.html || "").replace(/\[(?:Add|Insert)[^\]]*\]/gi, " ");
  const sentences = claimSentences(text);
  const findings: ClaimFinding[] = [];
  const supported: SupportedClaim[] = [];
  const own = input.ownNames.filter(Boolean).map((n) => norm(cleanName(n)));
  const seen = new Set<string>();
  const flag = (kind: ClaimKind, claim: string, sentence: string, reason: string) => {
    const fingerprint = claimFingerprint(kind, claim, sentence);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    findings.push({ kind, claim, sentence: sentence.slice(0, 600), reason, fingerprint });
  };

  for (const raw of sentences) {
    const sentence = raw.replace(/\s+/g, " ").trim();
    if (/^\d+[.)]\s/.test(sentence) && sentence.split(" ").length < 4) continue;
    const cited = citationIn(sentence);
    const plan = isPlanSentence(sentence);
    const scan = sentence.replace(/https?:\/\/\S+/g, " ");

    if (!plan) {
      const dates = datesIn(scan);
      const inDate = (i: number) => dates.some((d) => i >= d.index && i < d.index + d.text.length);
      for (const n of numbersIn(scan)) {
        if (inDate(n.index)) continue;
        const before = scan.slice(Math.max(0, n.index - 24), n.index);
        const after = scan.slice(n.index + n.text.length, n.index + n.text.length + 12);
        if (LABEL_BEFORE.test(before) || CODE_AFTER.test(after) || STREET_AFTER.test(scan.slice(n.index + n.text.length, n.index + n.text.length + 40))) continue;
        const by = numberSupported(n, input.sources);
        if (by) supported.push({ kind: "number", claim: n.text, by: describe(by) });
        else if (cited) supported.push({ kind: "number", claim: n.text, by: `Cited in the text: ${cited}` });
        else flag("number", n.text, sentence, `${n.text} is not in a confirmed fact, the budget or the opportunity record, and the sentence cites no source.`);
      }
      for (const d of dates) {
        const by = dateSupported(d, input.sources);
        if (by) supported.push({ kind: "date", claim: d.text, by: describe(by) });
        else if (cited) supported.push({ kind: "date", claim: d.text, by: `Cited in the text: ${cited}` });
        else flag("date", d.text, sentence, `${d.text} is not in a confirmed fact or the application's record, and the sentence cites no source.`);
      }
      const outcome = scan.match(OUTCOME);
      if (outcome) {
        const claim = `${outcome[1]}${outcome[2] ?? ""}`.trim().replace(/[,.;:]+$/, "");
        const words = contentWords(sentence);
        const fact = input.sources.find((s) => s.kind === "fact" && contentWords(s.text).filter((w) => words.includes(w)).length >= 2 && norm(s.text).includes(outcome[1].toLowerCase().slice(0, 5)));
        const nums = numbersIn(scan);
        const numbersBacked = nums.length > 0 && nums.every((n) => numberSupported(n, input.sources));
        if (fact) supported.push({ kind: "outcome", claim, by: describe(fact) });
        else if (cited) supported.push({ kind: "outcome", claim, by: `Cited in the text: ${cited}` });
        else if (numbersBacked) supported.push({ kind: "outcome", claim, by: "Its figures match confirmed records" });
        else flag("outcome", claim, sentence, `States a result ("${claim}") without a confirmed fact or a cited source behind it.`);
      }
      const credentials = [...scan.matchAll(CREDENTIAL_WORDS), ...scan.matchAll(CREDENTIAL_LETTERS)].map((m) => m[0]);
      for (const c of [...new Set(credentials)]) {
        const by = textHas(input.sources.filter((s) => s.kind === "fact"), c);
        if (by) supported.push({ kind: "credential", claim: c, by: describe(by) });
        else if (cited) supported.push({ kind: "credential", claim: c, by: `Cited in the text: ${cited}` });
        else flag("credential", c, sentence, `States a credential or recognition ("${c}") that no confirmed fact supports.`);
      }
    }

    const names = new Set<string>();
    for (const m of scan.matchAll(ORG_RE)) names.add(cleanName(m[0]));
    for (const m of scan.matchAll(PARTNER_PHRASE)) for (const part of m[1].split(/\s*(?:,|\band\b|&(?=\s+the\b))\s*/)) if (/^(?:the\s+)?[A-Z]/.test(part)) names.add(cleanName(part));
    for (const name of names) {
      if (name.split(/\s+/).length < 2 && !/^(?:YMCA|YWCA)$/.test(name)) continue;
      const key = norm(name);
      if (own.some((o) => o && (o.includes(key) || key.includes(o)))) continue;
      const by = textHas(input.sources, name);
      if (by) supported.push({ kind: "partner", claim: name, by: describe(by) });
      else if (cited) supported.push({ kind: "partner", claim: name, by: `Cited in the text: ${cited}` });
      else flag("partner", name, sentence, `Names ${name}, which no confirmed fact or received letter of support mentions.`);
    }
  }
  return { findings, supported };
}

// ── AI pass ───────────────────────────────────────────────────────────────

/**
 * Reads a model's list of unsupported claims. Model output is untrusted: a
 * claim is kept only if its quotation is in the section's own text, word for
 * word (ignoring case and spacing), and its kind is one of the five.
 */
export function acceptAiClaims(html: string, output: unknown): { accepted: ClaimFinding[]; dropped: number } {
  const text = htmlToText(html || "");
  const haystack = norm(text);
  const sentences = claimSentences(text);
  const items = Array.isArray(output) ? output : output && typeof output === "object" && Array.isArray((output as any).claims) ? (output as any).claims : [];
  const accepted: ClaimFinding[] = [];
  let dropped = 0;
  for (const item of items.slice(0, 50)) {
    const quote = typeof item?.quote === "string" ? item.quote.trim().slice(0, 300) : "";
    const kind = typeof item?.kind === "string" && (CLAIM_KINDS as readonly string[]).includes(item.kind) ? (item.kind as ClaimKind) : null;
    const why = typeof item?.reason === "string" ? item.reason.trim().slice(0, 300) : "";
    if (!quote || quote.length < 2 || !kind || !haystack.includes(norm(quote))) {
      dropped++;
      continue;
    }
    const sentence = sentences.find((s) => norm(s).includes(norm(quote))) ?? quote;
    const fingerprint = claimFingerprint(kind, quote, sentence);
    if (accepted.some((a) => a.fingerprint === fingerprint)) continue;
    accepted.push({ kind, claim: quote, sentence: sentence.slice(0, 600), reason: why ? `AI check: ${why}` : "AI check: no confirmed fact or cited source supports this.", fingerprint });
  }
  return { accepted: accepted.slice(0, 30), dropped };
}
