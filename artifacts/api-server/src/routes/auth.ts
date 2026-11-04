import { Router, type IRouter } from "express";
import { timingSafeEqual, createHash } from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logActivity } from "../lib/activity";
import { PgRateLimitStore } from "../lib/pgRateLimitStore";
import { ensureAdminUser } from "../lib/adoptData";
import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, invitesTable, membersTable, membershipsTable, workspacesTable } from "@workspace/db";
import type { Request, Response } from "express";
import { hashPassword, verifyPassword } from "../lib/password";
import { permissionsOf } from "../lib/permissions";
import { consumeSecondFactor } from "../lib/secondFactor";
import { memberSessionActive, revokeMemberSession, revokeMemberSessions, startMemberSession } from "../lib/memberSessions";
import { ROLES, ensureAgencyWorkspace, hashToken, isRole, memberView, memberWorkspaces, membershipOf, normalizeEmail, passwordProblem, upgradeLegacySession, type WorkspaceAccess } from "../lib/workspaces";

const router: IRouter = Router();

// Stricter lockout for login: 5 attempts per 15 minutes per IP.
// A successful login resets the counter (see resetKey call below).
const loginKey = (ip: string | undefined) => ipKeyGenerator(ip ?? "");
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many failed attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  // Postgres-backed so lockouts survive restarts and scale across instances
  store: new PgRateLimitStore("login"),
});

// Same strict lockout for admin unlock attempts (5 per 15 minutes per IP).
const adminUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many failed attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  // Postgres-backed so lockouts survive restarts and scale across instances
  store: new PgRateLimitStore("admin-unlock"),
});

// Invitation lookups and acceptance: 20 failed attempts per 15 minutes per IP. Only
// failures count, so guessing tokens is throttled while a team joining from one office is not.
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  store: new PgRateLimitStore("invite"),
});

// Two-factor codes: 5 failed attempts per 15 minutes per IP, on top of 5 per pending sign-in.
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: "Too many incorrect codes. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  store: new PgRateLimitStore("mfa"),
});

/** A pending two-factor sign-in expires after this long. */
const PENDING_MFA_MS = 5 * 60 * 1000;
const PENDING_MFA_ATTEMPTS = 5;

/** A hash of a random password, so an unknown email takes as long to reject as a wrong password. */
let dummyHash: Promise<string> | null = null;

/**
 * Regenerates the session (no fixation) and signs a member in to one workspace,
 * with a member_sessions row for this browser. The previous row, if any, ends.
 */
async function signInMember(req: Request, res: Response, member: { id: string; name: string }, access: WorkspaceAccess, status = 200, method: "password" | "mfa" | "recovery_code" | "invite" = "password"): Promise<void> {
  await revokeMemberSession(req.session.memberSessionId);
  const memberSessionId = await startMemberSession(req, member.id, access.workspace.id, method);
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).json({ error: "Session error" });
      return;
    }
    req.session.memberSessionId = memberSessionId;
    req.session.authenticated = true;
    req.session.userId = access.workspace.principalUserId;
    req.session.memberId = member.id;
    req.session.workspaceId = access.workspace.id;
    req.session.role = access.role;
    req.session.actorName = member.name;
    req.session.isAdmin = false;
    req.session.save((saveErr) => {
      if (saveErr) {
        res.status(500).json({ error: "Session save failed" });
        return;
      }
      res.status(status).json({ authenticated: true, workspace: { id: access.workspace.id, name: access.workspace.name }, role: access.role });
    });
  });
}

