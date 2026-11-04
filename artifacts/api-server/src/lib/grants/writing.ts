import { htmlToText } from "./text";
import { escapeHtml } from "./draftScaffold";
import { sanitizeRichHtml } from "../richText";

/**
 * Writing toolkit (docs/GRANT_STUDIO.md, Writing toolkit): deterministic
 * checks a writer and reviewer see beside each section, the application's
 * format profile (font, size, spacing, margins, page limit, file name) and the
 * logic model. Nothing here writes prose or invents facts; every check names
 * what to fix. Pure module, unit tested directly.
 */

// ── Readability ────────────────────────────────────────────────────────────

/** A sentence longer than this is flagged; reviewers read quickly. */
export const LONG_SENTENCE_WORDS = 35;

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface Readability {
  words: number;
  sentences: number;
  /** Flesch-Kincaid grade level (U.S. school grade), one decimal. */
  grade: number | null;
  /** Flesch reading ease, 0 to 100 (higher is easier). */
  readingEase: number | null;
  longSentences: string[];
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(\[])/)
    .map((s) => s.replace(/^[.\s]+/, "").trim())
    .filter((s) => /[A-Za-z]/.test(s));
}

export function readability(html: string): Readability {
  const text = htmlToText(html || "");
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length === 0 || sentences.length === 0) return { words: 0, sentences: 0, grade: null, readingEase: null, longSentences: [] };
  const syl = words.reduce((sum, w) => sum + syllables(w), 0);
  const wps = words.length / sentences.length;
  const spw = syl / words.length;
  const grade = Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10;
  const ease = Math.round(206.835 - 1.015 * wps - 84.6 * spw);
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > LONG_SENTENCE_WORDS).map((s) => (s.length > 140 ? `${s.slice(0, 137)}…` : s));
  return { words: words.length, sentences: sentences.length, grade: Math.max(0, grade), readingEase: Math.max(0, Math.min(100, ease)), longSentences };
}

// ── Placeholders ───────────────────────────────────────────────────────────

/** Text left for a person to fill: drafting's [Add: …] markers and common stand-ins. */
const PLACEHOLDER = /\[(?:Add|Insert|TBD|TK|Justification needed|Not written yet)[^\]]*\]|\bTBD\b|\bXX+\b|\?\?\?/gi;

export function placeholders(html: string): string[] {
  const text = htmlToText(html || "");
  return [...new Set(text.match(PLACEHOLDER) ?? [])].slice(0, 20);
}

// ── SMART objectives ───────────────────────────────────────────────────────

