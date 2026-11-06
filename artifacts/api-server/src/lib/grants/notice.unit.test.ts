/**
 * Notice PDF reading and the proposed checklist, without a database or a
 * network: page splitting, size and page caps, the pdf.js reader on a
 * synthetic PDF generated here (no real notice is committed), the Docling
 * response and fallback, and validation of a mocked AI response (every row
 * must cite a page whose text holds its quote).
 */
import { describe, expect, it } from "vitest";
import {
  NoticeFileError,
  assertNoticeFile,
  capPages,
  doclingExtractor,
  joinTextItems,
  looksLikePdf,
  noticeConfig,
  noticeFileName,
  pagesFromDoclingJson,
  pagesFromDoclingResponse,
  pdfjsExtractor,
  readNoticePages,
  splitPages,
  textCoverage,
  type NoticeExtractor,
} from "./noticePdf";
import { chunkPages, demoChecklist, proposeChecklist, quoteOnPage, validateProposals, type Generate } from "./noticeChecklist";
import { checkNoticeUrl } from "./noticeFetch";
import { buildSyntheticNoticePdf } from "./syntheticNotice";

const PAGES = [
  "Eligible applicants are nonprofit organizations with 501(c)(3) status.\nApplications are due March 3, 2027.",
  "The project narrative must not exceed 10 pages. Use a 12-point font.\nApplicants must attach letters of support from partners.",
  "Need for the project (20 points).\nQuality of the project design (35 points).",
];

describe("notice configuration and file checks", () => {
  it("clamps configured caps to the hard ceilings", () => {
    expect(noticeConfig({}).maxBytes).toBe(25 * 1024 * 1024);
    expect(noticeConfig({}).maxPages).toBe(200);
    expect(noticeConfig({ NOTICE_PDF_MAX_MB: "500", NOTICE_PDF_MAX_PAGES: "100000" })).toMatchObject({ maxBytes: 50 * 1024 * 1024, maxPages: 400 });
    expect(noticeConfig({ NOTICE_PDF_MAX_MB: "nonsense", NOTICE_PDF_MAX_PAGES: "-3" })).toMatchObject({ maxBytes: 25 * 1024 * 1024, maxPages: 200 });
    expect(noticeConfig({}).doclingUrl).toBeNull();
    expect(noticeConfig({ DOCLING_SERVE_URL: "http://docling:5001/" }).doclingUrl).toBe("http://docling:5001");
  });

  it("refuses empty, oversized and non-PDF files", () => {
    const cfg = { maxBytes: 1024 };
    expect(() => assertNoticeFile(Buffer.alloc(0), cfg)).toThrow("empty");
    expect(() => assertNoticeFile(Buffer.alloc(2048, 0x25), cfg)).toThrow(/limit is/);
    expect(() => assertNoticeFile(Buffer.from("<html>not a pdf</html>"), cfg)).toThrow("not a PDF");
    expect(() => assertNoticeFile(Buffer.from("%PDF-1.7\n..."), cfg)).not.toThrow();
    expect(looksLikePdf(Buffer.from("\n\n%PDF-1.4"))).toBe(true);
    try {
      assertNoticeFile(Buffer.from("plain"), cfg);
    } catch (err) {
      expect(err).toBeInstanceOf(NoticeFileError);
    }
  });

  it("makes safe file names", () => {
    expect(noticeFileName("../../etc/passwd")).toBe("passwd.pdf");
    expect(noticeFileName("C:\\Users\\me\\NOFO 2027 (final).PDF")).toBe("NOFO 2027 (final).PDF");
    expect(noticeFileName("")).toBe("notice.pdf");
    expect(noticeFileName("<script>.pdf")).toBe("_script_.pdf");
  });

  it("accepts only public https links", () => {
    expect(checkNoticeUrl("https://www.grants.gov/search-results-detail/1").hostname).toBe("www.grants.gov");
    expect(() => checkNoticeUrl("http://www.grants.gov/x.pdf")).toThrow("https");
    expect(() => checkNoticeUrl("https://user:pw@example.org/x.pdf")).toThrow("user name");
    expect(() => checkNoticeUrl("https://127.0.0.1/x.pdf")).toThrow("private");
    expect(() => checkNoticeUrl("https://[::1]/x.pdf")).toThrow("private");
    expect(() => checkNoticeUrl("https://169.254.169.254/latest")).toThrow("private");
    expect(() => checkNoticeUrl("https://localhost/x.pdf")).toThrow("private");
    expect(() => checkNoticeUrl("not a url")).toThrow("valid URL");
  });
});