/**
 * POST /api/auth/login
 * With { email, password }: a member signs in to their workspace (or the
 * requested { workspaceId } they belong to). With { password } only: the
 * shared operator password signs in to the agency workspace as its owner.
 */
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email: rawEmail, password, workspaceId } = req.body ?? {};
  if (rawEmail !== undefined && rawEmail !== null && rawEmail !== "") {
    const email = normalizeEmail(rawEmail);
    const [member] = email ? await db.select().from(membersTable).where(eq(membersTable.email, email)).limit(1) : [];
    dummyHash ??= hashPassword(randomUUID());
    const ok = typeof password === "string" && (await verifyPassword(password, member?.passwordHash ?? (await dummyHash)));
    if (!member || !ok || member.status !== "active") {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const workspaces = await memberWorkspaces(member.id);
    const access = workspaces.find((w) => w.workspace.id === workspaceId) ?? workspaces[0];
    if (!access) {
      res.status(403).json({ error: "This account is not in any workspace. Ask an owner for a new invitation." });
      return;
    }
    loginLimiter.resetKey(loginKey(req.ip));
    if (member.totpEnabledAt && member.totpSecret) {
      // Password accepted; the sign-in completes at /auth/mfa/verify.
      req.session.regenerate((err) => {
        if (err) {
          res.status(500).json({ error: "Session error" });
          return;
        }
        req.session.pendingMfa = { memberId: member.id, workspaceId: access.workspace.id, at: Date.now(), attempts: 0 };
        req.session.save(() => res.json({ authenticated: false, mfaRequired: true }));
      });
      return;
    }
    await db.update(membersTable).set({ lastSignInAt: new Date() }).where(eq(membersTable.id, member.id));
    await logActivity("member_signed_in", `${member.name} signed in to ${access.workspace.name}`, { userId: access.workspace.principalUserId, actorName: member.name }).catch(() => {});
    await signInMember(req, res, member, access);
    return;
  }

  if (!process.env.ADMIN_PASSWORD) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured" });
    return;
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  // Ensure the shared admin user exists and get their ID so per-user route
  // ownership checks work (every brand/project is owned by this account).
  const adminId = await ensureAdminUser();
  const agency = await ensureAgencyWorkspace();

  req.session.authenticated = true;
  req.session.userId = adminId;
  req.session.workspaceId = agency.id;
  req.session.role = "owner";
  req.session.memberId = undefined;
  req.session.actorName = undefined;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session save failed" });
      return;
    }
    loginLimiter.resetKey(loginKey(req.ip));
    res.json({ authenticated: true });
  });
});

/**
 * POST /api/auth/mfa/verify { code } or { recoveryCode }
 * Completes a sign-in whose password was accepted. A code works once; a
 * recovery code works once and is then spent.
 */
router.post("/auth/mfa/verify", mfaLimiter, async (req, res): Promise<void> => {
  const pending = req.session.pendingMfa;
  if (!pending || Date.now() - pending.at > PENDING_MFA_MS || pending.attempts >= PENDING_MFA_ATTEMPTS) {
    req.session.pendingMfa = undefined;
    res.status(401).json({ error: "Your sign-in has expired. Enter your email and password again.", code: "mfa_expired" });
    return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, pending.memberId)).limit(1);
  const access = member && member.status === "active" ? await membershipOf(member.id, pending.workspaceId) : null;
  if (!member || !access || !member.totpSecret) {
    req.session.pendingMfa = undefined;
    res.status(401).json({ error: "Your sign-in has expired. Enter your email and password again.", code: "mfa_expired" });
    return;
  }
  const { code, recoveryCode } = req.body ?? {};
  // Either field accepts either kind: six digits are checked as an authenticator code, anything else as a recovery code.
  const method = await consumeSecondFactor(member, recoveryCode ?? code);
  if (!method) {
    pending.attempts += 1;
    req.session.save(() => res.status(401).json({ error: recoveryCode !== undefined ? "That recovery code is not valid or was already used." : "That code is not correct. Use the current code from your authenticator app." }));
    return;
  }
  await db.update(membersTable).set({ lastSignInAt: new Date() }).where(eq(membersTable.id, member.id));
  await logActivity(method === "recovery_code" ? "member_signed_in_recovery_code" : "member_signed_in", `${member.name} signed in to ${access.workspace.name} with ${method === "recovery_code" ? "a recovery code" : "two-factor"}`, { userId: access.workspace.principalUserId, actorName: member.name }).catch(() => {});
  req.session.pendingMfa = undefined;
  await signInMember(req, res, member, access, 200, method);
});

/**
 * POST /api/auth/logout
 * Destroys the current session and ends its member_sessions row.
 */
router.post("/auth/logout", async (req, res) => {
  await revokeMemberSession(req.session.memberSessionId).catch(() => {});
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    res.clearCookie("sid");
    res.json({ authenticated: false });
  });
});

/**
 * POST /api/auth/admin-unlock
 * Elevate the current session to admin by presenting the shared ADMIN_PASSWORD.
 * Requires an authenticated session. Timing-safe comparison.
 */
router.post("/auth/admin-unlock", adminUnlockLimiter, async (req, res): Promise<void> => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { password } = req.body ?? {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(403).json({ error: "Admin access is not configured on this server" });
    return;
  }
  const candidate = typeof password === "string" ? password : "";
  // Hash both sides so the comparison is equal-length regardless of input length
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  const match = timingSafeEqual(a, b);
  if (!match) {
    res.status(403).json({ error: "Invalid admin password" });
    return;
  }
  req.session.isAdmin = true;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: "Session error" }); return; }
    adminUnlockLimiter.resetKey(loginKey(req.ip));
    logActivity("admin_unlocked", "Admin access unlocked", { userId: req.session.userId, actorName: req.session.actorName })
      .catch((e) => req.log?.warn({ err: e }, "activity log failed"));
    res.json({ ok: true, isAdmin: true });
  });
});

