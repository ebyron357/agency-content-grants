import { sanitizeRichHtml } from "../richText";

/**
 * Pure drafting helpers: the draft context shape and the labelled demo
 * scaffold. Kept apart from ai.ts (which loads the AI router and database) so
 * they can be unit tested without a database.
 */

export interface DraftContext {
  applicant: { name: string; applicantTypeLabel: string; mission: string | null; serviceArea: string | null; state: string | null; focusAreas: string[] };
  opportunity: { title: string; agency: string | null; description: string | null };
  section: { title: string; guidance: string | null; limitType: string | null; limitValue: number | null; content: string };
  requirements: { label: string; detail: string | null; points: number | null }[];
  facts: string[];
}

export function limitPhrase(limitType: string | null, limitValue: number | null): string {
  if (!limitType || !limitValue) return "no stated limit";
  return `at most ${limitValue} ${limitType}`;
}

/** The labelled scaffold used when no AI provider is configured. */
export function demoScaffold(ctx: DraftContext): string {
  const items = ctx.requirements.length
    ? ctx.requirements.map((r) => `<li><strong>${escapeHtml(r.label)}</strong>${r.points ? ` (${r.points} points)` : ""}: [Add how this section answers it.]</li>`).join("")
    : "<li>[Add the points this section must cover from the notice.]</li>";
  return sanitizeRichHtml(
    `<p><em>Demo scaffold: no AI provider is configured. Replace this outline with your own writing before export.</em></p>` +
      `<h3>${escapeHtml(ctx.section.title)}</h3>` +
      (ctx.section.guidance ? `<p>${escapeHtml(ctx.section.guidance)}</p>` : "") +
      `<ul>${items}</ul>` +
      (ctx.facts.length
        ? `<p><strong>Facts on file you can use here:</strong></p><ul>${ctx.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
        : "") +
      `<p>[Add evidence with a source for every statistic. Limit: ${escapeHtml(limitPhrase(ctx.section.limitType, ctx.section.limitValue))}.]</p>`,
  );
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
