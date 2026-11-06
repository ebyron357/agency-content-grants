import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Reads funder-graph Parquet partitions (docs/GRANT_STUDIO.md, Foundations).
 *
 * Pure module: no database import. One partition per filing year, at
 * `{base}/grants/filing_year={year}/part-0000.parquet` (funder-graph README).
 * The base is configurable (FOUNDATIONS_DATA_BASE_URL) and may be an https URL
 * or a local directory, so an operator can run the funder-graph pipeline
 * (Apache-2.0) themselves and point the importer at its output.
 *
 * Memory: rows are read a window at a time, only the needed columns, and the
 * compressed column chunks of the current row group are cached up to a byte
 * cap, so a remote file is read with HTTP range requests and never held whole.
 */

export const DEFAULT_BASE_URL = "https://data.opengrants.io/funder-graph/latest";
export const FIRST_FILING_YEAR = 2019;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function partitionPath(base: string, year: number): string {
  return `${base.replace(/\/+$/, "")}/grants/filing_year=${year}/part-0000.parquet`;
}

const isRemote = (base: string) => /^https?:\/\//i.test(base);

function localPath(p: string): string {
  return p.startsWith("file:") ? fileURLToPath(p) : p;
}

/** A local file read with positional reads (no stream per slice). */
async function fileBuffer(path: string): Promise<AsyncBuffer & { close: () => Promise<void> }> {
  const { size } = await stat(path);
  const handle = await open(path, "r");
  return {
    byteLength: size,
    async slice(start: number, end?: number) {
      const stop = Math.min(end ?? size, size);
      const length = Math.max(0, stop - start);
      const buf = Buffer.allocUnsafe(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buf, read, length - read, start + read);
        if (!bytesRead) break;
        read += bytesRead;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + read) as ArrayBuffer;
    },
    close: () => handle.close(),
  };
}

/**
 * Caches recently read byte ranges up to `maxBytes`, least recently used out
 * first. Each window of a row group asks for the same column chunk ranges, so
 * a remote chunk is downloaded once per row group, not once per window.
 */
export function cachedRanges(file: AsyncBuffer, maxBytes: number): AsyncBuffer & { cachedBytes: () => number } {
  const cache = new Map<string, Promise<ArrayBuffer>>();
  const sizes = new Map<string, number>();
  let total = 0;
  const evict = () => {
    for (const key of cache.keys()) {
      if (total <= maxBytes || cache.size <= 1) break;
      total -= sizes.get(key) ?? 0;
      cache.delete(key);
      sizes.delete(key);
    }
  };
  return {
    byteLength: file.byteLength,
    slice(start: number, end?: number) {
      const key = `${start}:${end ?? ""}`;
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const size = (end ?? file.byteLength) - start;
      const promise = Promise.resolve(file.slice(start, end));
      if (size <= maxBytes) {
        cache.set(key, promise);
        sizes.set(key, size);
        total += size;
        evict();
        promise.catch(() => {
          if (cache.get(key) === promise) {
            cache.delete(key);
            total -= sizes.get(key) ?? 0;
            sizes.delete(key);
          }
        });
      }
      return promise;
    },
    cachedBytes: () => total,
  };
}

export interface OpenPartition {
  year: number;
  location: string;
  file: AsyncBuffer;
  metadata: FileMetaData;
  rows: number;
  /** Row count of each row group, in order. */
  rowGroups: number[];
  close: () => Promise<void>;
}

