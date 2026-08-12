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

export async function ensureAdminUser(): Promise<string> {
  let [adminUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, ADMIN_USERNAME))
    .limit(1);

  if (!adminUser) {
    const [created] = await db
      .insert(usersTable)
      .values({
        id: randomUUID(),
        username: ADMIN_USERNAME,
        passwordHash: "shared-password-auth", // never used for verification
      })
      .returning({ id: usersTable.id });
    adminUser = created;
  }

  return adminUser.id;
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
