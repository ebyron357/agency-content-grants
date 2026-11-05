import { createHash } from "node:crypto";

/**
 * Reading a funding notice (NOFO, RFA, solicitation) PDF page by page
 * (docs/GRANT_STUDIO.md, Notice PDF and requirement checklist).
 *
 * Text comes from a pluggable extractor:
 * - `pdfjs` (default): Mozilla pdf.js (`pdfjs-dist`, Apache-2.0), in process,
 *   one page at a time, so memory stays bounded on the 512 MB web instance.
 * - `docling`: a Docling service (docling-serve, MIT) over HTTP, used only when
 *   `DOCLING_SERVE_URL` points at one. If it fails, pdf.js reads the file and
 *   the notice records why.
 *
 * Pure module: no database import, so the caps, page splitting and the Docling
 * response handling are unit-tested on their own. No OCR: a scanned notice
 * with no text layer yields empty pages, and the reader says so.
 */

/** Hard ceilings. Configured values are clamped to these. */
export const NOTICE_LIMITS = {
  /** Same as the existing source PDF upload (routes/sources.ts). */
  maxBytesCeiling: 50 * 1024 * 1024,
  maxPagesCeiling: 400,
  /** Characters kept per page; longer pages are cut. */
  maxCharsPerPage: 12_000,
} as const;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export interface NoticeConfig {
  maxBytes: number;
  maxPages: number;
  doclingUrl: string | null;
  doclingApiKey: string | null;
  doclingTimeoutMs: number;
}

/** Reads the notice settings from the environment, clamped to the hard ceilings. */
export function noticeConfig(env: NodeJS.ProcessEnv = process.env): NoticeConfig {
  const docling = env.DOCLING_SERVE_URL?.trim() || null;
  return {
    maxBytes: clampInt(env.NOTICE_PDF_MAX_MB, 25, 1, 50) * 1024 * 1024,
    maxPages: clampInt(env.NOTICE_PDF_MAX_PAGES, 200, 1, NOTICE_LIMITS.maxPagesCeiling),
    doclingUrl: docling ? docling.replace(/\/+$/, "") : null,
    doclingApiKey: env.DOCLING_SERVE_API_KEY?.trim() || null,
    doclingTimeoutMs: clampInt(env.DOCLING_TIMEOUT_MS, 120_000, 5_000, 600_000),
  };
}

export class NoticeFileError extends Error {}

/** A PDF starts with "%PDF-" (within the first 1,024 bytes, per the PDF spec's tolerance). */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

/** Checks a file before it is stored: type and size. Throws NoticeFileError with a message for the user. */
export function assertNoticeFile(buffer: Buffer, cfg: Pick<NoticeConfig, "maxBytes">): void {
  if (buffer.length === 0) throw new NoticeFileError("The file is empty.");
  if (buffer.length > cfg.maxBytes) throw new NoticeFileError(`The notice is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; the limit is ${Math.round(cfg.maxBytes / 1024 / 1024)} MB.`);
  if (!looksLikePdf(buffer)) throw new NoticeFileError("The file is not a PDF.");
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** A safe display name for the stored file. */
export function noticeFileName(raw: string | null | undefined, fallback = "notice.pdf"): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").replace(/_+/g, "_").trim().slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

/** Collapses whitespace and cuts a page to the per-page cap. */
export function normalizePageText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, NOTICE_LIMITS.maxCharsPerPage);
}

/** Joins pdf.js text items into lines: a new line where the item says so or where the baseline moves. */
export function joinTextItems(items: { str?: string; hasEOL?: boolean; transform?: number[] }[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
    else if (out && !out.endsWith("\n") && !out.endsWith(" ") && item.str && !item.str.startsWith(" ")) out += " ";
    out += item.str;
    if (item.hasEOL) out += "\n";
    if (y !== null) lastY = y;
  }
  return normalizePageText(out);
}

/**
 * Splits text that marks its pages into pages. Docling's text output and
 * pdftotext separate pages with a form feed; a Markdown export may use
 * `<!-- page N -->` markers. Text with no markers is one page.
 */
