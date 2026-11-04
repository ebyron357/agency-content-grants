/**
 * adoptOrphanedData
 *
 * After deploying shared-password auth onto an existing database, brands and
 * projects that were seeded before user accounts existed have a null userId.
 * This function finds (or creates) the shared admin account and assigns all
 * orphaned records to it, so every authenticated request can see pre-existing
 * data without a manual SQL fix.
 *
 * Safe to run on every startup — it is idempotent.
 */
import { db, usersTable, brandsTable, projectsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

export const ADMIN_USERNAME = "admin";

/**
 * Returns the id of the users row with this username, creating it if needed.
 * Safe when called concurrently: two first requests can race here (a fresh
 * deploy, or parallel test files), so the unique username decides and both
 * read the row that won.
 */
export async function ensureNamedUser(username: string): Promise<string> {
  const find = async () => (await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username)).limit(1))[0];
  const existing = await find();
  if (existing) return existing.id;
  const [created] = await db
    .insert(usersTable)
    .values({ id: randomUUID(), username, passwordHash: "shared-password-auth" }) // never used for verification
    .onConflictDoNothing({ target: usersTable.username })
    .returning({ id: usersTable.id });
  return created?.id ?? (await find())!.id;
}

export async function ensureAdminUser(): Promise<string> {
  return ensureNamedUser(ADMIN_USERNAME);
}

export async function adoptOrphanedData(): Promise<void> {
  const adminId = await ensureAdminUser();

  // Assign all brands/projects that have no owner to the shared admin account.
  await db
    .update(brandsTable)
    .set({ userId: adminId })
    .where(isNull(brandsTable.userId));

  await db
    .update(projectsTable)
    .set({ userId: adminId })
    .where(isNull(projectsTable.userId));
}
