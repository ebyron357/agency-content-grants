/**
 * Whether self sign-up is on (docs/SELF_SIGNUP.md).
 *
 * Off unless SELF_SIGNUP_ENABLED is exactly "true" (or SELF_SERVE_SIGNUP is
 * exactly "on", the name the first landing-page release used; either one works).
 * Even then it is on only
 * when the verification email can be sent (an email provider) and its link can
 * be built (APP_BASE_URL). With any of these missing the sign-up routes answer
 * 404 and the sign-in page shows no sign-up link: nothing changes.
 *
 * Pure module: no database import.
 */
import { emailConfig, emailTransportOverridden } from "../email/transport";

export interface SignupConfig {
  /** The owner's switch. */
  flag: boolean;
  enabled: boolean;
  /** Names (never values) of settings still needed while the switch is on. */
  missing: string[];
  problem: string | null;
  /** The plan a new workspace's trial uses when billing is on. */
  trialPlan: string;
}

export const DEFAULT_TRIAL_PLAN = "starter";
/** How long a verification link works. */
export const SIGNUP_TOKEN_TTL_HOURS = 24;

/** The owner's switch: SELF_SIGNUP_ENABLED=true, or its alias SELF_SERVE_SIGNUP=on. */
export function signupFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SELF_SIGNUP_ENABLED === "true" || env.SELF_SERVE_SIGNUP === "on";
}

export function signupConfig(env: NodeJS.ProcessEnv = process.env): SignupConfig {
  const flag = signupFlag(env);
  const trialPlan = env.SELF_SIGNUP_TRIAL_PLAN?.trim() || DEFAULT_TRIAL_PLAN;
  if (!flag) return { flag, enabled: false, missing: [], problem: null, trialPlan };
  const missing: string[] = [];
  const email = emailConfig(env);
  // Tests install a capturing transport; it counts as configured.
  const emailReady = email.ready || emailTransportOverridden();
  if (!emailReady) missing.push(...email.missing);
  if (!env.APP_BASE_URL?.trim()) missing.push("APP_BASE_URL");
  const problem = emailReady ? null : email.problem;
  return { flag, enabled: missing.length === 0 && !problem, missing, problem, trialPlan };
}

/** The verification link. The token is in the fragment, so it never reaches a server log. */
export function verifyLink(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}/signup/verify#token=${token}`;
}

/** The sign-in screen. While sign-up is open "/" is the public landing page, so the link names /login. */
export function signInLink(env: NodeJS.ProcessEnv = process.env): string {
  return `${(env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "")}/login`;
}

export function verificationEmail(name: string, organization: string, link: string) {
  return {
    subject: "Confirm your email to finish creating your GrantCrest workspace",
    text: [
      `Hello ${name},`,
      "",
      `Someone (we hope you) asked to create a GrantCrest workspace for ${organization} with this email address.`,
      "",
      `Open this link to confirm your email and finish. It works once and expires in ${SIGNUP_TOKEN_TTL_HOURS} hours:`,
      link,
      "",
      "If you did not ask for this, ignore this email. No account is created until the link is opened.",
    ].join("\n"),
  };
}

export function existingAccountEmail(link: string) {
  return {
    subject: "Someone tried to create a GrantCrest account with your email",
    text: [
      "Hello,",
      "",
      "Someone asked to create a new GrantCrest workspace with this email address, but you already have an account.",
      "",
      `Sign in here: ${link}`,
      "",
      "If this was not you, you can ignore this email. Your account has not changed.",
    ].join("\n"),
  };
}
