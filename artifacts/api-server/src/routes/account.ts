import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db, memberRecoveryCodesTable, membersTable, workspacesTable, type Member } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { verifyPassword } from "../lib/password";
import { invalidateMembershipCache } from "../middleware/requireAuth";
import {
  groupSecret,
  hashRecoveryCode,
  mfaEncryptionConfigured,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  sealSecret,
  verifyTotp,
} from "../lib/mfa";
import { consumeSecondFactor } from "../lib/secondFactor";
import { activeMemberSessions, describeDevice, revokeMemberSession, revokeMemberSessions } from "../lib/memberSessions";

/**
 * A member's own security (docs/SECURITY_AND_ACCESS_HANDOFF.md): two-factor
 * sign-in, recovery codes and signed-in devices. Mounted behind requireAuth,
 * which lets these routes through for a member who must still turn on
 * two-factor. The team password has no personal account, so it has none of these.
 */

const router: IRouter = Router();

/** A setup secret must be confirmed within this time. */
const SETUP_TTL_MS = 10 * 60 * 1000;

function fail(res: Response, status: number, error: string, code?: string): void {
  res.status(status).json(code ? { error, code } : { error });
}

async function signedInMember(req: Request, res: Response): Promise<Member | null> {
  if (!req.session.memberId) {
    fail(res, 400, "The team password has no personal account. Sign in with your own email to manage your security.");
    return null;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.session.memberId)).limit(1);
  if (!member) {
    fail(res, 401, "Unauthorized");
    return null;
  }
  return member;
}

async function storeRecoveryCodes(memberId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.delete(memberRecoveryCodesTable).where(eq(memberRecoveryCodesTable.memberId, memberId));
    await tx.insert(memberRecoveryCodesTable).values(codes.map((c) => ({ id: randomUUID(), memberId, codeHash: hashRecoveryCode(c) })));
  });
  return codes;
}

async function workspaceRequiresMfa(workspaceId: string | undefined): Promise<boolean> {
  if (!workspaceId) return false;
  const [ws] = await db.select({ requireMfa: workspacesTable.requireMfa }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId)).limit(1);
  return ws?.requireMfa === true;
}

/** GET /account/security: two-factor status, recovery codes left, and whether the workspace requires it. */
router.get("/account/security", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  const [{ n }] = await db.select({ n: count() }).from(memberRecoveryCodesTable).where(and(eq(memberRecoveryCodesTable.memberId, member.id), isNull(memberRecoveryCodesTable.usedAt)));
  res.json({
    mfaEnabled: !!member.totpEnabledAt,
    mfaEnabledAt: member.totpEnabledAt,
    recoveryCodesRemaining: Number(n),
    requiredByWorkspace: await workspaceRequiresMfa(req.session.workspaceId),
    secretsEncrypted: mfaEncryptionConfigured(),
  });
});

/** POST /account/mfa/setup: a new secret to scan. Nothing changes until /account/mfa/enable confirms a code. */
router.post("/account/mfa/setup", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  if (member.totpEnabledAt) return fail(res, 409, "Two-factor sign-in is already on.");
  const secret = newTotpSecret();
  req.session.mfaSetup = { secret, at: Date.now() };
  req.session.save(() => res.json({ secret: groupSecret(secret), otpauthUri: otpauthUri(secret, member.email) }));
});

/** POST /account/mfa/enable { code }: confirms the app works, turns two-factor on, and returns recovery codes once. */
router.post("/account/mfa/enable", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  if (member.totpEnabledAt) return fail(res, 409, "Two-factor sign-in is already on.");
  const setup = req.session.mfaSetup;
  if (!setup || Date.now() - setup.at > SETUP_TTL_MS) return fail(res, 400, "Setup expired. Start again to get a new code to scan.", "setup_expired");
  const step = verifyTotp(setup.secret, req.body?.code, null);
  if (step === null) return fail(res, 400, "That code is not correct. Enter the 6-digit code your app shows now.");
  await db.update(membersTable).set({ totpSecret: sealSecret(setup.secret), totpEnabledAt: new Date(), totpLastStep: step }).where(and(eq(membersTable.id, member.id), isNull(membersTable.totpEnabledAt)));
  const recoveryCodes = await storeRecoveryCodes(member.id);
  req.session.mfaSetup = undefined;
  invalidateMembershipCache(member.id);
  await logActivity("member_mfa_enabled", `${member.name} turned on two-factor sign-in`, { userId: req.session.userId, actorName: member.name }).catch(() => {});
  req.session.save(() => res.json({ mfaEnabled: true, recoveryCodes }));
});

