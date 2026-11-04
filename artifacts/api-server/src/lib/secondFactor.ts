import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, memberRecoveryCodesTable, membersTable } from "@workspace/db";
import { hashRecoveryCode, normalizeRecoveryCode, openSecret, verifyTotp } from "./mfa";

/**
 * Accepts an authenticator code or a recovery code for a member, once.
 * Authenticator codes are claimed with a conditional update, so the same code
 * cannot succeed twice even in parallel requests.
 */
export async function consumeSecondFactor(member: { id: string; totpSecret: string | null; totpLastStep: number | null }, input: unknown): Promise<"mfa" | "recovery_code" | null> {
  if (!member.totpSecret || typeof input !== "string") return null;
  const step = verifyTotp(openSecret(member.totpSecret), input, member.totpLastStep);
  if (step !== null) {
    const claimed = await db
      .update(membersTable)
      .set({ totpLastStep: step })
      .where(and(eq(membersTable.id, member.id), or(isNull(membersTable.totpLastStep), lt(membersTable.totpLastStep, step))))
      .returning({ id: membersTable.id });
    return claimed.length === 1 ? "mfa" : null;
  }
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return null;
  const used = await db
    .update(memberRecoveryCodesTable)
    .set({ usedAt: new Date() })
    .where(and(eq(memberRecoveryCodesTable.memberId, member.id), eq(memberRecoveryCodesTable.codeHash, hashRecoveryCode(normalized)), isNull(memberRecoveryCodesTable.usedAt)))
    .returning({ id: memberRecoveryCodesTable.id });
  return used.length === 1 ? "recovery_code" : null;
}

