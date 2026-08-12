import {
  pool,
  runMigrations,
  assertDisposableTestDatabase,
} from "@workspace/db";

export async function resetAndMigrateTestDatabase(): Promise<void> {
  assertDisposableTestDatabase();
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await runMigrations();
}
