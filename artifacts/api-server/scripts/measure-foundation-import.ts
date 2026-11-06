// Measures the foundation import: peak memory, time and table sizes.
// Refuses to run against anything but a disposable *_test database, and empties
// the foundation tables first. Evidence: docs/evidence/foundations/2026-11-05/.
//
//   DATABASE_URL=postgresql://…/x_test FOUNDATIONS_DATA_BASE_URL=<dir or url> \
//     pnpm exec tsx scripts/measure-foundation-import.ts
import { assertDisposableTestDatabase, pool } from "@workspace/db";
import { runFoundationImport } from "../src/lib/foundations/importer";

assertDisposableTestDatabase();
await pool.query(
  "TRUNCATE foundation_grants, foundation_funders, foundation_import_runs",
);

let peak = process.memoryUsage().rss;
const timer = setInterval(
  () => (peak = Math.max(peak, process.memoryUsage().rss)),
  100,
);
const started = Date.now();
const result = await runFoundationImport({
  onProgress: (p) =>
    void ((peak = Math.max(peak, process.memoryUsage().rss)), p),
});
clearInterval(timer);

const sizes = async () =>
  (
    await pool.query(`
  SELECT c.relname AS table, pg_total_relation_size(c.oid)::bigint AS total, pg_relation_size(c.oid)::bigint AS heap, pg_indexes_size(c.oid)::bigint AS indexes
    FROM pg_class c WHERE c.relname IN ('foundation_funders', 'foundation_grants') AND c.relkind = 'r' ORDER BY 1`)
  ).rows.map((r) => ({
    table: r.table,
    totalMb: +(Number(r.total) / 1048576).toFixed(2),
    heapMb: +(Number(r.heap) / 1048576).toFixed(2),
    indexesMb: +(Number(r.indexes) / 1048576).toFixed(2),
  }));
const counts = (
  await pool.query(
    `SELECT (SELECT count(*) FROM foundation_funders)::int AS funders, (SELECT count(*) FROM foundation_grants)::int AS grants`,
  )
).rows[0];
const asLeft = await sizes();
// Live size: what the same rows take once compacted (a fresh import into empty tables is close to this).
await pool.query("VACUUM FULL foundation_funders, foundation_grants");
const compacted = await sizes();
const bytes = (
  await pool.query(
    `SELECT pg_total_relation_size('foundation_funders') + pg_total_relation_size('foundation_grants') AS b`,
  )
).rows[0].b;
console.log(
  JSON.stringify(
    {
      seconds: Math.round((Date.now() - started) / 100) / 10,
      peakRssMb: Math.round(peak / 1048576),
      heapLimitMb: Math.round(
        (await import("node:v8")).getHeapStatistics().heap_size_limit / 1048576,
      ),
      result: {
        status: result.status,
        yearsDone: result.yearsDone,
        stats: result.stats,
        note: result.note,
      },
      counts,
      tablesAsLeft: asLeft,
      tablesCompacted: compacted,
      bytesPerFunderCompacted: Math.round(
        Number(bytes) / Math.max(1, counts.funders),
      ),
    },
    null,
    2,
  ),
);
await pool.end();
