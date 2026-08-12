/**
 * Brand Brain — reusable brand intelligence layer.
 *
 * Two responsibilities:
 * 1. Retrieval: select the RELEVANT slice of a brand's knowledge for a given
 *    generation task (never the whole brain). Rule categories (terminology,
 *    compliance, custom instructions, preferred phrases) are always included;
 *    reference categories (positioning, competitors, stats, ...) are ranked by
 *    keyword overlap with the topic and capped by a size budget.
 * 2. Validation: score arbitrary content against brand rules — deterministic
 *    checks (banned phrases, preferred terminology, required claims,
 *    compliance markers) plus an AI voice assessment (done in the route layer
 *    where provider access lives).
 *
 * The pure functions (tokenize, scoreEntry, selectRelevantEntries,
 * validateDeterministic) take plain data so they can be unit-tested without
 * a database.
 */
import { db } from "@workspace/db";
import {
  brandKnowledgeEntriesTable,
  brandFactsTable,
  type Brand,
  type BrandFact,
  type BrandKnowledgeEntry,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Categories ───────────────────────────────────────────────────────────────

export interface BrainCategoryMeta {
  label: string;
  /** rule categories are hard guidance: always included in prompts, always validated */
  rule: boolean;
  description: string;
}

export const BRAND_BRAIN_CATEGORIES: Record<string, BrainCategoryMeta> = {
  positioning: { label: "Positioning", rule: false, description: "How the brand is positioned in the market" },
  icp: { label: "Ideal Customer Profile", rule: false, description: "Who the ideal customer is" },
  product_service: { label: "Product/Service", rule: false, description: "What the brand sells" },
  differentiator: { label: "Differentiator", rule: false, description: "What makes the brand different" },
  competitor: { label: "Competitor", rule: false, description: "Competitors and how the brand compares" },
  messaging_pillar: { label: "Messaging Pillar", rule: false, description: "Core themes every asset should reinforce" },
  terminology: { label: "Terminology", rule: true, description: "Words to use (or forbid — set structured.forbidden)" },
  preferred_phrase: { label: "Preferred Phrase", rule: true, description: "Phrases the brand prefers" },
  cta: { label: "Call to Action", rule: false, description: "Approved CTAs" },
  statistic: { label: "Approved Statistic", rule: false, description: "Vetted statistics that may be cited" },
  compliance: { label: "Compliance Rule", rule: true, description: "Regulatory/legal constraints content must follow" },
  example_content: { label: "Example Content", rule: false, description: "On-brand example excerpts" },
  visual_identity: { label: "Visual Identity", rule: false, description: "Visual identity metadata" },
  url_domain: { label: "URL/Domain", rule: false, description: "Brand URLs and domains" },
  custom_instruction: { label: "Custom Instruction", rule: true, description: "Any other standing instruction" },
  other: { label: "Other", rule: false, description: "Anything else" },
};

export function isValidCategory(category: string): boolean {
  return category in BRAND_BRAIN_CATEGORIES;
}

// ── Relevance selection ──────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "for", "to", "in", "on", "with",
  "is", "are", "was", "were", "be", "by", "at", "as", "it", "its", "this",
  "that", "these", "those", "from", "how", "what", "why", "when", "your", "our",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Keyword-overlap score: label hits count double. */
export function scoreEntry(entry: Pick<BrandKnowledgeEntry, "label" | "content">, topicTokens: Set<string>): number {
  let score = 0;
  for (const t of tokenize(entry.label)) if (topicTokens.has(t)) score += 2;
  for (const t of tokenize(entry.content)) if (topicTokens.has(t)) score += 1;
  return score;
}

export interface BrainSelection {
  rules: BrandKnowledgeEntry[];
  reference: BrandKnowledgeEntry[];
}

const MAX_REFERENCE_ENTRIES = 12;
const MAX_REFERENCE_CHARS = 2000;

/**
 * Select the relevant slice of the brain. Rules are always included.
 * Reference entries are ranked by topic relevance; irrelevant entries
 * (score 0) and anything past the budget are left out.
 */
export function selectRelevantEntries(
  entries: BrandKnowledgeEntry[],
  topic: string,
): BrainSelection {
  const enabled = entries.filter((e) => e.enabled);
  const rules = enabled.filter((e) => BRAND_BRAIN_CATEGORIES[e.category]?.rule === true);
  const topicTokens = new Set(tokenize(topic));

  const scored = enabled
    .filter((e) => BRAND_BRAIN_CATEGORIES[e.category]?.rule !== true)
    .map((e) => ({ e, score: scoreEntry(e, topicTokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const reference: BrandKnowledgeEntry[] = [];
  let chars = 0;
  for (const { e } of scored) {
    if (reference.length >= MAX_REFERENCE_ENTRIES) break;
    const size = e.label.length + e.content.length;
    if (chars + size > MAX_REFERENCE_CHARS) continue;
    reference.push(e);
    chars += size;
  }
  return { rules, reference };
}

function formatEntry(e: BrandKnowledgeEntry): string {
  const meta = BRAND_BRAIN_CATEGORIES[e.category];
  return `- [${meta?.label ?? e.category}] ${e.label}: ${e.content}`;
}

/** Render a selection as prompt text (empty string when nothing selected). */
export function formatBrainBlock(selection: BrainSelection): string {
  const parts: string[] = [];
  if (selection.rules.length > 0) {
    parts.push(`Brand rules (must follow):\n${selection.rules.map(formatEntry).join("\n")}`);
  }
  if (selection.reference.length > 0) {
    parts.push(`Relevant brand knowledge (use where it fits, never contradict):\n${selection.reference.map(formatEntry).join("\n")}`);
  }
  return parts.join("\n\n");
}

/** DB-loading wrapper used by the generation workflows. */
export async function getBrandBrainBlock(brandId: string, topic: string): Promise<string> {
  const entries = await db
    .select()
    .from(brandKnowledgeEntriesTable)
    .where(and(eq(brandKnowledgeEntriesTable.brandId, brandId), eq(brandKnowledgeEntriesTable.enabled, true)));
  if (entries.length === 0) return "";
  return formatBrainBlock(selectRelevantEntries(entries, topic));
}

// ── Deterministic validation ─────────────────────────────────────────────────

export interface BrandCheck {
  type: "banned_phrases" | "terminology" | "required_claims" | "compliance";
  label: string;
  passed: boolean;
  /** 0-100 */
  score: number;
  detail: string;
  violations: string[];
}

/** Split a free-form vocabulary list (comma/semicolon/newline separated). */
export function splitVocab(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fuzzy presence: ≥60% of the claim's significant tokens appear in the content. */
export function claimAppearsIn(claim: string, contentTokens: Set<string>): boolean {
  const tokens = tokenize(claim);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => contentTokens.has(t)).length;
  return hits / tokens.length >= 0.6;
}

/**
 * Deterministic brand checks. Pure function — no DB, no AI.
 * Banned phrases come from the brand's prohibitedVocabulary plus terminology
 * entries flagged structured.forbidden. Compliance entries may declare
 * structured.requires (phrases that must appear) and structured.never
 * (phrases that must not appear).
 */
export function validateDeterministic(
  brand: Pick<Brand, "prohibitedVocabulary" | "preferredVocabulary" | "complianceNotes">,
  facts: Pick<BrandFact, "claim" | "status">[],
  entries: BrandKnowledgeEntry[],
  content: string,
): BrandCheck[] {
  const enabled = entries.filter((e) => e.enabled);
  const lower = content.toLowerCase();
  const contentTokens = new Set(tokenize(content));
  const checks: BrandCheck[] = [];

  // 1. Banned phrases
  const banned = [
    ...splitVocab(brand.prohibitedVocabulary),
    ...enabled
      .filter((e) => e.category === "terminology" && (e.structured as any)?.forbidden === true)
      .map((e) => e.content),
  ];
  const bannedHits = banned.filter((term) => term && lower.includes(term.toLowerCase()));
  checks.push({
    type: "banned_phrases",
    label: "Banned phrases",
    passed: bannedHits.length === 0,
    score: bannedHits.length === 0 ? 100 : Math.max(0, 100 - bannedHits.length * 25),
    detail: bannedHits.length === 0 ? "No prohibited language found" : `${bannedHits.length} prohibited term(s) used`,
    violations: bannedHits,
  });

  // 2. Preferred terminology coverage (advisory)
  const preferred = [
    ...splitVocab(brand.preferredVocabulary),
    ...enabled.filter((e) => e.category === "preferred_phrase").map((e) => e.content),
    ...enabled
      .filter((e) => e.category === "terminology" && (e.structured as any)?.forbidden !== true)
      .map((e) => e.content),
  ];
  const prefHits = preferred.filter((term) => term && lower.includes(term.toLowerCase()));
  const prefScore = preferred.length === 0 ? 100 : Math.round((prefHits.length / preferred.length) * 100);
  checks.push({
    type: "terminology",
    label: "Preferred terminology",
    passed: preferred.length === 0 || prefHits.length > 0,
    score: prefScore,
    detail:
      preferred.length === 0
        ? "No preferred terminology configured"
        : `${prefHits.length}/${preferred.length} preferred term(s) used`,
    violations: preferred.filter((t) => t && !prefHits.includes(t)),
  });

  // 3. Required claims (active brand facts should be reflected)
  const requiredFacts = facts.filter((f) => f.status === "active" || f.status === "verified");
  const missing = requiredFacts.filter((f) => !claimAppearsIn(f.claim, contentTokens));
  checks.push({
    type: "required_claims",
    label: "Required claims",
    passed: missing.length === 0,
    score: requiredFacts.length === 0 ? 100 : Math.round(((requiredFacts.length - missing.length) / requiredFacts.length) * 100),
    detail:
      requiredFacts.length === 0
        ? "No required claims configured"
        : missing.length === 0
          ? "All brand claims represented"
          : `${missing.length} brand claim(s) not reflected`,
    violations: missing.map((f) => f.claim),
  });

  // 4. Compliance markers
  const complianceEntries = enabled.filter((e) => e.category === "compliance");
  const violations: string[] = [];
  for (const e of complianceEntries) {
    const s = (e.structured ?? {}) as { requires?: string[]; never?: string[] };
    for (const phrase of s.requires ?? []) {
      if (!lower.includes(phrase.toLowerCase())) violations.push(`Missing required phrase: "${phrase}" (${e.label})`);
    }
    for (const phrase of s.never ?? []) {
      if (lower.includes(phrase.toLowerCase())) violations.push(`Forbidden phrase present: "${phrase}" (${e.label})`);
    }
  }
  const hasComplianceConfig = complianceEntries.length > 0 || !!brand.complianceNotes;
  checks.push({
    type: "compliance",
    label: "Compliance rules",
    passed: violations.length === 0,
    score: violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 25),
    detail: !hasComplianceConfig
      ? "No structured compliance rules configured"
      : violations.length === 0
        ? "All structured compliance rules satisfied"
        : `${violations.length} compliance violation(s)`,
    violations,
  });

  return checks;
}

/** Weighted overall score across checks (voice AI score folded in by caller). */
export function overallScore(checks: { score: number }[], aiVoiceScore?: number): number {
  const parts = checks.map((c) => c.score);
  if (typeof aiVoiceScore === "number") parts.push(aiVoiceScore);
  if (parts.length === 0) return 100;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}