export interface ObjectiveCheck {
  text: string;
  measurable: boolean;
  timeBound: boolean;
  baseline: boolean;
  notes: string[];
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const TIME_BOUND = new RegExp(
  `\\bby\\s+(?:${MONTHS}|the end of|end of|year|month|quarter|spring|summer|fall|autumn|winter|\\d)|\\bwithin\\s+(?:the\\s+)?(?:first\\s+)?\\d+|\\b(?:in|during)\\s+(?:year|month|quarter)\\s+\\d|\\b(?:19|20)\\d{2}\\b|\\b(?:Q[1-4]|annually|each year|per year|every year|each quarter|monthly|weekly)\\b|\\b(?:${MONTHS})\\b`,
  "i",
);
const MEASURABLE = /\d|\b(?:percent|percentage|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|fifty|hundred|thousand|half|double|all)\b/i;
const BASELINE = /\bfrom\s+[\d$.,%]+\s*(?:%|percent)?\s+to\b|\bbaseline\b|\bcurrently\b|\bup from\b|\bcompared (?:with|to)\b/i;
const VAGUE_START = /^(?:to\s+)?(?:improve|enhance|support|promote|raise awareness|increase awareness|strengthen|foster|address|help|work toward)\b/i;

/** Objectives from a section: its list items, or else its sentences. */
export function extractObjectives(html: string): string[] {
  const safe = html || "";
  const items = [...safe.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => htmlToText(m[1])).filter(Boolean);
  if (items.length) return items.slice(0, 30);
  return splitSentences(htmlToText(safe)).filter((s) => /\b(?:objective|will|increase|reduce|serve|train|enroll|complete|achieve|improve|deliver)\b/i.test(s)).slice(0, 30);
}

export function checkObjective(text: string): ObjectiveCheck {
  const measurable = MEASURABLE.test(text);
  const timeBound = TIME_BOUND.test(text);
  const baseline = BASELINE.test(text);
  const notes: string[] = [];
  if (!measurable) notes.push("Add a number: how many, how much or what percentage.");
  if (!timeBound) notes.push("Add when: a date, a project month or a reporting period.");
  if (measurable && !baseline && /\b(?:increase|reduce|decrease|raise|lower|improve|grow)\b/i.test(text)) notes.push("Give the starting point (baseline) so the change can be measured.");
  if (VAGUE_START.test(text.trim()) && !measurable) notes.push("Start with a concrete action and a measurable result instead of a general aim.");
  return { text: text.length > 240 ? `${text.slice(0, 237)}…` : text, measurable, timeBound, baseline, notes };
}

/** Section keys whose content is a list of objectives. */
export const OBJECTIVE_SECTION_KEYS = new Set(["objectives", "technical_objectives", "goals"]);

export function isObjectiveSection(key: string, title: string): boolean {
  return OBJECTIVE_SECTION_KEYS.has(key) || /\bobjectives?\b/i.test(title);
}

// ── Section checks ─────────────────────────────────────────────────────────

export interface SectionWritingChecks {
  readability: Readability;
  placeholders: string[];
  objectives: ObjectiveCheck[] | null;
  /** Plain-language notes, most important first. */
  notes: string[];
}

/** Reading grade above which reviewers of general programs may struggle. */
export const GRADE_ADVISORY = 14;

export function sectionWritingChecks(section: { key: string; title: string; content: string }): SectionWritingChecks {
  const r = readability(section.content);
  const ph = placeholders(section.content);
  const objectives = isObjectiveSection(section.key, section.title) ? extractObjectives(section.content).map(checkObjective) : null;
  const notes: string[] = [];
  if (ph.length) notes.push(`Fill ${ph.length} placeholder${ph.length === 1 ? "" : "s"}: ${ph.slice(0, 3).join("; ")}${ph.length > 3 ? "; …" : ""}.`);
  if (objectives) {
    const weak = objectives.filter((o) => o.notes.length).length;
    if (objectives.length === 0 && r.words > 0) notes.push("List each objective as its own bullet so each can be checked.");
    else if (weak) notes.push(`${weak} of ${objectives.length} objective${objectives.length === 1 ? "" : "s"} could be more specific, measurable or time-bound.`);
  }
  if (r.grade !== null && r.grade > GRADE_ADVISORY) notes.push(`Reading grade ${r.grade}: shorter sentences and plainer words help reviewers score quickly.`);
  if (r.longSentences.length) notes.push(`${r.longSentences.length} sentence${r.longSentences.length === 1 ? " is" : "s are"} over ${LONG_SENTENCE_WORDS} words.`);
  return { readability: r, placeholders: ph, objectives, notes };
}

// ── Format profile ─────────────────────────────────────────────────────────

export const FORMAT_FONTS = ["Times New Roman", "Arial", "Calibri", "Garamond", "Georgia", "Helvetica"] as const;
export type FormatFont = (typeof FORMAT_FONTS)[number];

export interface FormatProfile {
  font: FormatFont;
  sizePt: number;
  lineSpacing: number;
  marginsIn: number;
  /** The notice's page limit for the narrative, when it states one. */
  pageLimit: number | null;
  /** The file name to use for the package, following the notice or Grants.gov's rules. */
  fileName: string | null;
}

/** Grant Studio's default, which most federal notices accept. */
export const DEFAULT_FORMAT: FormatProfile = { font: "Times New Roman", sizePt: 12, lineSpacing: 1, marginsIn: 1, pageLimit: null, fileName: null };

export function formatProfileOf(value: unknown): FormatProfile {
  const v = (value && typeof value === "object" ? value : {}) as Partial<FormatProfile>;
  return {
    font: FORMAT_FONTS.includes(v.font as FormatFont) ? (v.font as FormatFont) : DEFAULT_FORMAT.font,
    sizePt: typeof v.sizePt === "number" ? v.sizePt : DEFAULT_FORMAT.sizePt,
    lineSpacing: typeof v.lineSpacing === "number" ? v.lineSpacing : DEFAULT_FORMAT.lineSpacing,
    marginsIn: typeof v.marginsIn === "number" ? v.marginsIn : DEFAULT_FORMAT.marginsIn,
    pageLimit: typeof v.pageLimit === "number" ? v.pageLimit : null,
    fileName: typeof v.fileName === "string" && v.fileName ? v.fileName : null,
  };
}

/** Validates a format profile from a request; returns the profile or a message naming every problem. */
export function parseFormatProfile(value: unknown): FormatProfile | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "formatProfile must be an object";
  const v = value as Record<string, unknown>;
  const unknownKeys = Object.keys(v).filter((k) => !["font", "sizePt", "lineSpacing", "marginsIn", "pageLimit", "fileName"].includes(k));
  if (unknownKeys.length) return `Unknown format field(s): ${unknownKeys.join(", ")}`;
  const problems: string[] = [];
  const out: FormatProfile = { ...DEFAULT_FORMAT };
  if (v.font !== undefined) {
    if (!FORMAT_FONTS.includes(v.font as FormatFont)) problems.push(`font must be one of: ${FORMAT_FONTS.join(", ")}`);
    else out.font = v.font as FormatFont;
  }
  const num = (key: "sizePt" | "lineSpacing" | "marginsIn", min: number, max: number) => {
    if (v[key] === undefined) return;
    const n = Number(v[key]);
    if (!Number.isFinite(n) || n < min || n > max) problems.push(`${key} must be between ${min} and ${max}`);
    else out[key] = Math.round(n * 100) / 100;
  };
  num("sizePt", 8, 16);
  num("lineSpacing", 1, 3);
  num("marginsIn", 0.5, 2);
  if (v.pageLimit !== undefined && v.pageLimit !== null && v.pageLimit !== "") {
    const n = Number(v.pageLimit);
    if (!Number.isInteger(n) || n < 1 || n > 500) problems.push("pageLimit must be a whole number of pages from 1 to 500");
    else out.pageLimit = n;
  }
  if (v.fileName !== undefined && v.fileName !== null && v.fileName !== "") {
    if (typeof v.fileName !== "string") problems.push("fileName must be text");
    else {
      const issues = fileNameIssues(v.fileName.trim());
      if (issues.some((i) => i.blocking)) problems.push(`fileName: ${issues.filter((i) => i.blocking).map((i) => i.message).join(" ")}`);
      else out.fileName = v.fileName.trim();
    }
  }
  return problems.length ? problems.join("; ") : out;
}

