// Shows what drizzle's migrator does if 0033 is deployed before 0030-0032 (out-of-order merge + deploy).
// Usage: node order-hazard.mjs <combined tree> <database url>
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const [tree, url] = process.argv.slice(2);
const req = createRequire(path.join(tree, "lib/db/package.json"));
const { drizzle } = req("drizzle-orm/node-postgres");
const { migrate } = req("drizzle-orm/node-postgres/migrator");
const pg = req("pg");
const src = path.join(tree, "lib/db/drizzle");
const tmp = fs.mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname), "mig-"));
fs.cpSync(src, tmp, { recursive: true });
const journalPath = path.join(tmp, "meta/_journal.json");
const full = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const skip = ["0030_foundation_giving", "0031_source_registry", "0032_grant_notice_checklist"];
fs.writeFileSync(journalPath, JSON.stringify({ ...full, entries: full.entries.filter((e) => !skip.includes(e.tag)) }));
const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool);
await migrate(db, { migrationsFolder: tmp });
const tables = async () => (await pool.query("select table_name from information_schema.tables where table_name in ('foundation_funders','grant_sources','grant_notices','billing_plans') order by 1")).rows.map((r) => r.table_name).join(",");
console.log("after deploying 0033 first:", await tables(), "rows:", (await pool.query("select count(*) from drizzle.__drizzle_migrations")).rows[0].count);
fs.writeFileSync(journalPath, JSON.stringify(full));
await migrate(db, { migrationsFolder: tmp });
console.log("after deploying the full journal:", await tables(), "rows:", (await pool.query("select count(*) from drizzle.__drizzle_migrations")).rows[0].count);
await pool.end();
fs.rmSync(tmp, { recursive: true });
