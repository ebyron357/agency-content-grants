import PDFDocument from "pdfkit";
import { FORM_SHORT_LABELS, FORM_SOURCE, parseMoney, type FieldView, type FormView } from "./engine";

/**
 * Readable renderings of the federal forms for the package: rows of label and
 * value (used by the DOCX and the PDF) and the filled data as JSON. They are
 * for a person to check and copy into Grants.gov Workspace; Grant Studio never
 * submits them.
 */

export const TO_COMPLETE = "[To complete]";

export function displayValue(field: FieldView): string {
  if (field.entry === "grants_gov") return "Filled by Grants.gov on submission";
  if (field.entry === "attachment") return "Attach in Grants.gov Workspace if it applies";
  const v = field.value;
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return TO_COMPLETE;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join("; ");
  if (field.control === "money") {
    const n = parseMoney(v);
    if (n !== null) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return String(v);
}

export interface FormRows {
  key: string;
  title: string;
  subtitle: string;
  statusNote: string | null;
  sections: { title: string; rows: { label: string; value: string }[] }[];
  notes: string[];
}

export function formRows(view: FormView): FormRows {
  const statusNote = view.notApplicable
    ? `Not applicable, recorded by ${view.notApplicableBy ?? "a person"}${view.notApplicableReason ? `: ${view.notApplicableReason}` : "."}`
    : view.status === "complete"
      ? `Reviewed by ${view.reviewedBy ?? "a person"}${view.reviewedAt ? ` on ${new Date(view.reviewedAt).toISOString().slice(0, 10)}` : ""}.`
      : view.errorCount > 0
        ? `Incomplete: ${view.counts.toComplete} field${view.counts.toComplete === 1 ? "" : "s"} still to complete.`
        : "Not yet reviewed.";
  return {
    key: view.key,
    title: `${FORM_SHORT_LABELS[view.key]}: ${view.formName}`,
    subtitle: [`Version ${view.formVersion}`, view.ombNumber ? `OMB ${view.ombNumber}` : null, view.expirationDate ? `expires ${view.expirationDate}` : null].filter(Boolean).join(" · "),
    statusNote,
    sections: view.notApplicable
      ? []
      : view.sections.map((s) => ({ title: s.title, rows: s.fields.map((f) => ({ label: f.label, value: displayValue(f) })) })),
    notes: view.notApplicable ? [] : [...view.attachmentNotes, ...view.formErrors],
  };
}

export interface FormsExportMeta {
  draft: boolean;
  applicantName: string;
  opportunityTitle: string;
  opportunityNumber: string | null;
  generatedAt: Date;
}

/** The filled data, in Simpler Grants' JSON shape for each form, with where the definitions came from. */
export function formsJson(views: FormView[], meta: FormsExportMeta) {
  return {
    draft: meta.draft,
    notice: "Prepared by GrantCrest for a person to review and enter in Grants.gov Workspace. GrantCrest does not submit applications.",
    applicant: meta.applicantName,
    opportunity: { title: meta.opportunityTitle, number: meta.opportunityNumber },
    generatedAt: meta.generatedAt.toISOString(),
    definitions: FORM_SOURCE,
    forms: views.map((v) => ({
      key: v.key,
      form: FORM_SHORT_LABELS[v.key],
      formName: v.formName,
      shortFormName: v.shortFormName,
      formVersion: v.formVersion,
      ombNumber: v.ombNumber,
      status: v.status,
      notApplicable: v.notApplicable,
      notApplicableReason: v.notApplicableReason,
      reviewedBy: v.reviewedBy,
      reviewedAt: v.reviewedAt,
      errors: v.sections.flatMap((s) => s.fields.filter((f) => f.errors.length).map((f) => ({ field: f.id, label: f.label, errors: f.errors }))),
      data: v.notApplicable ? null : v.data,
    })),
  };
}

/** Helvetica in PDFKit covers Windows-1252 only; anything else becomes "?" rather than garbage. */
const pdfText = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?");

export async function buildFormsPdf(views: FormView[], meta: FormsExportMeta): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 54, info: { Title: `Federal forms: ${pdfText(meta.opportunityTitle)}`, Author: "GrantCrest", Creator: "GrantCrest" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  const width = 504;
  if (meta.draft) doc.font("Helvetica-Bold").fontSize(11).fillColor("#B91C1C").text("DRAFT: not approved for submission", { width }).moveDown(0.5).fillColor("black");
  doc.font("Helvetica-Bold").fontSize(16).text(pdfText(`Federal forms for ${meta.applicantName}`), { width });
  doc.font("Helvetica").fontSize(10).text(pdfText(`${meta.opportunityTitle}${meta.opportunityNumber ? ` (${meta.opportunityNumber})` : ""}`), { width });
  doc.moveDown(0.3).font("Helvetica-Oblique").fontSize(9).text(pdfText(`Prepared ${meta.generatedAt.toISOString().slice(0, 10)} for a person to review and enter in Grants.gov Workspace. GrantCrest does not submit applications. Form definitions: ${FORM_SOURCE.repository} (commit ${FORM_SOURCE.commit.slice(0, 12)}).`), { width });
  for (const view of views) {
    const form = formRows(view);
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text(pdfText(form.title), { width });
    doc.font("Helvetica").fontSize(9).fillColor("#444444").text(pdfText(form.subtitle), { width }).fillColor("black");
    if (form.statusNote) doc.moveDown(0.3).font("Helvetica-Oblique").fontSize(9).text(pdfText(form.statusNote), { width });
    for (const section of form.sections) {
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).text(pdfText(section.title), { width });
      for (const row of section.rows) {
        doc.font("Helvetica-Bold").fontSize(9).text(pdfText(`${row.label}: `), { width, continued: true });
        doc.font(row.value === TO_COMPLETE ? "Helvetica-Oblique" : "Helvetica").text(pdfText(row.value), { width });
      }
    }
    if (form.notes.length) {
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).text("Notes", { width });
      for (const note of form.notes) doc.font("Helvetica").fontSize(9).text(pdfText(`- ${note}`), { width });
    }
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
