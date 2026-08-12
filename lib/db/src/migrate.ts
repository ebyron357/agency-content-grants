/**
 * Runtime migration runner.
 * Call this once before app.listen() to ensure the schema is up to date.
 * Uses Drizzle's migrate() which tracks applied migrations in drizzle.__drizzle_migrations.
 * Safe to call on every startup (idempotent).
 *
 * Path resolution strategy:
 * The compiled bundle lands at dist/index.mjs. The build step copies
 * lib/db/drizzle/ → dist/drizzle/ so the migrations are always co-located
 * with the bundle. import.meta.url correctly resolves to the bundle path
 * at runtime, making join(dirname, "drizzle") reliable.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;

function getMigrationsFolder(): string {
  // Allow explicit override for unusual deployment layouts
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;

  // __filename is set by the esbuild banner: dirname(fileURLToPath(import.meta.url))
  // In the compiled bundle that is artifacts/api-server/dist/
  // The build step copies lib/db/drizzle/ → dist/drizzle/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, "drizzle");
}

export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set before running migrations");
  }

  const migrationsFolder = getMigrationsFolder();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    console.log("[migrate] Applying pending migrations from", migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] Migrations complete");
  } finally {
    await pool.end();
  }
}
