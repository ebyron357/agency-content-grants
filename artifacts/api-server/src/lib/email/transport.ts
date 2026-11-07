/**
 * Outgoing email, pluggable (docs/SELF_SIGNUP.md §3).
 *
 * The app had no email path before self sign-up. Email is chosen with
 * EMAIL_PROVIDER:
 *
 * - "resend": Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email),
 *   with RESEND_API_KEY and EMAIL_FROM. No SDK: one fetch call.
 * - "log": writes the message, link included, to the server log. Refused when
 *   NODE_ENV=production, because a log is not a private channel.
 * - unset: no email. Anything that needs email (self sign-up) stays off.
 *
 * Tests replace the transport with setEmailTransportForTests. Values are read
 * at call time and never logged; only the names of missing settings are.
 *
 * Pure module: no database import.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** What the message is for, for logs and tests: "signup_verify", "signup_existing_account". */
  tag: string;
}

export interface EmailTransport {
  name: string;
  send(message: EmailMessage): Promise<void>;
}

export interface EmailConfig {
  provider: "resend" | "log" | null;
  ready: boolean;
  /** Names (never values) of settings still needed. */
  missing: string[];
  /** Why the configured provider cannot be used, if it cannot. */
  problem: string | null;
}

export function emailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const raw = env.EMAIL_PROVIDER?.trim().toLowerCase() ?? "";
  if (!raw) return { provider: null, ready: false, missing: ["EMAIL_PROVIDER"], problem: null };
  if (raw === "resend") {
    const missing = ["RESEND_API_KEY", "EMAIL_FROM"].filter((name) => !env[name]?.trim());
    return { provider: "resend", ready: missing.length === 0, missing, problem: null };
  }
  if (raw === "log") {
    const production = env.NODE_ENV === "production";
    return { provider: "log", ready: !production, missing: [], problem: production ? "EMAIL_PROVIDER=log is not allowed in production; links would be written to the server log." : null };
  }
  return { provider: null, ready: false, missing: [], problem: `EMAIL_PROVIDER "${raw}" is not supported. Use "resend".` };
}

let override: EmailTransport | null = null;

/** Tests capture messages instead of sending them. Pass null to restore. */
export function setEmailTransportForTests(transport: EmailTransport | null): void {
  override = transport;
}

export function emailTransportOverridden(): boolean {
  return override !== null;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function resendTransport(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch as unknown as FetchLike): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY?.trim() ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM?.trim(), to: [message.to], subject: message.subject, text: message.text, tags: [{ name: "kind", value: message.tag }] }),
        signal: AbortSignal.timeout(10_000),
      });
      // The response body is not logged: it can echo the address.
      if (!res.ok) throw new Error(`Email provider returned HTTP ${res.status}`);
    },
  };
}

function logTransport(): EmailTransport {
  return {
    name: "log",
    async send(message) {
      // Development only (emailConfig refuses it in production).
      console.info(`[email:log] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    },
  };
}

/** The transport to use now, or null when email is not configured. */
export function emailTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport | null {
  if (override) return override;
  const config = emailConfig(env);
  if (!config.ready) return null;
  return config.provider === "resend" ? resendTransport(env) : logTransport();
}
