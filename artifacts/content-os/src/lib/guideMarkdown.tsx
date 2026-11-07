import type { ReactNode } from 'react';
import { Link } from 'wouter';

/**
 * A deliberately small Markdown reader for the in-app user guide
 * (docs/USER_GUIDE.md). It supports what the guide uses — headings,
 * paragraphs, bulleted and numbered lists, simple tables, bold, inline code
 * and links — and builds React elements, never raw HTML.
 */

export type GuideBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'quote'; text: string };

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parseGuide(markdown: string): GuideBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: GuideBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('<!--')) {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text, id: slugify(text) });
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/;
    const numbered = /^\s*\d+\.\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = pattern.exec(lines[i]);
        if (m) items.push(m[1]);
        else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (line.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) parts.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: parts.join(' ') });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*[-*]\s|\s*\d+\.\s|>|\|)/.test(lines[i])) parts.push(lines[i++].trim());
    if (parts.length === 0) {
      // A line no rule above consumed: keep it as its own paragraph.
      parts.push(lines[i++].trim());
    }
    blocks.push({ type: 'paragraph', text: parts.join(' ') });
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** Bold, inline code and links. In-app paths use the router; web links open in a new tab; anything else stays plain text. */
export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith('/')) return <Link key={index} href={href} className="text-brand underline underline-offset-4">{label}</Link>;
      if (href.startsWith('#')) return <a key={index} href={href} className="text-brand underline underline-offset-4">{label}</a>;
      if (/^https:\/\//.test(href)) {
        return (
          <a key={index} href={href} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-4">
            {label}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      }
      return <span key={index}>{label}</span>;
    }
    return part;
  });
}
