import { pool } from "@workspace/db";
import { resetAndMigrateTestDatabase } from "./databaseBootstrap";

try {
  await resetAndMigrateTestDatabase();
} finally {
  await pool.end();
}