export function splitPages(text: string): string[] {
  if (text.includes("\f")) return text.split("\f").map(normalizePageText);
  const marker = /<!--\s*page[\s:_-]*(\d+)\s*-->/gi;
  if (marker.test(text)) {
    marker.lastIndex = 0;
    const pages: string[] = [];
    let last = 0;
    let lastNo = 0;
    for (const m of text.matchAll(marker)) {
      if (m.index! > last || lastNo) pages[Math.max(0, lastNo - 1)] = normalizePageText(text.slice(last, m.index));
      lastNo = Number(m[1]);
      last = m.index! + m[0].length;
    }
    pages[Math.max(0, lastNo - 1)] = normalizePageText(text.slice(last));
    return Array.from(pages, (p) => p ?? "");
  }
  return [normalizePageText(text)];
}

/** Applies the page cap to a list of pages. */
export function capPages(pages: string[], maxPages: number): { pages: string[]; truncated: boolean } {
  return pages.length > maxPages ? { pages: pages.slice(0, maxPages), truncated: true } : { pages, truncated: false };
}

export interface PageRead {
  /** Text of each page read (index 0 is page 1). */
  pages: string[];
  /** Pages in the document. */
  pageCount: number;
  /** True when pageCount exceeded the cap and only the first pages were read. */
  truncated: boolean;
  extractor: "pdfjs" | "docling";
  /** Set when the configured extractor failed and another one was used. */
  note?: string;
}

export interface ReadOptions {
  maxPages: number;
  signal?: AbortSignal;
  /** Called after each page, for job progress. */
  onPage?: (read: number, total: number) => Promise<void> | void;
}

export interface NoticeExtractor {
  name: "pdfjs" | "docling";
  read(buffer: Buffer, opts: ReadOptions): Promise<PageRead>;
}

/** pdf.js, in process, page by page. Each page is released after its text is read. */
export const pdfjsExtractor: NoticeExtractor = {
  name: "pdfjs",
  async read(buffer, opts) {
    // The legacy build runs in Node without DOM globals. Loaded lazily, so the
    // module costs nothing until a notice is read.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      // Text only: no fonts loaded into the process, no eval, no network.
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      disableAutoFetch: true,
      disableStream: true,
      stopAtErrors: false,
      verbosity: 0,
    });
    const doc = await task.promise.catch((err: unknown) => {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "PasswordException") throw new NoticeFileError("The PDF is password protected. Remove the password and attach it again.");
      if (name === "InvalidPDFException") throw new NoticeFileError("The file could not be read as a PDF.");
      throw err;
    });
    try {
      const pageCount = doc.numPages;
      const toRead = Math.min(pageCount, opts.maxPages);
      const pages: string[] = [];
      for (let n = 1; n <= toRead; n++) {
        if (opts.signal?.aborted) throw new Error("Reading the notice was stopped.");
        const page = await doc.getPage(n);
        try {
          const content = await page.getTextContent();
          pages.push(joinTextItems(content.items as { str?: string; hasEOL?: boolean; transform?: number[] }[]));
        } finally {
          page.cleanup();
        }
        await opts.onPage?.(n, toRead);
      }
      return { pages, pageCount, truncated: pageCount > toRead, extractor: "pdfjs" };
    } finally {
      await doc.destroy().catch(() => {});
    }
  },
};

/** Page texts from a Docling JSON document (DoclingDocument): every text item's provenance names its page. */
export function pagesFromDoclingJson(json: unknown): string[] | null {
  const doc = json as { texts?: unknown; tables?: unknown } | null;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.texts)) return null;
  const byPage = new Map<number, string[]>();
  const add = (page: unknown, text: string) => {
    const n = Number(page);
    if (!Number.isInteger(n) || n < 1 || !text.trim()) return;
    (byPage.get(n) ?? byPage.set(n, []).get(n)!).push(text);
  };
  for (const item of doc.texts as { text?: unknown; prov?: { page_no?: unknown }[] }[]) {
    if (typeof item?.text !== "string" || !Array.isArray(item.prov) || !item.prov.length) continue;
    add(item.prov[0]?.page_no, item.text);
  }
  for (const table of (Array.isArray(doc.tables) ? doc.tables : []) as { prov?: { page_no?: unknown }[]; data?: { table_cells?: { text?: unknown }[] } }[]) {
    const cells = table?.data?.table_cells;
    if (!Array.isArray(cells) || !Array.isArray(table.prov) || !table.prov.length) continue;
    add(table.prov[0]?.page_no, cells.map((c) => (typeof c?.text === "string" ? c.text : "")).filter(Boolean).join(" | "));
  }
  if (!byPage.size) return null;
  const last = Math.max(...byPage.keys());
  return Array.from({ length: last }, (_, i) => normalizePageText((byPage.get(i + 1) ?? []).join("\n")));
}

