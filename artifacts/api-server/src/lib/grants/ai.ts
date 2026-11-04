import { generateForStage } from "../ai/router";
import { sanitizeRichHtml } from "../richText";
import { checkLimit } from "./text";
import { demoScaffold, limitPhrase, type DraftContext } from "./draftScaffold";

export { demoScaffold, type DraftContext } from "./draftScaffold";

/**
 * AI assistance for grant writing. Three rules hold everywhere:
 * 1. Nothing is presented as fact unless it came from the applicant's profile,
 *    the notice text or the existing section; drafts mark gaps as [Add: …].
 * 2. When no AI provider is configured, the demo provider is never passed off
 *    as writing: extraction returns nothing, drafting returns a labelled
 *    scaffold, and review returns only the rule-based checks.
 * 3. Model output is untrusted: JSON is parsed defensively and HTML sanitized.
 */

export interface ExtractedRequirement {
  kind: string;
  label: string;
  detail: string | null;
  sourceRef: string | null;
  points: number | null;
}

const KINDS = new Set(["section", "attachment", "form", "eligibility", "formatting", "criterion", "deadline"]);

/** Finds the first JSON array or object in model output and parses it. */
export function parseJsonBlock(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function coerceRequirements(value: unknown): ExtractedRequirement[] {
  const rows = Array.isArray(value) ? value : Array.isArray((value as any)?.requirements) ? (value as any).requirements : [];
  const out: ExtractedRequirement[] = [];
  for (const row of rows.slice(0, 120)) {
    if (!row || typeof row !== "object") continue;
    const label = typeof row.label === "string" ? row.label.trim().slice(0, 300) : "";
    if (!label) continue;
    const kind = typeof row.kind === "string" && KINDS.has(row.kind) ? row.kind : "section";
    const points = Number.isFinite(Number(row.points)) && Number(row.points) > 0 ? Math.round(Number(row.points)) : null;
    out.push({
      kind,
      label,
      detail: typeof row.detail === "string" ? row.detail.trim().slice(0, 2000) : null,
      sourceRef: typeof row.sourceRef === "string" ? row.sourceRef.trim().slice(0, 200) : null,
      points,
    });
  }
  return out;
}

export interface AiOutcome<T> {
  value: T;
  provider: string;
  demo: boolean;
  message?: string;
}

const MAX_NOTICE_CHARS = 60_000;

export async function extractRequirements(noticeText: string): Promise<AiOutcome<ExtractedRequirement[]>> {
  const notice = noticeText.slice(0, MAX_NOTICE_CHARS);
  const result = await generateForStage("planning", [
    {
      role: "system",
      content:
        "You read grant notices (NOFOs, RFAs, solicitations) and list every requirement an applicant must meet. You only report what the notice says; you never add requirements. Output JSON only.",
    },
    {
      role: "user",
      content:
        "Return a JSON array. Each item: {\"kind\": one of section|attachment|form|eligibility|formatting|criterion|deadline, \"label\": short name, \"detail\": the rule in the notice's own terms including page, word or character limits, \"sourceRef\": the heading or page where it appears, \"points\": review points if it is a scored criterion, otherwise null}. Include required narrative sections, attachments, forms, eligibility conditions, formatting rules, deadlines and every review criterion with its points.\n\nNOTICE:\n" +
        notice,
    },
  ], { maxTokens: 4000, temperature: 0 });
  if (result.provider === "demo") {
    return { value: [], provider: "demo", demo: true, message: "No AI provider is configured, so requirements were not extracted. Add them by hand, or configure a provider in Settings." };
  }
  return { value: coerceRequirements(parseJsonBlock(result.content)), provider: result.provider, demo: false };
}


export async function draftSection(ctx: DraftContext): Promise<AiOutcome<string>> {
  const facts = ctx.facts.length ? ctx.facts.map((f) => `- ${f}`).join("\n") : "- (none recorded)";
  const saved = ctx.savedWriting?.length
    ? `\n\nAPPROVED WRITING FROM THIS ORGANIZATION'S EARLIER APPLICATIONS (a person approved it; reuse its facts and phrasing, adapt it to this funder, and drop anything that does not fit):\n${ctx.savedWriting.map((w) => `--- ${w.title}\n${w.text}`).join("\n")}`
    : "";
  const reqs = ctx.requirements.length
    ? ctx.requirements.map((r) => `- ${r.label}${r.points ? ` (${r.points} points)` : ""}${r.detail ? `: ${r.detail}` : ""}`).join("\n")
    : "- (no requirements mapped to this section yet)";
  const result = await generateForStage("writing", [
    {
      role: "system",
      content:
        "You are an experienced grant writer. Write persuasive, plain, specific prose for one section of a grant application. Use only the facts provided. Never invent statistics, names, partners, dollar amounts, dates or results: where the section needs one, write a bracketed placeholder such as [Add: county poverty rate with source]. Answer every listed requirement. Output HTML using only <p>, <h3>, <ul>, <ol>, <li>, <strong> and <em>.",
    },
    {
      role: "user",
      content: `Write the "${ctx.section.title}" section, ${limitPhrase(ctx.section.limitType, ctx.section.limitValue)}.\n\nFUNDER: ${ctx.opportunity.agency ?? "Unknown agency"}\nOPPORTUNITY: ${ctx.opportunity.title}\nPURPOSE (from the notice): ${(ctx.opportunity.description ?? "Not available").slice(0, 3000)}\n\nAPPLICANT: ${ctx.applicant.name} (${ctx.applicant.applicantTypeLabel})\nMISSION: ${ctx.applicant.mission ?? "Not recorded"}\nSERVICE AREA: ${[ctx.applicant.serviceArea, ctx.applicant.state].filter(Boolean).join(", ") || "Not recorded"}\nFOCUS AREAS: ${ctx.applicant.focusAreas.join(", ") || "Not recorded"}\n\nVERIFIED FACTS YOU MAY USE:\n${facts}${saved}\n\nREQUIREMENTS THIS SECTION MUST ANSWER:\n${reqs}\n\nSECTION GUIDANCE: ${ctx.section.guidance ?? ""}\n\nCURRENT DRAFT (improve it, keep what is good):\n${ctx.section.content || "(empty)"}`,
    },
  ], { maxTokens: 3000, temperature: 0.4 });
  if (result.provider === "demo") {
    return { value: demoScaffold(ctx), provider: "demo", demo: true, message: "No AI provider is configured: a labelled scaffold was added instead of a draft." };
  }
  const html = sanitizeRichHtml(result.content.replace(/^```(?:html)?\s*|```\s*$/gi, ""));
  return { value: html, provider: result.provider, demo: false };
}

export interface ReviewResult {
  score: number | null;
  notes: string[];
}

/** Rule-based review that always runs, with or without AI. */
export function ruleReview(section: DraftContext["section"], requirements: DraftContext["requirements"]): string[] {
  const notes: string[] = [];
  const check = checkLimit(section.content, section.limitType, section.limitValue);
  if (!check.words) return ["The section is empty."];
  if (check.over) notes.push(`Over the limit: ${check.used} of ${check.limit} ${check.unit}.`);
  const placeholders = (section.content.match(/\[(Add|add)[^\]]*\]/g) || []).length;
  if (placeholders) notes.push(`${placeholders} placeholder${placeholders === 1 ? "" : "s"} still to fill.`);
  if (/demo scaffold/i.test(section.content)) notes.push("Contains the demo scaffold; replace it with your own writing.");
  const text = section.content.toLowerCase();
  for (const req of requirements) {
    const words = req.label.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    if (words.length && !words.some((w) => text.includes(w))) notes.push(`May not address "${req.label}".`);
  }
  return notes;
}

