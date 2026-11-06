import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, foundationFundersTable, foundationGrantsTable, foundationImportRunsTable, pool, type FoundationFunder } from "@workspace/db";
import {
  DEFAULT_OPTIONS,
  FunderSegment,
  GRANT_COLUMNS,
  classifyRow,
  emptyCounts,
  mergeFunder,
  type ExclusionCounts,
  type FunderState,
  type ImportOptions,
  type StoredGrant,
} from "./aggregate";
import { DEFAULT_BASE_URL, importYears, openPartition, readManifest, readWindows, type FetchLike } from "./source";

/**
 * The foundation import (docs/GRANT_STUDIO.md, Foundations; docs/BACKGROUND_JOBS.md).
 *
 * Streams each filing year's funder-graph partition, newest year first, a
 * window of rows at a time. Rows are grouped per funder (each partition is
 * sorted by funder EIN), and each funder's filings are merged into its stored
 * aggregate in batches. Nothing but aggregates and each funder's few largest
 * recent grants is written, and the import stops (status "partial") when the
 * foundation tables reach their storage budget.
 */

export const SOURCE_NAME = "funder-graph";
export const SOURCE_REPO = "https://github.com/egeria-corporation/funder-graph";
export const IRS_DOWNLOADS = "https://www.irs.gov/charities-non-profits/form-990-series-downloads";

export interface ImportConfig {
  baseUrl: string;
  years: number[] | null;
  options: ImportOptions;
  /** Form types imported: 990PF (private foundations, Part XV) and/or 990 (public charities, Schedule I). */
  formTypes: string[];
  /**
   * A funder not yet stored is added only when its grants paid in the newest
   * filing year it appears in reach this amount. 0 keeps every funder. The
   * lever for fitting a small database: larger funders are kept first.
   */
  minNewFunderUsd: number;
  windowRows: number;
  batchFunders: number;
  cacheBytes: number;
  maxDbBytes: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.trunc(n) : fallback;
}

export function configFromEnv(): ImportConfig {
  const conf = Number(process.env.FOUNDATIONS_MIN_CONFIDENCE);
  const forms = (process.env.FOUNDATIONS_FORM_TYPES ?? "990PF").split(",").map((s) => s.trim().toUpperCase()).filter((s) => s === "990PF" || s === "990");
  return {
    baseUrl: process.env.FOUNDATIONS_DATA_BASE_URL?.trim() || DEFAULT_BASE_URL,
    years: process.env.FOUNDATIONS_YEARS?.trim() ? importYears(process.env.FOUNDATIONS_YEARS, null) : null,
    options: {
      minConfidence: Number.isFinite(conf) && conf >= 0.5 && conf <= 1 ? conf : DEFAULT_OPTIONS.minConfidence,
      recentPerFunder: intEnv("FOUNDATIONS_RECENT_PER_FUNDER", 5, 0, 50),
      statesPerFunder: intEnv("FOUNDATIONS_STATES_PER_FUNDER", DEFAULT_OPTIONS.statesPerFunder, 5, 60),
    },
    formTypes: forms.length ? forms : ["990PF"],
    minNewFunderUsd: intEnv("FOUNDATIONS_MIN_GIVING_USD", 0, 0, 1_000_000_000),
    windowRows: intEnv("FOUNDATIONS_WINDOW_ROWS", 10_000, 1_000, 500_000),
    batchFunders: intEnv("FOUNDATIONS_BATCH_FUNDERS", 500, 10, 5_000),
    cacheBytes: intEnv("FOUNDATIONS_CACHE_MB", 64, 8, 256) * 1024 * 1024,
    maxDbBytes: intEnv("FOUNDATIONS_MAX_DB_MB", 64, 1, 100_000) * 1024 * 1024,
  };
}

export interface ImportResult {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  years: number[];
  yearsDone: number[];
  missingYears: number[];
  stats: Record<string, number>;
  funders: number;
  grantsStored: number;
  bytesUsed: number;
  note?: string;
  error?: string;
}

async function vacuum(): Promise<void> {
  await pool.query("VACUUM (ANALYZE) foundation_funders, foundation_grants").catch((err) => console.warn("[foundations] vacuum failed", (err as Error).message));
}

