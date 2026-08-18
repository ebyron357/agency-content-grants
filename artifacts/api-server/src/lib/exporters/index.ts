import { db } from "@workspace/db";
import {
  documentsTable,
  documentSectionsTable,
  projectsTable,
  brandsTable,
  exportsTable,
  sourcesTable,
  claimsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import PDFDocument from "pdfkit";

// Persistent export directory — survives server restarts (workspace filesystem, not /tmp)
const EXPORT_DIR = join(
  process.cwd(),
  "data",
  "exports"
);

async function ensureExportDir() {
  await mkdir(EXPORT_DIR, { recursive: true });
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip HTML tags and decode common entities to produce plain text.
 * Used ONLY by text-based exporters (DOCX, PDF, plain-text, Markdown).
 * The output is NEVER re-rendered as HTML — it goes directly to
 * non-executing formats — so entity decoding (&amp; → &) is safe and
 * intentional for readability.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Normalise section content for text-based exporters.
 * Returns plain text whether the stored content is plain or HTML.
 */
function sectionText(section: { content: string | null; contentFormat?: string | null }): string {
  const raw = section.content ?? "";
  if (!raw) return "";
  return section.contentFormat === "html" ? stripHtml(raw) : raw;
}

type EvidenceRecord = {
  key: string;
  title: string;
  url: string | null;
  publisher: string | null;
  author: string | null;
  retrievalDate: string | null;
  status: string;
  claims: Array<{ claimText: string; supportingExcerpt: string | null; verificationStatus: string }>;
};

function safeCitationUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function buildEvidence(projectId: string): Promise<EvidenceRecord[]> {
  const [sources, claims] = await Promise.all([
    db.select().from(sourcesTable).where(eq(sourcesTable.projectId, projectId)),
    db.select().from(claimsTable).where(eq(claimsTable.projectId, projectId)),
  ]);
  return sources
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((source, index) => ({
      key: `S${index + 1}`,
      title: source.title,
      url: safeCitationUrl(source.url),
      publisher: source.publisher,
      author: source.author,
      retrievalDate: source.retrievalDate,
      status: source.status,
      claims: claims
        .filter((claim) => claim.sourceId === source.id)
        .map((claim) => ({ claimText: claim.claimText, supportingExcerpt: claim.supportingExcerpt, verificationStatus: claim.verificationStatus })),
    }));
}

function evidenceMarkdown(evidence: EvidenceRecord[]): string {
  if (!evidence.length) return "";
  const lines = ["## Evidence register", "", "The following sources and claim links were stored with this project at export time.", ""];
  for (const source of evidence) {
    const citation = source.url ? `[${source.key}](${source.url})` : `[${source.key}]`;
    const attribution = [source.author, source.publisher].filter(Boolean).join(", ");
    lines.push(`${citation} ${source.title}${attribution ? ` — ${attribution}` : ""}. Status: ${source.status}${source.retrievalDate ? `; retrieved ${source.retrievalDate}` : ""}.`);
    for (const claim of source.claims) {
      lines.push(`- Claim: ${claim.claimText} (${claim.verificationStatus})`);
      if (claim.supportingExcerpt) lines.push(`  - Supporting excerpt: ${claim.supportingExcerpt}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function evidencePlainText(evidence: EvidenceRecord[]): string {
  return stripHtml(evidenceMarkdown(evidence).replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 — $2"));
}

function evidenceHtml(evidence: EvidenceRecord[]): string {
  if (!evidence.length) return "";
  const items = evidence.map((source) => {
    const url = source.url ? ` <a href="${escapeHtml(source.url)}">${escapeHtml(source.url)}</a>` : "";
    const attribution = [source.author, source.publisher].filter(Boolean).join(", ");
    const claims = source.claims.length ? `<ul>${source.claims.map((claim) => `<li>${escapeHtml(claim.claimText)} <em>(${escapeHtml(claim.verificationStatus)})</em>${claim.supportingExcerpt ? `<br><small>${escapeHtml(claim.supportingExcerpt)}</small>` : ""}</li>`).join("")}</ul>` : "";
    return `<li><strong>${escapeHtml(source.key)} — ${escapeHtml(source.title)}</strong>${attribution ? ` — ${escapeHtml(attribution)}` : ""}.${url} <span>Status: ${escapeHtml(source.status)}</span>${claims}</li>`;
  }).join("");
  return `<section><h2>Evidence register</h2><p>Sources and claim links stored with this project at export time.</p><ol>${items}</ol></section>`;
}

// ── DOCX generation ──────────────────────────────────────────────────────────

function buildDocxChildren(
  title: string,
  brand: string,
  sections: Array<{ title: string; content: string | null; contentFormat?: string | null }>,
  evidence: EvidenceRecord[] = [],
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Document title
  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    })
  );

  if (brand) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: brand, italics: true, color: "555555" })],
        spacing: { after: 400 },
      })
    );
  }

  for (const section of sections) {
    // Section heading
    paragraphs.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 120 },
      })
    );

    const body = sectionText(section) || "[No content drafted yet]";
    for (const chunk of body.split(/\n\n+/)) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed })],
          spacing: { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    }
  }

  if (evidence.length) {
    paragraphs.push(new Paragraph({ text: "Evidence register", heading: HeadingLevel.HEADING_1 }));
    paragraphs.push(new Paragraph({ text: "Sources and claim links stored with this project at export time." }));
    for (const source of evidence) {
      paragraphs.push(new Paragraph({ text: `${source.key} — ${source.title}${source.url ? ` — ${source.url}` : ""} (${source.status})` }));
      for (const claim of source.claims) paragraphs.push(new Paragraph({ text: `Claim: ${claim.claimText} (${claim.verificationStatus})` }));
    }
  }

  return paragraphs;
}

async function generateDocx(
  title: string,
  brand: string,
  sections: Array<{ title: string; content: string | null; contentFormat?: string | null }>,
  evidence: EvidenceRecord[] = [],
): Promise<Buffer> {
  const doc = new Document({
    creator: "Content OS",
    title,
    description: `Generated by Content OS — ${brand}`,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 24 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: buildDocxChildren(title, brand, sections, evidence),
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ── PDF generation ────────────────────────────────────────────────────────────

async function generatePdf(
  title: string,
  brand: string,
  sections: Array<{ title: string; content: string | null; contentFormat?: string | null }>,
  evidence: EvidenceRecord[] = [],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: { Title: title, Author: brand || "Content OS", Creator: "Content OS" },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title page
    doc
      .font("Helvetica-Bold")
      .fontSize(24)
      .text(title, { align: "center" });

    if (brand) {
      doc
        .moveDown(0.5)
        .font("Helvetica-Oblique")
        .fontSize(12)
        .fillColor("#555555")
        .text(brand, { align: "center" })
        .fillColor("#000000");
    }

    doc.moveDown(2);

    for (const section of sections) {
      // Check if we need a new page
      if (doc.y > doc.page.height - doc.page.margins.bottom - 100) {
        doc.addPage();
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .text(section.title, { continued: false })
        .moveDown(0.4);

      const body = sectionText(section) || "[No content drafted yet]";
      doc
        .font("Helvetica")
        .fontSize(11)
        .text(body, { align: "justify", lineGap: 2 })
        .moveDown(1.2);
    }

    if (evidence.length) {
      doc.addPage().font("Helvetica-Bold").fontSize(14).text("Evidence register").moveDown(0.4);
      doc.font("Helvetica").fontSize(10).text("Sources and claim links stored with this project at export time.").moveDown(0.6);
      for (const source of evidence) {
        doc.font("Helvetica-Bold").text(`${source.key} — ${source.title}`);
        doc.font("Helvetica").text(`${source.url ?? "No URL recorded"} · Status: ${source.status}`);
        for (const claim of source.claims) doc.text(`Claim: ${claim.claimText} (${claim.verificationStatus})`);
        doc.moveDown(0.4);
      }
    }

    doc.end();
  });
}

// ── Markdown / HTML / plain-text generators ──────────────────────────────────

function generateMarkdown(
  title: string,
  brand: string,
  sections: Array<{ title: string; content: string | null; contentFormat?: string | null }>,
  evidence: EvidenceRecord[] = [],
): string {
  const lines = [`# ${title}`, "", brand ? `*${brand}*` : "", ""];
  for (const section of sections) {
    const text = sectionText(section);
    lines.push(`## ${section.title}`, "", text || "*[No content drafted yet]*", "");
  }
  const appendix = evidenceMarkdown(evidence);
  return `${lines.join("\n")}\n${appendix}`;
}

function generateHTML(
  title: string,
  brand: string,
  contentType: string,
  sections: Array<{ title: string; content: string | null; contentFormat?: string | null }>,
  evidence: EvidenceRecord[] = [],
): string {
  const body = sections
    .map((s) => {
      let sectionBody: string;
      if (!s.content) {
        sectionBody = "<p><em>No content yet</em></p>";
      } else if (s.contentFormat === "html") {
        // Content is already HTML from the rich editor — embed directly
        sectionBody = s.content;
      } else {
        // Plain text: escape and wrap in paragraphs
        sectionBody = `<p>${escapeHtml(s.content).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
      }
      return `<section><h2>${escapeHtml(s.title)}</h2>${sectionBody}</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;line-height:1.7;color:#222;}h1{font-size:2rem;margin-bottom:.5rem;}h2{font-size:1.4rem;margin-top:2rem;color:#333;}p{margin:1rem 0;}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${brand ? `<p><em>${escapeHtml(brand)}</em></p>` : ""}
  ${body}
  ${evidenceHtml(evidence)}
</body>
</html>`;
}

function generatePlainText(
  title: string,
  sections: Array<{ title: string; content: string | null; contentFormat?: string | null }>,
  evidence: EvidenceRecord[] = [],
): string {
  const lines = [title, "=".repeat(title.length), ""];
  for (const section of sections) {
    const text = sectionText(section) || "[No content]";
    lines.push(
      section.title,
      "-".repeat(section.title.length),
      text,
      ""
    );
  }
  return `${lines.join("\n")}\n${evidencePlainText(evidence)}`;
}

// ── Main export function ──────────────────────────────────────────────────────

export async function exportDocument(
  projectId: string,
  format: string
): Promise<{
  fileUrl: string;
  fileSizeBytes: number;
  validationPassed: boolean;
  validationNotes: string;
}> {
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId));
  const document = docs[0];
  if (!document) throw new Error("No document found for project");

  const sections = await db
    .select()
    .from(documentSectionsTable)
    .where(eq(documentSectionsTable.documentId, document.id));
  const sorted = sections.sort((a, b) => a.sortOrder - b.sortOrder);
  const evidence = await buildEvidence(projectId);

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  const [brand] = await db
    .select()
    .from(brandsTable)
    .where(eq(brandsTable.id, project.brandId))
    .limit(1);

  await ensureExportDir();
  const slug = project.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const filename = `${slug}_${Date.now()}`;

  let filePath: string;
  let fileUrl: string;
  let fileSizeBytes: number;
  let validationNotes = "";
  const issues: string[] = [];

  const hasSectionContent = sorted.some((s) => s.content);
  if (!hasSectionContent) issues.push("No section content in document");

  switch (format) {
    case "docx": {
      filePath = join(EXPORT_DIR, `${filename}.docx`);
      const buffer = await generateDocx(document.title, brand?.name ?? "", sorted, evidence);
      await writeFile(filePath, buffer);
      fileSizeBytes = buffer.length;
      fileUrl = `/api/exports/download/${filename}.docx`;
      // Validate: real DOCX starts with PK (zip header)
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        issues.push("DOCX file does not have valid ZIP/DOCX header");
      }
      break;
    }

    case "pdf": {
      filePath = join(EXPORT_DIR, `${filename}.pdf`);
      const buffer = await generatePdf(document.title, brand?.name ?? "", sorted, evidence);
      await writeFile(filePath, buffer);
      fileSizeBytes = buffer.length;
      fileUrl = `/api/exports/download/${filename}.pdf`;
      // Validate: real PDF starts with %PDF
      const header = buffer.slice(0, 4).toString("ascii");
      if (header !== "%PDF") {
        issues.push("PDF file does not have valid %PDF header");
      }
      break;
    }

    case "markdown": {
      const content = generateMarkdown(document.title, brand?.name ?? "", sorted, evidence);
      filePath = join(EXPORT_DIR, `${filename}.md`);
      await writeFile(filePath, content, "utf-8");
      fileSizeBytes = Buffer.byteLength(content, "utf-8");
      fileUrl = `/api/exports/download/${filename}.md`;
      if (!content.includes(document.title)) issues.push("Title not found in export");
      break;
    }

    case "html": {
      const content = generateHTML(document.title, brand?.name ?? "", project.contentType, sorted, evidence);
      filePath = join(EXPORT_DIR, `${filename}.html`);
      await writeFile(filePath, content, "utf-8");
      fileSizeBytes = Buffer.byteLength(content, "utf-8");
      fileUrl = `/api/exports/download/${filename}.html`;
      if (!content.includes(document.title)) issues.push("Title not found in export");
      break;
    }

    case "txt":
    default: {
      const content = generatePlainText(document.title, sorted, evidence);
      filePath = join(EXPORT_DIR, `${filename}.txt`);
      await writeFile(filePath, content, "utf-8");
      fileSizeBytes = Buffer.byteLength(content, "utf-8");
      fileUrl = `/api/exports/download/${filename}.txt`;
      if (!content.includes(document.title)) issues.push("Title not found in export");
      break;
    }
  }

  const validationPassed = issues.length === 0;
  validationNotes = validationPassed
    ? "All validation checks passed"
    : issues.join("; ");

  return { fileUrl, fileSizeBytes, validationPassed, validationNotes };
}

// ── Download helper: also used by the route ──────────────────────────────────

export function getExportDir(): string {
  return EXPORT_DIR;
}
