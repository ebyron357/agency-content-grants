import { stripHtml } from "../richText";

/** Word and character counts for a section's rich text, and its fit against a limit. */

export const WORDS_PER_PAGE = 500;

export interface LimitCheck {
  words: number;
  characters: number;
  pages: number;
  /** The count in the limit's unit. */
  used: number;
  limit: number | null;
  unit: string | null;
  over: boolean;
}

export function countText(html: string): { words: number; characters: number } {
  const text = stripHtml(html || "").replace(/\s+/g, " ").trim();
  return {
    words: text ? text.split(" ").length : 0,
    characters: text.length,
  };
}

export function checkLimit(html: string, limitType: string | null, limitValue: number | null): LimitCheck {
  const { words, characters } = countText(html);
  const pages = Math.ceil(words / WORDS_PER_PAGE);
  const unit = limitType && limitValue ? limitType : null;
  const used = unit === "characters" ? characters : unit === "pages" ? Math.round((words / WORDS_PER_PAGE) * 10) / 10 : words;
  return {
    words,
    characters,
    pages,
    used,
    limit: unit ? limitValue : null,
    unit,
    over: Boolean(unit && limitValue && used > limitValue),
  };
}

/** Plain text from section HTML, with paragraph and list breaks kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
