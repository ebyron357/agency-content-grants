import { resetAndMigrateTestDatabase } from "./databaseBootstrap";

export async function setup(): Promise<void> {
  await resetAndMigrateTestDatabase();
}
