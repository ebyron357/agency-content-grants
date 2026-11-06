/**
 * The requirement checklist proposed from a notice's pages
 * (docs/GRANT_STUDIO.md, Notice PDF and requirement checklist).
 *
 * Three rules hold:
 * 1. Every proposed row cites the page it came from and quotes the notice's
 *    own words. A row whose page is missing or out of range, or whose quote
 *    is not on that page, is rejected here, so nothing is added that the
 *    notice does not say.
 * 2. Every row is proposed: it joins the compliance matrix unconfirmed, and
 *    only a person confirms it.
 * 3. With no AI provider configured, rows come from labelled pattern
 *    matching (`demo_rules`), under the same validation, never from the demo
 *    model and never presented as AI output.
 *
 * Pure module: no database import. The AI call is passed in, so the
 * validation is unit-tested with a mocked model response.
 */

import { parseJsonBlock } from "./aiJson";

export const CHECKLIST_KINDS = ["section", "attachment", "form", "eligibility", "formatting", "criterion", "deadline"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export interface ProposedRequirement {
  kind: ChecklistKind;
  label: string;
  detail: string | null;
  /** 1-based page number in the notice. */
  page: number;
  /** The notice's words on that page. */
  quote: string;
  points: number | null;
}

export interface RejectedProposal {
  label: string;
  reason: string;
}

export const CHECKLIST_LIMITS = {
  maxRows: 150,
  /** Characters of notice text per AI request (page markers included). */
  charsPerChunk: 45_000,
  /** AI requests per notice; pages beyond are not sent and the notice says so. */
  maxChunks: 8,
  minQuote: 12,
  maxQuote: 500,
} as const;

/** Lower case, one space, plain quotes and dashes, no hyphenation across line breaks. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/-\s*\n\s*/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * True when the quote appears on the page. A quote may run onto the next page
 * (it must start on the cited one) and may skip words with an ellipsis, as
 * long as each part is on the page in order.
 */
export function quoteOnPage(quote: string, pages: string[], page: number): boolean {
  const here = normalizeForMatch(pages[page - 1] ?? "");
  if (!here) return false;
  const next = normalizeForMatch(pages[page] ?? "");
  const haystack = next ? `${here} ${next}` : here;
  const parts = normalizeForMatch(quote).split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.replace(/^["']|["']$/g, "").trim()).filter((p) => p.length > 0);
  if (!parts.length) return false;
  let from = 0;
  for (let i = 0; i < parts.length; i++) {
    const at = haystack.indexOf(parts[i], from);
    if (at < 0) return false;
    if (i === 0 && at >= here.length) return false;
    from = at + parts[i].length;
  }
  return true;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Validates proposed rows against the pages they cite. Rows without a valid
 * page citation, or whose quote is not on the cited page, are rejected with a
 * reason. Points are kept only when the number appears in the quote.
 */
export function validateProposals(raw: unknown, pages: string[]): { accepted: ProposedRequirement[]; rejected: RejectedProposal[] } {
  const rows: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as { requirements?: unknown })?.requirements) ? (raw as { requirements: unknown[] }).requirements : [];
  const accepted: ProposedRequirement[] = [];
  const rejected: RejectedProposal[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (accepted.length >= CHECKLIST_LIMITS.maxRows) break;
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label = cleanText(r.label, 300);
    if (!label) {
      rejected.push({ label: "(no label)", reason: "No label." });
      continue;
    }
    const kind = (CHECKLIST_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as ChecklistKind) : null;
    if (!kind) {
      rejected.push({ label, reason: `Unknown kind "${String(r.kind).slice(0, 40)}".` });
      continue;
    }
    const page = typeof r.page === "number" ? r.page : typeof r.page === "string" && /^\s*\d+\s*$/.test(r.page) ? Number(r.page) : NaN;
    if (!Number.isInteger(page) || page < 1) {
      rejected.push({ label, reason: "No page citation." });
      continue;
    }
    if (page > pages.length) {
      rejected.push({ label, reason: `Cites page ${page}, but the notice has ${pages.length} page${pages.length === 1 ? "" : "s"} read.` });
      continue;
    }
    const quote = cleanText(r.quote, CHECKLIST_LIMITS.maxQuote);
    if (quote.length < CHECKLIST_LIMITS.minQuote) {
      rejected.push({ label, reason: "No quotation from the notice." });
      continue;
    }
    if (!quoteOnPage(quote, pages, page)) {
      rejected.push({ label, reason: `The quotation is not on page ${page}.` });
      continue;
    }
    const n = Number(r.points);
    const points = Number.isFinite(n) && n > 0 && n <= 1000 && Number.isInteger(n) && new RegExp(`\\b${n}\\b`).test(quote) ? n : null;
    const key = `${kind}|${normalizeForMatch(label)}|${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = cleanText(r.detail, 2000) || null;
    accepted.push({ kind, label, detail, page, quote, points });
  }
  return { accepted, rejected };
}

/** Splits pages into AI requests, each page marked `[[PAGE n]]`. Pages that do not fit are left out. */
export function chunkPages(pages: string[], limits: { charsPerChunk: number; maxChunks: number } = CHECKLIST_LIMITS): { chunks: string[]; pagesSent: number } {
  const chunks: string[] = [];
  let current = "";
  let pagesSent = 0;
  for (let i = 0; i < pages.length; i++) {
    const block = `[[PAGE ${i + 1}]]\n${pages[i]}\n\n`;
    if (current && current.length + block.length > limits.charsPerChunk) {
      chunks.push(current);
      current = "";
      if (chunks.length >= limits.maxChunks) break;
    }
    current += block.slice(0, limits.charsPerChunk);
    pagesSent = i + 1;
  }
  if (current && chunks.length < limits.maxChunks) chunks.push(current);
  else if (current) pagesSent -= 1;
  return { chunks, pagesSent };
}

export const CHECKLIST_SYSTEM_PROMPT =
  "You read grant notices (NOFOs, RFAs, solicitations) and list the requirements an applicant must meet. You only report what the notice says, you never add or infer requirements, and you cite the page of each one. Output JSON only.";

export function checklistUserPrompt(chunk: string): string {
  return (
    'Return a JSON array. Each item: {"kind": one of section|attachment|form|eligibility|formatting|criterion|deadline, "label": a short name, "detail": the rule in the notice\'s own terms, including any page, word or character limit, "page": the number from the [[PAGE n]] marker of the page where it is stated, "quote": the exact words of the notice that state it (copied verbatim, 12 to 300 characters, from that page), "points": the review points if it is a scored criterion, otherwise null}.\n' +
    "Include: required narrative sections and their page, word or character limits; required attachments and forms; eligibility conditions; formatting rules (font, size, spacing, margins, file type); deadlines; and every review criterion with its points. Leave out anything the notice does not state. An item without a page and a verbatim quote will be discarded.\n\nNOTICE PAGES:\n" +
    chunk
  );
}

export interface GenerateResult {
  content: string;
  provider: string;
}

export type Generate = (messages: { role: "system" | "user"; content: string }[], options: { maxTokens: number; temperature: number }) => Promise<GenerateResult>;

export interface ChecklistOutcome {
  accepted: ProposedRequirement[];
  rejected: RejectedProposal[];
  /** `ai:<provider>` or `demo_rules`. */
  extractedBy: string;
  provider: string;
  demo: boolean;
  pagesSent: number;
  message: string | null;
}

/** Proposes the checklist: the AI provider when one is configured, otherwise labelled pattern matching. */
export async function proposeChecklist(pages: string[], generate: Generate, opts: { signal?: AbortSignal; onChunk?: (done: number, total: number) => Promise<void> | void } = {}): Promise<ChecklistOutcome> {
  const { chunks, pagesSent } = chunkPages(pages);
  const raw: unknown[] = [];
  let provider = "";
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw new Error("Proposing the checklist was stopped.");
    const result = await generate([
      { role: "system", content: CHECKLIST_SYSTEM_PROMPT },
      { role: "user", content: checklistUserPrompt(chunks[i]) },
    ], { maxTokens: 4000, temperature: 0 });
    if (result.provider === "demo") {
      const demo = demoChecklist(pages);
      return { ...demo, extractedBy: "demo_rules", provider: "demo", demo: true, pagesSent: pages.length, message: "Demo: no AI provider is configured, so these rows were found by pattern matching on the notice's own words, not by AI. Each one still cites its page. Review every row; add what pattern matching missed by hand." };
    }
    provider = result.provider;
    const parsed = parseJsonBlock(result.content);
    if (Array.isArray(parsed)) raw.push(...parsed);
    else if (Array.isArray((parsed as { requirements?: unknown })?.requirements)) raw.push(...(parsed as { requirements: unknown[] }).requirements);
    await opts.onChunk?.(i + 1, chunks.length);
  }
  const { accepted, rejected } = validateProposals(raw, pages);
  const left = pages.length - pagesSent;
  return {
    accepted,
    rejected,
    extractedBy: `ai:${provider || "unknown"}`,
    provider: provider || "unknown",
    demo: false,
    pagesSent,
    message: left > 0 ? `Pages ${pagesSent + 1} to ${pages.length} were too long to send in one run and were not read for requirements. Check them by hand.` : null,
  };
}

// ── Demo: pattern matching (no AI key) ────────────────────────────────────────

/** Sentences of a page, with the text kept as written. */
export function sentences(page: string): string[] {
  return page
    .split(/(?<=[.;!?])\s+(?=[A-Z0-9("•\-])|\n+/)
    .map((s) => s.replace(/\s+/g, " ").replace(/^[•\-–]\s*/, "").trim())
    .filter((s) => s.length >= CHECKLIST_LIMITS.minQuote);
}

interface Rule {
  kind: ChecklistKind;
  test: RegExp;
  label: (m: RegExpMatchArray, sentence: string) => string;
  points?: (m: RegExpMatchArray) => number | null;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const DEMO_RULES: Rule[] = [
  { kind: "criterion", test: /\b(\d{1,3})\s*(?:points?|pts\.?)\b/i, label: (_m, s) => short(s.replace(/\s*[(:-]?\s*\d{1,3}\s*(?:points?|pts\.?)\)?/i, "").replace(/[.:;,]+$/, "")) || "Review criterion", points: (m) => Number(m[1]) },
  { kind: "formatting", test: /\b(?:must not exceed|not to exceed|may not exceed|no (?:more|longer) than|limited to|maximum of|up to)\s+(\d[\d,]*)\s+(pages?|words|characters)\b/i, label: (m) => `Limit: ${m[1]} ${m[2].toLowerCase()}` },
  { kind: "formatting", test: /\b(\d{1,2})[- ]?(?:point|pt\.?)\s+(?:font|type)\b|\bfont size\b|\bmargins? of\b|\b(?:single|double)[- ]spaced\b/i, label: (_m, s) => `Format: ${short(s, 70)}` },
  { kind: "deadline", test: /\b(?:due|deadline|closing date|must be (?:received|submitted)|no later than)\b[^.]*?\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i, label: (m) => `Deadline: ${m[1]}` },
  { kind: "attachment", test: /\b(?:letters? of (?:support|commitment)|resumes?|biographical sketch(?:es)?|organizational chart|logic model|indirect cost rate agreement|audit(?:ed)? financial statements?)\b[^.]*\b(?:required|must|shall)\b|\b(?:required|must|shall)\b[^.]*\b(?:attach|include|submit)\b[^.]*\b(?:letters? of (?:support|commitment)|resumes?|biographical sketch(?:es)?|organizational chart|logic model|appendix|attachment)\b/i, label: (_m, s) => `Attachment: ${short(s, 70)}` },
  { kind: "eligibility", test: /\b(?:eligible applicants?|eligibility|only .{0,40}\b(?:are|is) eligible|applicants? must be)\b/i, label: (_m, s) => `Eligibility: ${short(s, 70)}` },
  { kind: "form", test: /\b(?:SF-?424[A-D]?|SF-?LLL|SF-?PPR|Project\/Performance Site Location)\b/i, label: (m) => `Form: ${m[0].toUpperCase().replace(/^SF(?!-)/, "SF-")}` },
];

/** Pattern matching on each page. Labelled demo: it finds phrasing, not meaning, and every row still cites its page. */
export function demoChecklist(pages: string[]): { accepted: ProposedRequirement[]; rejected: RejectedProposal[] } {
  const raw: Record<string, unknown>[] = [];
  pages.forEach((text, i) => {
    for (const sentence of sentences(text)) {
      for (const rule of DEMO_RULES) {
        const m = sentence.match(rule.test);
        if (!m) continue;
        raw.push({ kind: rule.kind, label: rule.label(m, sentence), detail: sentence.slice(0, 2000), page: i + 1, quote: sentence.slice(0, CHECKLIST_LIMITS.maxQuote), points: rule.points?.(m) ?? null });
        break;
      }
    }
  });
  return validateProposals(raw, pages);
}