/** Bytes used by the three foundation tables, indexes and TOAST included. */
export async function foundationBytes(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
       FROM pg_class c WHERE c.relname IN ('foundation_funders', 'foundation_grants', 'foundation_import_runs') AND c.relkind = 'r'`,
  );
  return Number(rows[0]?.bytes ?? 0);
}

function stateOf(row: FoundationFunder): FunderState {
  return {
    ein: row.ein, name: row.name, state: row.state, formType: row.formType, totalPaidUsd: Number(row.totalPaidUsd), grantCount: row.grantCount,
    firstTaxYear: row.firstTaxYear, lastTaxYear: row.lastTaxYear, givingByYear: row.givingByYear, givingByState: row.givingByState,
    givingByCategory: row.givingByCategory, categorySources: row.categorySources, sizeHistogram: row.sizeHistogram, sizeStats: row.sizeStats,
    filings: row.filings, latestObjectId: row.latestObjectId, latestTaxPeriodEnd: row.latestTaxPeriodEnd, latestSubmittedOn: row.latestSubmittedOn,
  };
}

/** Merges a batch of funder segments into the database in one transaction. */
async function flushBatch(segments: FunderSegment[], cfg: ImportConfig, runId: string, datasetVersion: string | null, stats: Record<string, number>): Promise<void> {
  if (!segments.length) return;
  const eins = segments.map((s) => s.ein);
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(foundationFundersTable).where(inArray(foundationFundersTable.ein, eins));
    const recentRows = existing.length ? await tx.select().from(foundationGrantsTable).where(inArray(foundationGrantsTable.funderEin, existing.map((e) => e.ein))) : [];
    const byEin = new Map(existing.map((e) => [e.ein, stateOf(e)]));
    const recentByEin = new Map<string, StoredGrant[]>();
    for (const g of recentRows) recentByEin.set(g.funderEin, [...(recentByEin.get(g.funderEin) ?? []), { ...g, amountUsd: Number(g.amountUsd) }]);
    const funderRows: (typeof foundationFundersTable.$inferInsert)[] = [];
    const grantRows: (typeof foundationGrantsTable.$inferInsert)[] = [];
    for (const seg of segments) {
      if (!byEin.has(seg.ein) && cfg.minNewFunderUsd > 0 && seg.chosen().reduce((s, f) => s + f.total, 0) < cfg.minNewFunderUsd) {
        stats.funders_below_minimum = (stats.funders_below_minimum ?? 0) + 1;
        continue;
      }
      const merged = mergeFunder(seg.ein, byEin.get(seg.ein) ?? null, recentByEin.get(seg.ein) ?? [], seg.chosen(), cfg.options);
      stats.filings_counted = (stats.filings_counted ?? 0) + merged.added;
      stats.filings_superseded = (stats.filings_superseded ?? 0) + merged.superseded;
      stats.filings_already_counted = (stats.filings_already_counted ?? 0) + merged.alreadyCounted;
      if (!merged.added || !merged.state.grantCount) continue;
      const s = merged.state;
      funderRows.push({
        ein: s.ein, name: s.name, nameSearch: s.name.toUpperCase(), state: s.state, formType: s.formType, totalPaidUsd: s.totalPaidUsd, grantCount: s.grantCount,
        firstTaxYear: s.firstTaxYear, lastTaxYear: s.lastTaxYear, givingByYear: s.givingByYear, givingByState: s.givingByState, givingByCategory: s.givingByCategory,
        categorySources: s.categorySources, sizeHistogram: s.sizeHistogram, sizeStats: s.sizeStats, filings: s.filings, latestObjectId: s.latestObjectId,
        latestTaxPeriodEnd: s.latestTaxPeriodEnd, latestSubmittedOn: s.latestSubmittedOn, datasetVersion, importRunId: runId, updatedAt: new Date(),
      });
      grantRows.push(...merged.recent);
    }
    if (!funderRows.length) return;
    await tx
      .insert(foundationFundersTable)
      .values(funderRows)
      .onConflictDoUpdate({
        target: foundationFundersTable.ein,
        set: Object.fromEntries(UPSERT_COLUMNS.map((c) => [toCamel(c), sql.raw(`excluded.${c}`)])),
      });
    await tx.delete(foundationGrantsTable).where(inArray(foundationGrantsTable.funderEin, funderRows.map((f) => f.ein)));
    for (let i = 0; i < grantRows.length; i += 1000) await tx.insert(foundationGrantsTable).values(grantRows.slice(i, i + 1000)).onConflictDoNothing();
  });
}

const UPSERT_COLUMNS = [
  "name", "name_search", "state", "form_type", "total_paid_usd", "grant_count", "first_tax_year", "last_tax_year", "giving_by_year", "giving_by_state",
  "giving_by_category", "category_sources", "size_histogram", "size_stats", "filings", "latest_object_id", "latest_tax_period_end", "latest_submitted_on",
  "dataset_version", "import_run_id", "updated_at",
];
const toCamel = (c: string) => c.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());

export interface RunOptions {
  config?: Partial<ImportConfig>;
  fetchImpl?: FetchLike;
  jobId?: string;
  signal?: AbortSignal;
  onProgress?: (p: Record<string, unknown>) => Promise<void> | void;
}

/** Runs one import. Never throws for a missing year or the storage budget; throws when no year could be read. */
export async function runFoundationImport(opts: RunOptions = {}): Promise<ImportResult> {
  const cfg: ImportConfig = { ...configFromEnv(), ...opts.config, options: { ...configFromEnv().options, ...opts.config?.options } };
  const runId = randomUUID();
  const manifest = await readManifest(cfg.baseUrl, opts.fetchImpl);
  const years = [...(cfg.years ?? importYears(undefined, manifest))].sort((a, b) => b - a);
  const datasetVersion = manifest?.datasetVersion ?? null;
  await db.insert(foundationImportRunsTable).values({ id: runId, jobId: opts.jobId ?? null, status: "running", baseUrl: cfg.baseUrl, datasetVersion, years, minConfidence: cfg.options.minConfidence });

  const counts: ExclusionCounts & Record<string, number> = { ...emptyCounts(), other_form: 0, unsorted: 0 };
  const yearsDone: number[] = [];
  const missingYears: number[] = [];
  let note: string | undefined;
  let status: ImportResult["status"] = "succeeded";
  let error: string | undefined;
  let bytesUsed = await foundationBytes();
  const peak = { rss: process.memoryUsage().rss };

  const finish = async () => {
    bytesUsed = await foundationBytes();
    const [{ funders }] = (await pool.query(`SELECT count(*)::int AS funders FROM foundation_funders`)).rows;
    const [{ grants }] = (await pool.query(`SELECT count(*)::int AS grants FROM foundation_grants`)).rows;
    const stats = { ...counts, peak_rss_mb: Math.round(peak.rss / 1048576) };
    await db.update(foundationImportRunsTable).set({ status, yearsDone, stats, funders, grantsStored: grants, bytesUsed, note: note ?? null, error: error ?? null, finishedAt: new Date() }).where(eq(foundationImportRunsTable.id, runId));
    return { runId, status, years, yearsDone, missingYears, stats, funders, grantsStored: grants, bytesUsed, note, error } satisfies ImportResult;
  };

  try {
    outer: for (const year of years) {
      opts.signal?.throwIfAborted();
      const part = await openPartition(cfg.baseUrl, year, { fetchImpl: opts.fetchImpl, cacheBytes: cfg.cacheBytes });
      if (!part) {
        missingYears.push(year);
        continue;
      }
      try {
        // Rows are grouped per funder; each partition is sorted by funder EIN (funder-graph README).
        let batch = new Map<string, FunderSegment>();
        const written = new Set<string>();
        let rowsDone = 0;
        const flush = async () => {
          await flushBatch([...batch.values()], cfg, runId, datasetVersion, counts);
          for (const ein of batch.keys()) written.add(ein);
          batch = new Map();
          bytesUsed = await foundationBytes();
          return bytesUsed < cfg.maxDbBytes;
        };
        for await (const { rows } of readWindows(part, GRANT_COLUMNS, cfg.windowRows)) {
          opts.signal?.throwIfAborted();
          for (const raw of rows) {
            counts.read += 1;
            const form = String(raw.funder_form_type ?? "990PF").toUpperCase();
            if (!cfg.formTypes.includes(form)) {
              counts.other_form += 1;
              continue;
            }
            const result = classifyRow(raw, cfg.options);
            if (!result.ok) {
              counts[result.reason] += 1;
              continue;
            }
            const g = result.grant;
            // A funder whose grants were already written for this year: the input is not sorted. Counted, never merged twice.
            if (written.has(g.funderEin)) {
              counts.unsorted += 1;
              continue;
            }
            let segment = batch.get(g.funderEin);
            if (!segment) {
              if (batch.size >= cfg.batchFunders && !(await flush())) {
                note = `Stopped at the storage budget (${Math.round(cfg.maxDbBytes / 1048576)} MB, FOUNDATIONS_MAX_DB_MB) during filing year ${year}.`;
                status = "partial";
                break outer;
              }
              segment = new FunderSegment(g.funderEin, cfg.options);
              batch.set(g.funderEin, segment);
            }
            counts.kept += 1;
            segment.add(g);
          }
          rowsDone += rows.length;
          peak.rss = Math.max(peak.rss, process.memoryUsage().rss);
          await opts.onProgress?.({ year, rowsDone, rows: part.rows, yearsDone: [...yearsDone], bytesUsed, peakRssMb: Math.round(peak.rss / 1048576) });
        }
        if (!(await flush())) {
          note = `Stopped at the storage budget (${Math.round(cfg.maxDbBytes / 1048576)} MB, FOUNDATIONS_MAX_DB_MB) after filing year ${year}.`;
          status = "partial";
          yearsDone.push(year);
          break;
        }
        yearsDone.push(year);
        await db.update(foundationImportRunsTable).set({ yearsDone, stats: counts }).where(eq(foundationImportRunsTable.id, runId));
        // Each year rewrites most funder rows; vacuuming lets the next year reuse that space instead of growing the tables.
        await vacuum();
      } finally {
        await part.close();
      }
    }
    if (status === "succeeded" && !yearsDone.length) {
      status = "failed";
      error = `No filing year could be read from ${cfg.baseUrl} (missing: ${missingYears.join(", ") || "none"}).`;
    } else if (status === "succeeded" && missingYears.length) {
      note = `Filing years not found at the source: ${missingYears.join(", ")}.`;
    }
  } catch (err) {
    status = "failed";
    error = (err as Error).message?.slice(0, 1000) || String(err);
  }
  const result = await finish();
  if (result.status === "failed") throw Object.assign(new Error(result.error ?? "Foundation import failed"), { result });
  return result;
}