export async function reviewSection(ctx: DraftContext): Promise<AiOutcome<ReviewResult>> {
  const rules = ruleReview(ctx.section, ctx.requirements);
  if (rules[0] === "The section is empty.") return { value: { score: 0, notes: rules }, provider: "rules", demo: false };
  const criteria = ctx.requirements.map((r) => `- ${r.label}${r.points ? ` (${r.points} points)` : ""}${r.detail ? `: ${r.detail}` : ""}`).join("\n") || "- General clarity, specificity and evidence";
  const result = await generateForStage("evaluation", [
    {
      role: "system",
      content: "You are a federal grant peer reviewer. Score the section from 0 to 100 against the stated criteria and list the most important specific improvements. Output JSON only: {\"score\": number, \"notes\": [string]}.",
    },
    { role: "user", content: `SECTION: ${ctx.section.title}\nCRITERIA:\n${criteria}\n\nTEXT:\n${ctx.section.content.slice(0, 20_000)}` },
  ], { maxTokens: 1200, temperature: 0 });
  if (result.provider === "demo") {
    return { value: { score: null, notes: rules }, provider: "demo", demo: true, message: "No AI provider is configured: rule-based checks only, no reviewer score." };
  }
  const parsed = parseJsonBlock(result.content) as { score?: unknown; notes?: unknown } | null;
  const score = Number.isFinite(Number(parsed?.score)) ? Math.max(0, Math.min(100, Math.round(Number(parsed?.score)))) : null;
  const aiNotes = Array.isArray(parsed?.notes) ? parsed!.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 500)).slice(0, 10) : [];
  return { value: { score, notes: [...rules, ...aiNotes] }, provider: result.provider, demo: false };
}