/** Relative width of each font's characters against Times New Roman (an estimate). */
const FONT_WIDTH: Record<FormatFont, number> = { "Times New Roman": 1, Garamond: 0.97, Georgia: 1.12, Calibri: 1.03, Arial: 1.13, Helvetica: 1.13 };

/**
 * About how many words fit on a US Letter page with this profile. Calibrated
 * to about 500 words for Times New Roman 12 pt, single spaced, 1-inch margins.
 * An estimate: check the exported file before submitting.
 */
export function wordsPerPage(profile: FormatProfile): number {
  const area = (8.5 - 2 * profile.marginsIn) * (11 - 2 * profile.marginsIn);
  const base = 500 * (area / (6.5 * 9));
  const sizeFactor = (12 / profile.sizePt) ** 2;
  return Math.max(50, Math.round((base * sizeFactor) / profile.lineSpacing / FONT_WIDTH[profile.font]));
}

export interface FormatCheck {
  profile: FormatProfile;
  wordsPerPage: number;
  estimatedPages: number;
  pageLimit: number | null;
  over: boolean;
  fileName: string | null;
  fileNameIssues: FileNameIssue[];
}

export function checkFormat(profile: FormatProfile, sections: { content: string }[]): FormatCheck {
  const wpp = wordsPerPage(profile);
  const words = sections.reduce((sum, s) => sum + htmlToText(s.content || "").split(/\s+/).filter(Boolean).length, 0);
  // Each section starts with a heading and some spacing: about a sixth of a page.
  const estimatedPages = Math.round((words / wpp + sections.length / 6) * 10) / 10;
  return {
    profile,
    wordsPerPage: wpp,
    estimatedPages,
    pageLimit: profile.pageLimit,
    over: profile.pageLimit !== null && estimatedPages > profile.pageLimit,
    fileName: profile.fileName,
    fileNameIssues: profile.fileName ? fileNameIssues(profile.fileName) : [],
  };
}

// ── Grants.gov attachment file names ──────────────────────────────────────

export interface FileNameIssue {
  message: string;
  /** Blocking issues break Grants.gov's default rules; others are cautions. */
  blocking: boolean;
}

