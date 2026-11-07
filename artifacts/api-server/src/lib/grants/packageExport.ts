import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { sanitizeRichHtml } from "../richText";
import type { BudgetLineInput, BudgetSummary } from "./budget";
import { lineTotal } from "./budget";
import { BUDGET_CATEGORIES, type BudgetCategory } from "./eligibility";
import { DEFAULT_FORMAT, type FormatProfile } from "./writing";

/**
 * Builds the application package as a DOCX in memory. Nothing is written to
 * disk: the route streams the buffer to the owner who requested it.
 */

export interface PackageInput {
  draft: boolean;
  applicantName: string;
  applicantTypeLabel: string;
  ein: string | null;
  uei: string | null;
  opportunity: { title: string; number: string | null; agency: string | null; closeDate: string | null; officialUrl: string; federal?: boolean };
  requestedAmount: number;
  sections: { title: string; content: string }[];
  budgetLines: BudgetLineInput[];
  budget: BudgetSummary;
  requirements: { kind: string; label: string; status: string; sourceRef: string | null }[];
  approvals: { scope: string; role: string; approvedBy: string; createdAt: Date }[];
  /** Font, size, spacing and margins from the notice (writing toolkit); Times New Roman 12 pt, single spaced, 1-inch margins by default. */
  format?: FormatProfile;
  generatedAt: Date;
}

type Block = { kind: "heading" | "paragraph" | "bullet"; text: string };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Converts sanitized section HTML into headings, paragraphs and bullets. */
export function htmlToBlocks(html: string): Block[] {
  const safe = sanitizeRichHtml(html || "");
  const blocks: Block[] = [];
  const re = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(safe))) {
    const tag = match[1].toLowerCase();
    const text = decode(match[2].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();
    if (!text) continue;
    blocks.push({ kind: tag.startsWith("h") ? "heading" : tag === "li" ? "bullet" : "paragraph", text });
  }
  if (blocks.length === 0) {
    const text = decode(safe.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
  }
  return blocks;
}

const usd = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function cell(text: string, bold = false): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
}

function table(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, index) => new TableRow({ children: row.map((value) => cell(value, index === 0)) })),
  });
}

export async function buildApplicationPackage(input: PackageInput): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  if (input.draft) {
    children.push(new Paragraph({ children: [new TextRun({ text: "DRAFT: not approved for submission", bold: true, color: "B91C1C" })], spacing: { after: 200 } }));
  }
  children.push(new Paragraph({ text: input.opportunity.title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }));
  const meta = [
    `Applicant: ${input.applicantName} (${input.applicantTypeLabel})`,
    input.ein ? `EIN: ${input.ein}` : null,
    input.uei ? `UEI: ${input.uei}` : null,
    `Funder: ${input.opportunity.agency ?? "Not recorded"}`,
    input.opportunity.number ? `Opportunity number: ${input.opportunity.number}` : null,
    `Closing date: ${input.opportunity.closeDate ?? "Not recorded"} (confirm the time and time zone in the notice)`,
    `Official listing: ${input.opportunity.officialUrl}`,
    `Amount requested: ${usd(input.requestedAmount)}`,
  ].filter((line): line is string => Boolean(line));
  for (const line of meta) children.push(new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 60 } }));

  for (const section of input.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
    const blocks = htmlToBlocks(section.content);
    if (blocks.length === 0) blocks.push({ kind: "paragraph", text: "[Not written yet]" });
    for (const block of blocks) {
      if (block.kind === "heading") children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }));
      else if (block.kind === "bullet") children.push(new Paragraph({ text: block.text, bullet: { level: 0 }, spacing: { after: 60 } }));
      else children.push(new Paragraph({ children: [new TextRun({ text: block.text })], spacing: { after: 160 }, alignment: AlignmentType.JUSTIFIED }));
    }
  }

  children.push(new Paragraph({ text: "Budget", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
  const lineRows = input.budgetLines.map((line) => [
    BUDGET_CATEGORIES[line.category as BudgetCategory] ?? line.category,
    line.description,
    String(line.quantity),
    usd(line.unitCost),
    usd(lineTotal(line)),
    `${line.matchPercent}%`,
  ]);
  children.push(table([["Category", "Item", "Quantity", "Unit cost", "Total", "Match"], ...lineRows]));
  const summaryRows = input.budget.categories.filter((c) => c.total > 0).map((c) => [c.label, usd(c.requested), usd(c.match), usd(c.total)]);
  children.push(new Paragraph({ text: "Budget summary (SF-424A categories)", heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } }));
  children.push(table([
    ["Category", "Requested", "Match", "Total"],
    ...summaryRows,
    ["Total direct", usd(input.budget.directTotal - input.budget.match), usd(input.budget.match), usd(input.budget.directTotal)],
    [`Indirect (${input.budget.indirectRatePercent}% of requested direct)`, usd(input.budget.indirect), usd(0), usd(input.budget.indirect)],
    ["Total", usd(input.budget.requested), usd(input.budget.match), usd(input.budget.total)],
  ]));
  children.push(new Paragraph({ text: "Budget justification by line", heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 } }));
  for (const line of input.budgetLines) {
    children.push(new Paragraph({ children: [new TextRun({ text: `${line.description}: `, bold: true }), new TextRun({ text: line.justification?.trim() || "[Justification needed]" })], spacing: { after: 80 } }));
  }

  children.push(new Paragraph({ text: "Compliance checklist", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
  children.push(table([
    ["Requirement", "Type", "Status", "Where in the notice"],
    ...input.requirements.map((r) => [r.label, r.kind, r.status.replace("_", " "), r.sourceRef ?? ""]),
  ]));
  const formsNote = input.opportunity.federal === false
    ? "Confirm the exact forms, attachments and submission method on the state program's page and application portal before submitting."
    : "Confirm the exact form set and attachments in the opportunity's package in Grants.gov Workspace before submitting.";
  children.push(new Paragraph({ children: [new TextRun({ text: formsNote, italics: true })], spacing: { before: 120, after: 120 } }));

  children.push(new Paragraph({ text: "Approvals", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 } }));
  if (input.approvals.length === 0) children.push(new Paragraph({ text: "No approvals recorded." }));
  else children.push(table([["Scope", "Role", "Approved by", "When (UTC)"], ...input.approvals.map((a) => [a.scope, a.role.replace(/_/g, " "), a.approvedBy, a.createdAt.toISOString().replace("T", " ").slice(0, 16)])]));
  children.push(new Paragraph({ children: [new TextRun({ text: `Prepared in GrantCrest (grantcrest.co) on ${input.generatedAt.toISOString().slice(0, 10)}. The applicant submits this package through Grants.gov or the funder's portal.`, italics: true, color: "555555" })], spacing: { before: 240 } }));

  const format = input.format ?? DEFAULT_FORMAT;
  const margin = Math.round(format.marginsIn * 1440);
  const doc = new Document({
    creator: "GrantCrest",
    title: input.opportunity.title,
    styles: {
      default: {
        document: {
          run: { font: format.font, size: Math.round(format.sizePt * 2) },
          // Line spacing in 240ths of a line ("auto"), so 1, 1.5 and 2 match Word's settings.
          paragraph: { spacing: { line: Math.round(format.lineSpacing * 240) } },
        },
      },
    },
    sections: [{ properties: { page: { margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children }],
  });
  return Packer.toBuffer(doc);
}
