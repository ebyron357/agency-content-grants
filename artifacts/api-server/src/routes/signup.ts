import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, membersTable, membershipsTable, pendingSignupsTable, usersTable, workspacesTable } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { PgRateLimitStore } from "../lib/pgRateLimitStore";
import { hashPassword } from "../lib/password";
import { billingEnabled } from "../lib/billing/config";
import { startTrial } from "../lib/billing/service";
import { emailTransport } from "../lib/email/transport";
import { SIGNUP_TOKEN_TTL_HOURS, existingAccountEmail, signInLink, signupConfig, verificationEmail, verifyLink } from "../lib/signup/config";
import { hashToken, membershipOf, normalizeEmail, passwordProblem } from "../lib/workspaces";
import { signInMember } from "./auth";

/**
 * Self sign-up (docs/SELF_SIGNUP.md). Public routes, mounted before requireAuth.
 *
 * Off unless SELF_SIGNUP_ENABLED=true, an email provider and APP_BASE_URL are
 * set (lib/signup/config.ts); while off every route here except the status is
 * a 404 and nothing is written.
 *
 * 1. POST /auth/signup stores a pending sign-up and emails a link. Its answer
 *    is the same whether or not the email already has an account (that person
 *    gets a "you already have an account" email instead), so the form cannot
 *    be used to find out who has an account.
 * 2. POST /auth/signup/verify { token } turns the pending sign-up into a
 *    member, a new client workspace with that member as its owner, and a
 *    signed-in session. With billing on, the workspace starts the free trial.
 */
const router: IRouter = Router();

const HOUR = 60 * 60 * 1000;
const tooMany = { error: "Too many sign-up attempts. Try again in an hour." };

/** Every sign-up request counts, from one address: 10 an hour. */
const signupIpLimiter = rateLimit({
  windowMs: HOUR,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: tooMany,
  store: new PgRateLimitStore("signup-ip"),
});

/** And for one email address, from anywhere: 3 an hour. Counted whether or not the address has an account, so the limit reveals nothing. */
const emailKey = (req: Request) => createHash("sha256").update(normalizeEmail(req.body?.email) ?? "invalid").digest("hex");
const signupEmailLimiter = rateLimit({
  windowMs: HOUR,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: emailKey,
  message: tooMany,
  store: new PgRateLimitStore("signup-email"),
});

/** Wrong or used verification tokens: 20 per 15 minutes per address. */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many attempts. Try again in 15 minutes." },
  store: new PgRateLimitStore("signup-verify"),
});

/** While sign-up is off, its routes do not exist. */
function signupOn(_req: Request, res: Response, next: NextFunction): void {
  if (signupConfig().enabled) return next();
  res.status(404).json({ error: "Sign-up is not available. Ask the person who runs this workspace for an invitation." });
}

/** The same answer for a new address, an existing account, and the honeypot. */
const ACCEPTED = {
  status: "check_email",
  message: `If this email can be used, we sent a link to it. Open it within ${SIGNUP_TOKEN_TTL_HOURS} hours to finish creating your workspace.`,
};

/** GET /auth/signup/status: whether the sign-in page should offer sign-up. Never says why it is off. */
router.get("/auth/signup/status", (_req, res): void => {
  res.json({ enabled: signupConfig().enabled });
});

/** POST /auth/signup { name, organizationName, email, password }. */
router.post("/auth/signup", signupOn, signupIpLimiter, signupEmailLimiter, async (req, res): Promise<void> => {
  const body = req.body ?? {};
  // A field people cannot see. Bots fill it; the answer looks like success and nothing happens.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    res.status(202).json(ACCEPTED);
    return;
  }
  const email = normalizeEmail(body.email);
  if (!email) return void res.status(400).json({ error: "Enter a valid email address." });
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return void res.status(400).json({ error: "Enter your name." });
  const organizationName = typeof body.organizationName === "string" ? body.organizationName.trim().slice(0, 120) : "";
  if (!organizationName) return void res.status(400).json({ error: "Enter your organization's name." });
  const problem = passwordProblem(body.password, email);
  if (problem) return void res.status(400).json({ error: problem });

  const transport = emailTransport();
  if (!transport) {
    // Config changed between the check and now; the same safe answer as off.
    return void res.status(404).json({ error: "Sign-up is not available." });
  }

  const [existing] = await db.select({ id: membersTable.id }).from(membersTable).where(eq(membersTable.email, email)).limit(1);
  // Both paths hash a password and send one email, so they take about as long.
  const passwordHash = await hashPassword(body.password as string);
  try {
    if (existing) {
      const message = existingAccountEmail(signInLink());
      await transport.send({ to: email, tag: "signup_existing_account", ...message });
    } else {
      // Old and expired rows go; an earlier pending sign-up for this email is replaced by this one.
      await db.delete(pendingSignupsTable).where(or(eq(pendingSignupsTable.email, email), lt(pendingSignupsTable.expiresAt, new Date(Date.now() - 7 * 24 * HOUR))));
      const token = randomBytes(32).toString("base64url");
      await db.insert(pendingSignupsTable).values({
        id: randomUUID(),
        email,
        name,
        organizationName,
        passwordHash,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SIGNUP_TOKEN_TTL_HOURS * HOUR),
      });
      const message = verificationEmail(name, organizationName, verifyLink(token));
      await transport.send({ to: email, tag: "signup_verify", ...message });
    }
  } catch (err) {
    // Never echo the provider's answer; it can contain the address.
    logger.error({ err: (err as Error).message }, "Sign-up email could not be sent");
    res.status(503).json({ error: "We could not send the email just now. Try again in a few minutes." });
    return;
  }
  res.status(202).json(ACCEPTED);
});