describe("page splitting and caps", () => {
  it("splits on form feeds and page markers", () => {
    expect(splitPages("one\fTwo  words\f\fthree")).toEqual(["one", "Two words", "", "three"]);
    expect(splitPages("<!-- page 1 -->first\n<!-- page 2 -->second <!-- page 4 -->fourth")).toEqual(["first", "second", "", "fourth"]);
    expect(splitPages("no markers at all")).toEqual(["no markers at all"]);
  });

  it("joins text items into lines by baseline", () => {
    const text = joinTextItems([
      { str: "Need for the", transform: [1, 0, 0, 1, 72, 700] },
      { str: "project", transform: [1, 0, 0, 1, 140, 700] },
      { str: "(20 points).", transform: [1, 0, 0, 1, 72, 686], hasEOL: true },
      { str: "Next line", transform: [1, 0, 0, 1, 72, 672] },
    ]);
    expect(text).toBe("Need for the project\n(20 points).\nNext line");
  });

  it("caps the page count and cuts long pages", () => {
    expect(capPages(["a", "b", "c"], 2)).toEqual({ pages: ["a", "b"], truncated: true });
    expect(capPages(["a"], 2)).toEqual({ pages: ["a"], truncated: false });
    expect(splitPages("x".repeat(20_000))[0].length).toBe(12_000);
  });

  it("recognizes a notice with no text layer", () => {
    expect(textCoverage(["", "  ", "short"]).scanned).toBe(true);
    expect(textCoverage(PAGES)).toEqual({ withText: 3, scanned: false });
  });
});

describe("reading a synthetic PDF with pdf.js", () => {
  it("returns each page's text in order", async () => {
    const pdf = await buildSyntheticNoticePdf();
    const progress: number[] = [];
    const read = await pdfjsExtractor.read(pdf, { maxPages: 50, onPage: (n) => void progress.push(n) });
    expect(read).toMatchObject({ pageCount: 3, truncated: false, extractor: "pdfjs" });
    expect(read.pages).toHaveLength(3);
    expect(read.pages[0]).toContain("SYNTHETIC TEST NOTICE");
    expect(read.pages[1]).toContain("The project narrative must not exceed 10 pages.");
    expect(read.pages[2]).toContain("Quality of the project design (35 points).");
    expect(progress).toEqual([1, 2, 3]);
  });

  it("reads only up to the page cap and says so", async () => {
    const pdf = await buildSyntheticNoticePdf({ extraPages: 4 });
    const read = await pdfjsExtractor.read(pdf, { maxPages: 2 });
    expect(read).toMatchObject({ pageCount: 7, truncated: true });
    expect(read.pages).toHaveLength(2);
  });

  it("refuses a file that is not a readable PDF", async () => {
    await expect(pdfjsExtractor.read(Buffer.from("%PDF-1.7 broken"), { maxPages: 5 })).rejects.toThrow();
  });
});