/** Opens one filing year. Returns null when the partition does not exist (a year not published yet). */
export async function openPartition(base: string, year: number, opts: { fetchImpl?: FetchLike; cacheBytes?: number } = {}): Promise<OpenPartition | null> {
  const location = partitionPath(base, year);
  let raw: AsyncBuffer;
  let close = async () => {};
  if (isRemote(base)) {
    const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
    const head = await fetchImpl(location, { method: "HEAD" });
    if (head.status === 404) return null;
    if (!head.ok) throw new Error(`HEAD ${location} answered ${head.status}`);
    const length = Number(head.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0) throw new Error(`HEAD ${location} gave no content length`);
    raw = await asyncBufferFromUrl({ url: location, byteLength: length, fetch: fetchImpl as typeof fetch });
  } else {
    const path = localPath(location);
    try {
      const f = await fileBuffer(path);
      raw = f;
      close = f.close;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  const file = cachedRanges(raw, opts.cacheBytes ?? 96 * 1024 * 1024);
  const metadata = await parquetMetadataAsync(file);
  return { year, location, file, metadata, rows: Number(metadata.num_rows), rowGroups: metadata.row_groups.map((g) => Number(g.num_rows)), close };
}

/** The column names present in the partition; the importer reads the ones it knows and treats the rest as absent. */
export function columnNames(p: OpenPartition): string[] {
  return p.metadata.schema.slice(1).map((s) => s.name);
}

/**
 * Yields the partition's rows in windows of at most `windowRows`, never
 * crossing a row group boundary, starting at row `fromRow`.
 */
export async function* readWindows(p: OpenPartition, columns: readonly string[], windowRows: number, fromRow = 0): AsyncGenerator<{ start: number; rows: Record<string, unknown>[] }> {
  const present = new Set(columnNames(p));
  const wanted = columns.filter((c) => present.has(c));
  let groupStart = 0;
  for (const groupRows of p.rowGroups) {
    const groupEnd = groupStart + groupRows;
    for (let start = Math.max(groupStart, fromRow); start < groupEnd; start += windowRows) {
      const end = Math.min(groupEnd, start + windowRows);
      const rows = await parquetReadObjects({ file: p.file, metadata: p.metadata, columns: wanted, rowStart: start, rowEnd: end, compressors, useOffsetIndex: true });
      yield { start, rows: rows as Record<string, unknown>[] };
    }
    groupStart = groupEnd;
  }
}

export interface Manifest {
  datasetVersion: string | null;
  years: number[];
}

/**
 * Reads `{base}/manifest.json` when it exists. Its exact layout is not
 * documented beyond "dataset version, build timestamp, row counts per
 * partition", so this looks for a version string and filing years, and
 * returns nothing it cannot find.
 */
export async function readManifest(base: string, fetchImpl?: FetchLike): Promise<Manifest | null> {
  const location = `${base.replace(/\/+$/, "")}/manifest.json`;
  let text: string;
  try {
    if (isRemote(base)) {
      const res = await (fetchImpl ?? (globalThis.fetch as FetchLike))(location);
      if (!res.ok) return null;
      text = await res.text();
    } else {
      const { readFile } = await import("node:fs/promises");
      text = await readFile(localPath(location), "utf8");
    }
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const version = [obj.dataset_version, obj.datasetVersion, obj.version].find((v) => typeof v === "string") as string | undefined;
  const years = new Set<number>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || !v) return;
    if (typeof v === "string") {
      const m = v.match(/filing_year=(\d{4})/);
      if (m) years.add(Number(m[1]));
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const m = k.match(/filing_year=(\d{4})/) ?? (/^(19|20)\d{2}$/.test(k) ? [k, k] : null);
        if (m) years.add(Number(m[1]));
        if (k === "filing_year" && typeof x === "number") years.add(x);
        visit(x, depth + 1);
      }
    }
  };
  visit(obj, 0);
  return { datasetVersion: version ?? null, years: [...years].filter((y) => y >= FIRST_FILING_YEAR && y <= 2100).sort((a, b) => a - b) };
}

/** Years to import: FOUNDATIONS_YEARS ("2023,2024" or "2021-2026"), else the manifest's, else 2019 through this year. */
export function importYears(env: string | undefined, manifest: Manifest | null, now = new Date()): number[] {
  if (env?.trim()) {
    const out = new Set<number>();
    for (const part of env.split(",")) {
      const range = part.trim().match(/^(\d{4})\s*-\s*(\d{4})$/);
      if (range) for (let y = Number(range[1]); y <= Number(range[2]); y++) out.add(y);
      else if (/^\d{4}$/.test(part.trim())) out.add(Number(part.trim()));
    }
    if (out.size) return [...out].sort((a, b) => a - b);
  }
  if (manifest?.years.length) return manifest.years;
  const years: number[] = [];
  for (let y = FIRST_FILING_YEAR; y <= now.getUTCFullYear(); y++) years.push(y);
  return years;
}