/** Docling's single-file response: `document.json_content` (preferred) or `document.text_content`. */
export function pagesFromDoclingResponse(body: unknown): string[] {
  const document = (body as { document?: { json_content?: unknown; text_content?: unknown }; status?: unknown; errors?: unknown } | null)?.document;
  const status = (body as { status?: unknown })?.status;
  if (status === "failure" || status === "skipped") throw new Error(`Docling could not convert the notice (${String(status)}).`);
  const fromJson = pagesFromDoclingJson(document?.json_content);
  if (fromJson) return fromJson;
  if (typeof document?.text_content === "string" && document.text_content.trim()) return splitPages(document.text_content);
  throw new Error("Docling returned no text for the notice.");
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: FormData; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** A Docling service over HTTP (docling-serve `/v1/convert/file`). OCR is off: the same text-layer rule as pdf.js. */
export function doclingExtractor(cfg: Pick<NoticeConfig, "doclingUrl" | "doclingApiKey" | "doclingTimeoutMs">, fetchImpl: FetchLike = fetch as unknown as FetchLike): NoticeExtractor {
  return {
    name: "docling",
    async read(buffer, opts) {
      if (!cfg.doclingUrl) throw new Error("DOCLING_SERVE_URL is not set.");
      const form = new FormData();
      form.append("files", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), "notice.pdf");
      form.append("from_formats", "pdf");
      form.append("to_formats", "json");
      form.append("do_ocr", "false");
      form.append("image_export_mode", "placeholder");
      form.append("page_range", "1");
      form.append("page_range", String(opts.maxPages));
      const timeout = AbortSignal.timeout(cfg.doclingTimeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await fetchImpl(`${cfg.doclingUrl}/v1/convert/file`, {
        method: "POST",
        headers: { accept: "application/json", ...(cfg.doclingApiKey ? { "X-Api-Key": cfg.doclingApiKey } : {}) },
        body: form,
        signal,
      });
      if (!res.ok) throw new Error(`Docling answered ${res.status}.`);
      const all = pagesFromDoclingResponse(await res.json());
      const { pages, truncated } = capPages(all, opts.maxPages);
      await opts.onPage?.(pages.length, pages.length);
      return { pages, pageCount: all.length, truncated, extractor: "docling" };
    },
  };
}

/**
 * Reads a notice with the configured extractor. Docling, when configured, is
 * tried first; if it fails, pdf.js reads the file and `note` says why. A file
 * pdf.js itself cannot read (password, not a PDF) fails with NoticeFileError.
 */
export async function readNoticePages(buffer: Buffer, opts: ReadOptions & { config?: NoticeConfig; extractors?: { docling?: NoticeExtractor; pdfjs?: NoticeExtractor } }): Promise<PageRead> {
  const cfg = opts.config ?? noticeConfig();
  const pdfjs = opts.extractors?.pdfjs ?? pdfjsExtractor;
  const docling = opts.extractors?.docling ?? (cfg.doclingUrl ? doclingExtractor(cfg) : null);
  const readOpts: ReadOptions = { maxPages: Math.min(opts.maxPages, cfg.maxPages), signal: opts.signal, onPage: opts.onPage };
  if (docling) {
    try {
      return await docling.read(buffer, readOpts);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const fallback = await pdfjs.read(buffer, readOpts);
      return { ...fallback, note: `Docling was not used (${reason.slice(0, 200)}); read with pdf.js instead.` };
    }
  }
  return pdfjs.read(buffer, readOpts);
}

/** Pages that carry text, and whether the notice looks scanned (no text layer). */
export function textCoverage(pages: string[]): { withText: number; scanned: boolean } {
  const withText = pages.filter((p) => p.replace(/\s/g, "").length >= 20).length;
  return { withText, scanned: pages.length > 0 && withText === 0 };
}