/** POST /account/mfa/disable { password, code }: turns two-factor off, unless the workspace requires it. */
router.post("/account/mfa/disable", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  if (!member.totpEnabledAt) return fail(res, 409, "Two-factor sign-in is not on.");
  if (await workspaceRequiresMfa(req.session.workspaceId)) return fail(res, 409, "This workspace requires two-factor sign-in, so it cannot be turned off here.");
  const { password, code } = req.body ?? {};
  if (typeof password !== "string" || !(await verifyPassword(password, member.passwordHash))) return fail(res, 401, "Your password is not correct.");
  if (!(await consumeSecondFactor(member, code))) return fail(res, 401, "Enter a current code from your authenticator app, or a recovery code.");
  await db.update(membersTable).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(membersTable.id, member.id));
  await db.delete(memberRecoveryCodesTable).where(eq(memberRecoveryCodesTable.memberId, member.id));
  invalidateMembershipCache(member.id);
  await logActivity("member_mfa_disabled", `${member.name} turned off two-factor sign-in`, { userId: req.session.userId, actorName: member.name }).catch(() => {});
  res.json({ mfaEnabled: false });
});

/** POST /account/mfa/recovery-codes { code }: replaces every recovery code; the old ones stop working. */
router.post("/account/mfa/recovery-codes", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  if (!member.totpEnabledAt) return fail(res, 409, "Turn on two-factor sign-in first.");
  if ((await consumeSecondFactor(member, req.body?.code)) !== "mfa") return fail(res, 401, "Enter the current code from your authenticator app.");
  const recoveryCodes = await storeRecoveryCodes(member.id);
  await logActivity("member_recovery_codes_replaced", `${member.name} replaced their recovery codes`, { userId: req.session.userId, actorName: member.name }).catch(() => {});
  res.json({ recoveryCodes });
});

/** GET /account/sessions: this person's signed-in browsers, current one first. */
router.get("/account/sessions", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  const rows = await activeMemberSessions(member.id);
  const ids = [...new Set(rows.map((s) => s.workspaceId))];
  const workspaces = new Map(ids.length ? (await db.select({ id: workspacesTable.id, name: workspacesTable.name }).from(workspacesTable).where(inArray(workspacesTable.id, ids))).map((w) => [w.id, w.name]) : []);
  const view = rows.map((s) => ({
    id: s.id,
    device: describeDevice(s.userAgent),
    ipAddress: s.ipAddress,
    workspace: workspaces.get(s.workspaceId) ?? null,
    method: s.method,
    signedInAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    current: s.id === req.session.memberSessionId,
  }));
  view.sort((a, b) => Number(b.current) - Number(a.current));
  res.json(view);
});

/** DELETE /account/sessions/:id: signs one of this person's other browsers out. */
router.delete("/account/sessions/:id", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  const id = String(req.params.id);
  if (id === req.session.memberSessionId) return fail(res, 400, "Use Sign out to end this session.");
  if (!(await revokeMemberSession(id, member.id))) return fail(res, 404, "Session not found");
  await logActivity("member_session_ended", `${member.name} signed out another browser`, { userId: req.session.userId, actorName: member.name }).catch(() => {});
  res.status(204).end();
});

/** POST /account/sessions/revoke-others: signs this person out everywhere except here. */
router.post("/account/sessions/revoke-others", async (req, res): Promise<void> => {
  const member = await signedInMember(req, res);
  if (!member) return;
  const ended = await revokeMemberSessions(member.id, { keep: req.session.memberSessionId });
  await logActivity("member_signed_out_everywhere", `${member.name} signed out ${ended} other browser${ended === 1 ? "" : "s"}`, { userId: req.session.userId, actorName: member.name }).catch(() => {});
  res.json({ ended });
});

export default router;