/**
 * POST /api/auth/admin-lock
 * Drop admin elevation from the current session (keeps the user logged in).
 */
router.post("/auth/admin-lock", (req, res): void => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.session.isAdmin = false;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: "Session error" }); return; }
    res.json({ ok: true, isAdmin: false });
  });
});

/**
 * GET /api/auth/me
 * Returns the session's identity for the UI: whether it is signed in and
 * admin-unlocked, the member and workspace, the role, and the permissions that
 * role holds (lib/permissions.ts), so screens can offer only what will work.
 */
router.get("/auth/me", async (req, res) => {
  const authenticated = req.session.authenticated === true;
  if (!authenticated) {
    const pending = req.session.pendingMfa;
    res.json({ authenticated: false, isAdmin: false, mfaPending: !!pending && Date.now() - pending.at < PENDING_MFA_MS });
    return;
  }
  await upgradeLegacySession(req.session);
  const [workspace] = req.session.workspaceId ? await db.select().from(workspacesTable).where(eq(workspacesTable.id, req.session.workspaceId)).limit(1) : [];
  let member: (ReturnType<typeof memberView> & { mfaEnabled: boolean }) | null = null;
  let workspaces: { id: string; name: string; role: string }[] = [];
  if (req.session.memberId) {
    const [row] = await db.select().from(membersTable).where(eq(membersTable.id, req.session.memberId)).limit(1);
    if (!row || row.status !== "active" || !(await memberSessionActive(req.session.memberSessionId))) {
      // A removed or disabled member's session, or one ended from another device, ends here.
      req.session.destroy(() => res.json({ authenticated: false, isAdmin: false }));
      return;
    }
    member = { ...memberView(row), mfaEnabled: !!row.totpEnabledAt };
    workspaces = (await memberWorkspaces(row.id)).map((w) => ({ id: w.workspace.id, name: w.workspace.name, role: w.role }));
    // The membership is the source of truth for the role, so a change shows here at once.
    const current = workspaces.find((w) => w.id === req.session.workspaceId);
    if (!current) {
      req.session.destroy(() => res.json({ authenticated: false, isAdmin: false }));
      return;
    }
    req.session.role = current.role;
  }
  const role = req.session.memberId ? req.session.role : (req.session.role ?? "owner");
  res.json({
    authenticated: true,
    isAdmin: req.session.isAdmin === true,
    member,
    workspace: workspace ? { id: workspace.id, name: workspace.name, kind: workspace.kind } : null,
    role: role ?? null,
    roleLabel: role && isRole(role) ? ROLES[role].label : null,
    permissions: permissionsOf(role),
    mfa: {
      required: workspace?.requireMfa === true,
      // A member of a workspace that requires two-factor must turn it on before anything else.
      enrollmentRequired: workspace?.requireMfa === true && !!member && !member.mfaEnabled,
    },
    workspaces,
  });
});

/** POST /api/auth/switch-workspace { workspaceId }: a member moves to another workspace they belong to. */
router.post("/auth/switch-workspace", async (req, res): Promise<void> => {
  if (req.session.authenticated !== true || !req.session.memberId) {
    res.status(401).json({ error: "Sign in with your own account to switch workspaces." });
    return;
  }
  const access = await membershipOf(req.session.memberId, String(req.body?.workspaceId ?? ""));
  if (!access) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.session.memberId)).limit(1);
  if (!member || member.status !== "active") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await signInMember(req, res, member, access);
});

async function openInvite(token: unknown) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const [row] = await db
    .select({ invite: invitesTable, workspace: workspacesTable })
    .from(invitesTable)
    .innerJoin(workspacesTable, eq(invitesTable.workspaceId, workspacesTable.id))
    .where(and(eq(invitesTable.tokenHash, hashToken(token)), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt)))
    .limit(1);
  if (!row || row.invite.expiresAt.getTime() < Date.now() || !isRole(row.invite.role)) return null;
  return row;
}