class SignupConflict extends Error {}

/** POST /auth/signup/verify { token }: creates the account and the workspace, and signs in. */
router.post("/auth/signup/verify", signupOn, verifyLimiter, async (req, res): Promise<void> => {
  const token = req.body?.token;
  const invalid = () => res.status(404).json({ error: "This link is not valid. It may have expired or been used. Sign up again to get a new one.", code: "signup_link_invalid" });
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return void invalid();
  const config = signupConfig();
  let created: { member: { id: string; name: string; email: string }; workspace: typeof workspacesTable.$inferSelect } | null = null;
  try {
    created = await db.transaction(async (tx) => {
      // Single use: only the first request claims the row.
      const [pending] = await tx
        .update(pendingSignupsTable)
        .set({ consumedAt: new Date() })
        .where(and(eq(pendingSignupsTable.tokenHash, hashToken(token)), isNull(pendingSignupsTable.consumedAt), gt(pendingSignupsTable.expiresAt, new Date())))
        .returning();
      if (!pending) return null;
      const [taken] = await tx.select({ id: membersTable.id }).from(membersTable).where(eq(membersTable.email, pending.email)).limit(1);
      if (taken) throw new SignupConflict();
      const principalId = randomUUID();
      await tx.insert(usersTable).values({ id: principalId, username: `workspace-${principalId}`, passwordHash: "workspace-principal" });
      const [workspace] = await tx.insert(workspacesTable).values({ id: randomUUID(), name: pending.organizationName, principalUserId: principalId, kind: "client", createdVia: "self_signup" }).returning();
      const [member] = await tx.insert(membersTable).values({ id: randomUUID(), email: pending.email, name: pending.name, passwordHash: pending.passwordHash }).returning();
      await tx.insert(membershipsTable).values({ id: randomUUID(), memberId: member.id, workspaceId: workspace.id, role: "owner" });
      return { member, workspace };
    });
  } catch (err) {
    if (err instanceof SignupConflict) {
      res.status(409).json({ error: "An account with this email already exists. Sign in instead.", code: "account_exists" });
      return;
    }
    throw err;
  }
  if (!created) return void invalid();
  const { member, workspace } = created;
  await logActivity("workspace_created", `Workspace "${workspace.name}" created by self sign-up`, { userId: workspace.principalUserId, actorName: member.name }).catch(() => {});
  await logActivity("member_joined", `${member.name} joined ${workspace.name} as owner (self sign-up, email confirmed)`, { userId: workspace.principalUserId, actorName: member.name }).catch(() => {});
  // With billing on, a new workspace starts the free trial; with it off there are no limits to start.
  if (billingEnabled()) {
    try {
      const sub = await startTrial(workspace.id, config.trialPlan);
      await logActivity("billing_trial_started", `Free trial of ${sub.planKey} started at sign-up`, { userId: workspace.principalUserId, actorName: member.name }).catch(() => {});
    } catch (err) {
      // The workspace exists either way; its owner can start a trial in Settings, Billing.
      logger.warn({ err: (err as Error).message, plan: config.trialPlan }, "Sign-up trial could not start");
    }
  }
  const access = await membershipOf(member.id, workspace.id);
  await db.update(membersTable).set({ lastSignInAt: new Date() }).where(eq(membersTable.id, member.id));
  await signInMember(req, res, member, access!, 201, "signup");
});

export default router;
