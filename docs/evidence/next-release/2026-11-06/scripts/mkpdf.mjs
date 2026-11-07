// Writes a two-page synthetic funding notice PDF. Usage: node mkpdf.mjs <api-server dir with node_modules> <out.pdf>
import { createRequire } from "node:module";
import fs from "node:fs";
const [dir, out] = process.argv.slice(2);
const PDFDocument = createRequire(dir + "/package.json")("pdfkit");
const doc = new PDFDocument({ autoFirstPage: false });
doc.pipe(fs.createWriteStream(out));
doc.addPage().fontSize(12).text("[SYNTHETIC] Notice of Funding Opportunity REH-26-001 - Community Literacy Partnerships");
doc.text("Applicants must submit a project narrative of no more than 10 pages.");
doc.text("Applications are due by 11:59 p.m. Eastern Time on December 15, 2026.");
doc.addPage().fontSize(12).text("Section D. A budget justification is required for all personnel costs.");
doc.text("Letters of support from at least two community partners must be included.");
doc.end();