/** GET /api/auth/invites/:token: what an invitation is for (public; the token is the secret). */
router.get("/auth/invites/:token", inviteLimiter, async (req, res): Promise<void> => {
  const row = await openInvite(req.params.token);
  if (!row) {
    res.status(404).json({ error: "This invitation is not valid. It may have expired, been used or been withdrawn." });
    return;
  }
  const [existing] = await db.select({ id: membersTable.id, totpEnabledAt: membersTable.totpEnabledAt }).from(membersTable).where(eq(membersTable.email, row.invite.email)).limit(1);
  res.json({
    workspace: { name: row.workspace.name },
    email: row.invite.email,
    role: row.invite.role,
    roleLabel: ROLES[row.invite.role as keyof typeof ROLES].label,
    expiresAt: row.invite.expiresAt,
    hasAccount: Boolean(existing),
    /** An existing account with two-factor on also confirms with a code. */
    needsCode: Boolean(existing?.totpEnabledAt),
  });
});

/**
 * POST /api/auth/invites/:token/accept
 * New person: { name, password }. Existing account with the invited email: { password } to confirm it is
 * theirs, plus { code } (authenticator or recovery code) when two-factor is on, so an invitation is never a
 * way around it.
 * Joins the workspace and signs in to it.
 */
router.post("/auth/invites/:token/accept", inviteLimiter, async (req, res): Promise<void> => {
  const row = await openInvite(req.params.token);
  if (!row) {
    res.status(404).json({ error: "This invitation is not valid. It may have expired, been used or been withdrawn." });
    return;
  }
  const { name, password, code } = req.body ?? {};
  let [member] = await db.select().from(membersTable).where(eq(membersTable.email, row.invite.email)).limit(1);
  if (member) {
    if (typeof password !== "string" || !(await verifyPassword(password, member.passwordHash)) || member.status !== "active") {
      res.status(401).json({ error: "Enter the password of your existing account for this email." });
      return;
    }
    if (member.totpEnabledAt && member.totpSecret && !(await consumeSecondFactor(member, code))) {
      res.status(401).json({ error: "Enter the current code from your authenticator app, or a recovery code.", code: "mfa_required" });
      return;
    }
  } else {
    const displayName = typeof name === "string" ? name.trim().slice(0, 120) : "";
    if (!displayName) {
      res.status(400).json({ error: "Enter your name." });
      return;
    }
    const problem = passwordProblem(password, row.invite.email);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    [member] = await db.insert(membersTable).values({ id: randomUUID(), email: row.invite.email, name: displayName, passwordHash: await hashPassword(password as string) }).returning();
  }
  // Single use: only the first acceptance marks the invitation.
  const claimed = await db
    .update(invitesTable)
    .set({ acceptedAt: new Date() })
    .where(and(eq(invitesTable.id, row.invite.id), isNull(invitesTable.acceptedAt), isNull(invitesTable.revokedAt)))
    .returning({ id: invitesTable.id });
  if (claimed.length === 0) {
    res.status(409).json({ error: "This invitation was just used." });
    return;
  }
  await db.insert(membershipsTable).values({ id: randomUUID(), memberId: member.id, workspaceId: row.workspace.id, role: row.invite.role }).onConflictDoNothing();
  const access = await membershipOf(member.id, row.workspace.id);
  await logActivity("member_joined", `${member.name} joined ${row.workspace.name} as ${row.invite.role}`, { userId: row.workspace.principalUserId, actorName: member.name }).catch(() => {});
  await signInMember(req, res, member, access!, 201, "invite");
});

/** POST /api/auth/password { currentPassword, newPassword }: a member changes their password. */
router.post("/auth/password", loginLimiter, async (req, res): Promise<void> => {
  if (req.session.authenticated !== true || !req.session.memberId) {
    res.status(401).json({ error: "Sign in with your own account to change its password." });
    return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.session.memberId)).limit(1);
  const { currentPassword, newPassword } = req.body ?? {};
  if (!member || typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, member.passwordHash))) {
    res.status(401).json({ error: "Your current password is not correct." });
    return;
  }
  const problem = passwordProblem(newPassword, member.email);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  await db.update(membersTable).set({ passwordHash: await hashPassword(newPassword) }).where(eq(membersTable.id, member.id));
  // A new password ends every other sign-in of this person.
  const ended = await revokeMemberSessions(member.id, { keep: req.session.memberSessionId });
  await logActivity("member_password_changed", `${member.name} changed their password${ended ? ` and ${ended} other sign-in${ended === 1 ? "" : "s"} ended` : ""}`, { userId: req.session.userId, actorName: member.name }).catch(() => {});
  res.json({ ok: true, otherSessionsEnded: ended });
});

export default router;