/** Grants.gov's default limit when the agency sets none (Applicant FAQs). */
export const GRANTS_GOV_FILENAME_MAX = 50;
/** The characters Grants.gov accepts by default in attachment names. */
const GRANTS_GOV_ALLOWED = /^[A-Za-z0-9_\-. (){}[\]&~!,;'@#$%+=]+$/;
/** The narrow set that every agency accepts. */
const CONSERVATIVE = /^[A-Za-z0-9_\-.]+$/;

export function fileNameIssues(name: string): FileNameIssue[] {
  const issues: FileNameIssue[] = [];
  if (!name) return [{ message: "Enter a file name.", blocking: true }];
  if (name.length > GRANTS_GOV_FILENAME_MAX) issues.push({ message: `It is ${name.length} characters; Grants.gov allows ${GRANTS_GOV_FILENAME_MAX} unless the notice says otherwise.`, blocking: true });
  if (!GRANTS_GOV_ALLOWED.test(name)) issues.push({ message: "It has characters Grants.gov does not accept. Use letters, numbers, underscores, hyphens and periods.", blocking: true });
  else if (!CONSERVATIVE.test(name)) issues.push({ message: "Spaces and symbols are allowed by Grants.gov but refused by some agencies. Underscores and hyphens are safest.", blocking: false });
  if (/^\./.test(name) || /\.\./.test(name)) issues.push({ message: "Do not start the name with a period or use two periods in a row.", blocking: false });
  return issues;
}

/** A safe default package file name: organization and opportunity number, Grants.gov-safe and at most 50 characters with ".docx". */
export function defaultFileStem(applicantName: string, opportunityNumber: string | null, draft: boolean): string {
  const suffix = draft ? "_DRAFT" : "";
  const base = `${applicantName}_${opportunityNumber ?? "Application"}`.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return base.slice(0, GRANTS_GOV_FILENAME_MAX - 5 - suffix.length) + suffix;
}

// ── Logic model ────────────────────────────────────────────────────────────

export const LOGIC_MODEL_COLUMNS = {
  inputs: { label: "Inputs", hint: "Staff, partners, funding, facilities and materials the project uses." },
  activities: { label: "Activities", hint: "What the project does with those inputs." },
  outputs: { label: "Outputs", hint: "Direct, countable products: people served, sessions held, materials made." },
  shortTerm: { label: "Short-term outcomes", hint: "Changes in knowledge, skills or attitudes, usually within the first year." },
  intermediate: { label: "Intermediate outcomes", hint: "Changes in behavior or practice." },
  longTerm: { label: "Long-term impact", hint: "The lasting change in the community or condition." },
  assumptions: { label: "Assumptions and external factors", hint: "What must hold true, and what outside the project could affect results." },
} as const;

export type LogicModelColumn = keyof typeof LOGIC_MODEL_COLUMNS;
export type LogicModel = Partial<Record<LogicModelColumn, string[]>>;
export const LOGIC_MODEL_KEYS = Object.keys(LOGIC_MODEL_COLUMNS) as LogicModelColumn[];

export function parseLogicModel(value: unknown): LogicModel | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "logicModel must be an object";
  const v = value as Record<string, unknown>;
  const unknownKeys = Object.keys(v).filter((k) => !(LOGIC_MODEL_KEYS as string[]).includes(k));
  if (unknownKeys.length) return `Unknown logic model column(s): ${unknownKeys.join(", ")}`;
  const out: LogicModel = {};
  for (const key of LOGIC_MODEL_KEYS) {
    if (v[key] === undefined) continue;
    if (!Array.isArray(v[key])) return `${key} must be a list of text`;
    out[key] = (v[key] as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 500)).filter(Boolean).slice(0, 25);
  }
  return out;
}

/** Problems that make a logic model incomplete, in the order a reviewer reads it. */
export function logicModelGaps(model: LogicModel): string[] {
  const gaps: string[] = [];
  for (const key of ["inputs", "activities", "outputs", "shortTerm", "longTerm"] as const) {
    if (!model[key]?.length) gaps.push(`Add at least one item under ${LOGIC_MODEL_COLUMNS[key].label}.`);
  }
  const outcomes = [...(model.shortTerm ?? []), ...(model.intermediate ?? []), ...(model.longTerm ?? [])];
  if (outcomes.length && !outcomes.some((o) => MEASURABLE.test(o))) gaps.push("Make at least one outcome measurable (a number or percentage).");
  return gaps;
}

/** The logic model as section HTML: a heading per column and a list, which the editor and the DOCX export both keep. */
export function logicModelHtml(model: LogicModel): string {
  const parts: string[] = [];
  for (const key of LOGIC_MODEL_KEYS) {
    const items = model[key] ?? [];
    if (!items.length) continue;
    parts.push(`<h3>${escapeHtml(LOGIC_MODEL_COLUMNS[key].label)}</h3><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`);
  }
  return sanitizeRichHtml(parts.join(""));
}

// ── Letters of support ─────────────────────────────────────────────────────

export const LETTER_STATUSES = ["to_request", "requested", "received", "declined"] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];
export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = { to_request: "To request", requested: "Requested", received: "Received", declined: "Declined" };