describe("Docling over HTTP", () => {
  const docJson = {
    texts: [
      { text: "Eligible applicants are nonprofits.", prov: [{ page_no: 1 }] },
      { text: "Need (20 points).", prov: [{ page_no: 3 }] },
      { text: "no provenance" },
    ],
    tables: [{ prov: [{ page_no: 3 }], data: { table_cells: [{ text: "Criterion" }, { text: "Points" }] } }],
  };

  it("builds pages from the JSON document's provenance", () => {
    expect(pagesFromDoclingJson(docJson)).toEqual(["Eligible applicants are nonprofits.", "", "Need (20 points).\nCriterion | Points"]);
    expect(pagesFromDoclingJson({})).toBeNull();
    expect(pagesFromDoclingResponse({ document: { text_content: "a\fb" }, status: "success" })).toEqual(["a", "b"]);
    expect(() => pagesFromDoclingResponse({ document: {}, status: "failure" })).toThrow("could not convert");
  });

  it("posts the file to /v1/convert/file with the key, OCR off and the page range", async () => {
    let seen: { url: string; headers: Record<string, string>; body: FormData } | null = null;
    const ex = doclingExtractor({ doclingUrl: "http://docling.test", doclingApiKey: "k", doclingTimeoutMs: 5000 }, async (url, init) => {
      seen = { url, headers: init.headers, body: init.body };
      return { ok: true, status: 200, json: async () => ({ document: { json_content: docJson }, status: "success" }), text: async () => "" };
    });
    const read = await ex.read(Buffer.from("%PDF-1.7"), { maxPages: 2 });
    expect(seen!.url).toBe("http://docling.test/v1/convert/file");
    expect(seen!.headers["X-Api-Key"]).toBe("k");
    expect(seen!.body.get("do_ocr")).toBe("false");
    expect(seen!.body.getAll("page_range")).toEqual(["1", "2"]);
    expect(read).toMatchObject({ extractor: "docling", pageCount: 3, truncated: true });
    expect(read.pages).toHaveLength(2);
  });

  it("falls back to pdf.js and records why when Docling fails", async () => {
    const failing: NoticeExtractor = { name: "docling", read: async () => { throw new Error("Docling answered 503."); } };
    const pdfjs: NoticeExtractor = { name: "pdfjs", read: async () => ({ pages: ["p1"], pageCount: 1, truncated: false, extractor: "pdfjs" }) };
    const cfg = { ...noticeConfig({}), doclingUrl: "http://docling.test" };
    const read = await readNoticePages(Buffer.from("%PDF"), { maxPages: 10, config: cfg, extractors: { docling: failing, pdfjs } });
    expect(read.extractor).toBe("pdfjs");
    expect(read.note).toMatch(/Docling was not used \(Docling answered 503\.\)/);
  });
});

describe("validating proposed requirements", () => {
  it("accepts only rows whose quote is on the cited page", () => {
    const mocked = [
      { kind: "formatting", label: "Narrative page limit", detail: "10 pages", page: 2, quote: "The project narrative must not exceed 10 pages.", points: null },
      { kind: "criterion", label: "Need for the project", page: 3, quote: "Need for the project (20 points).", points: 20 },
      { kind: "criterion", label: "Design", page: "3", quote: "Quality of the project design (35 points)", points: "35" },
      // Invented: not in the notice.
      { kind: "attachment", label: "Audited financial statements", page: 2, quote: "Applicants must attach audited financial statements.", points: null },
      // Right words, wrong page.
      { kind: "eligibility", label: "501(c)(3) only", page: 3, quote: "Eligible applicants are nonprofit organizations", points: null },
      // No citation.
      { kind: "deadline", label: "Due date", quote: "Applications are due March 3, 2027." },
      { kind: "deadline", label: "Due date", page: 9, quote: "Applications are due March 3, 2027." },
      { kind: "section", label: "Short quote", page: 1, quote: "Eligible" },
      { kind: "made_up", label: "Unknown kind", page: 1, quote: "Eligible applicants are nonprofit organizations" },
      { kind: "section", label: "", page: 1, quote: "x" },
    ];
    const { accepted, rejected } = validateProposals(mocked, PAGES);
    expect(accepted.map((r) => [r.label, r.page, r.points])).toEqual([
      ["Narrative page limit", 2, null],
      ["Need for the project", 3, 20],
      ["Design", 3, 35],
    ]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "The quotation is not on page 2.",
      "The quotation is not on page 3.",
      "No page citation.",
      "Cites page 9, but the notice has 3 pages read.",
      "No quotation from the notice.",
      'Unknown kind "made_up".',
      "No label.",
    ]);
  });

  it("drops points that the quote does not state", () => {
    const { accepted } = validateProposals([{ kind: "criterion", label: "Need", page: 3, quote: "Need for the project (20 points).", points: 25 }], PAGES);
    expect(accepted[0].points).toBeNull();
  });

  it("matches quotes across line breaks, typographic quotes, ellipses and into the next page", () => {
    expect(quoteOnPage("must not exceed 10 pages. Use a 12-point font. Applicants must attach", PAGES, 2)).toBe(true);
    expect(quoteOnPage("The project narrative … 12-point font", PAGES, 2)).toBe(true);
    expect(quoteOnPage("12-point font … narrative", PAGES, 2)).toBe(false);
    expect(quoteOnPage("letters of support from partners. Need for the project", PAGES, 2)).toBe(true);
    expect(quoteOnPage("Need for the project", PAGES, 2)).toBe(false);
    expect(quoteOnPage("“Eligible applicants are nonprofit organizations”", PAGES, 1)).toBe(true);
  });

  it("accepts the { requirements: [...] } shape and removes duplicates", () => {
    const row = { kind: "criterion", label: "Need", page: 3, quote: "Need for the project (20 points)." };
    expect(validateProposals({ requirements: [row, row] }, PAGES).accepted).toHaveLength(1);
    expect(validateProposals("nonsense", PAGES).accepted).toEqual([]);
  });
});

