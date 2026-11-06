import PDFDocument from "pdfkit";

/**
 * A synthetic funding notice, made for tests and evidence. It is not a real
 * notice: the agency, program and numbers are invented and say so on every
 * page. Each page holds known requirement sentences, so a test can check that
 * the reader returns them on the right page and that citations are validated.
 */

export const SYNTHETIC_NOTICE_PAGES: string[][] = [
  [
    "SYNTHETIC TEST NOTICE - NOT A REAL FUNDING OPPORTUNITY",
    "Example Agency for Testing: Community Reading Pilot, notice EX-TEST-0001.",
    "Eligible applicants are nonprofit organizations with 501(c)(3) status.",
    "Applications must be submitted no later than March 3, 2027 at 5:00 p.m. Eastern Time.",
  ],
  [
    "Section IV. Application Contents (synthetic)",
    "The project narrative must not exceed 10 pages.",
    "Use a 12-point font with margins of 1 inch on every side, double-spaced.",
    "Applicants must attach letters of support from at least two partner organizations.",
    "Submit the SF-424 and the SF-424A with the application.",
  ],
  [
    "Section V. Review Criteria (synthetic)",
    "Need for the project (20 points).",
    "Quality of the project design (35 points).",
    "Evaluation plan (15 points).",
  ],
];

/** Builds the synthetic notice as a PDF with a text layer. `extraPages` adds blank-ish pages, for page-cap tests. */
export function buildSyntheticNoticePdf(opts: { extraPages?: number; pages?: string[][] } = {}): Promise<Buffer> {
  const pages = opts.pages ?? SYNTHETIC_NOTICE_PAGES;
  const doc = new PDFDocument({ autoFirstPage: false, info: { Title: "Synthetic test notice", Author: "Grant Studio tests", CreationDate: new Date("2026-11-05T00:00:00Z") } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  for (const lines of pages) {
    doc.addPage({ size: "LETTER", margin: 72 });
    doc.font("Helvetica").fontSize(11);
    for (const line of lines) doc.text(line, { width: 468 }).moveDown(0.6);
  }
  for (let i = 0; i < (opts.extraPages ?? 0); i++) {
    doc.addPage({ size: "LETTER", margin: 72 });
    doc.font("Helvetica").fontSize(11).text(`Synthetic filler page ${pages.length + i + 1}. No requirements on this page.`);
  }
  doc.end();
  return done.then(() => Buffer.concat(chunks));
}