describe("proposing the checklist", () => {
  it("sends marked pages to the model and keeps only cited rows (mocked AI response)", async () => {
    const prompts: string[] = [];
    const generate: Generate = async (messages) => {
      prompts.push(messages[1].content);
      return {
        provider: "openai",
        content: "```json\n" + JSON.stringify([
          { kind: "criterion", label: "Need for the project", page: 3, quote: "Need for the project (20 points).", points: 20 },
          { kind: "attachment", label: "Invented attachment", page: 1, quote: "A budget narrative is required." },
        ]) + "\n```",
      };
    };
    const out = await proposeChecklist(PAGES, generate);
    expect(prompts[0]).toContain("[[PAGE 1]]");
    expect(prompts[0]).toContain("[[PAGE 3]]");
    expect(out).toMatchObject({ demo: false, extractedBy: "ai:openai", pagesSent: 3, message: null });
    expect(out.accepted.map((r) => r.label)).toEqual(["Need for the project"]);
    expect(out.rejected).toEqual([{ label: "Invented attachment", reason: "The quotation is not on page 1." }]);
  });

  it("splits long notices into several requests and reports pages that were not sent", () => {
    const pages = Array.from({ length: 6 }, (_, i) => `page ${i + 1} `.repeat(100));
    // Each page is about 715 characters with its marker, so two fit in 1,500.
    const { chunks, pagesSent } = chunkPages(pages, { charsPerChunk: 1500, maxChunks: 2 });
    expect(chunks).toHaveLength(2);
    expect(pagesSent).toBe(4);
    expect(chunks[1]).toContain("[[PAGE 3]]");
  });

  it("without an AI key, returns labelled pattern matches that still cite pages", async () => {
    const generate: Generate = async () => ({ provider: "demo", content: "[DEMO OUTPUT]" });
    const out = await proposeChecklist(PAGES, generate);
    expect(out.demo).toBe(true);
    expect(out.extractedBy).toBe("demo_rules");
    expect(out.message).toMatch(/^Demo: no AI provider is configured/);
    expect(out.message).toMatch(/not by AI/);
    for (const r of out.accepted) expect(quoteOnPage(r.quote, PAGES, r.page)).toBe(true);
    const byLabel = Object.fromEntries(out.accepted.map((r) => [r.label, r]));
    expect(byLabel["Limit: 10 pages"]).toMatchObject({ kind: "formatting", page: 2 });
    expect(out.accepted.find((r) => r.kind === "criterion" && r.points === 35)?.page).toBe(3);
    expect(out.accepted.find((r) => r.kind === "eligibility")?.page).toBe(1);
    expect(out.accepted.find((r) => r.kind === "attachment")?.page).toBe(2);
  });

  it("finds the synthetic notice's requirements from the PDF itself", async () => {
    const read = await pdfjsExtractor.read(await buildSyntheticNoticePdf(), { maxPages: 10 });
    const { accepted } = demoChecklist(read.pages);
    const summary = accepted.map((r) => `${r.kind}:${r.page}:${r.points ?? ""}`);
    expect(summary).toEqual(expect.arrayContaining(["eligibility:1:", "deadline:1:", "formatting:2:", "attachment:2:", "form:2:", "criterion:3:20", "criterion:3:35", "criterion:3:15"]));
  });
});
