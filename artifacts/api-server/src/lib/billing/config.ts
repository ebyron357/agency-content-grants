/**
 * Whether billing is switched on (docs/BILLING.md).
 *
 * Billing is ON only when every required setting is present and BILLING_DISABLED
 * is not "true". With any of them missing it is OFF and the product behaves
 * exactly as it did before billing existed: no plan limits, no Stripe calls.
 * Values are read at call time and never logged or returned; only the names of
 * missing settings are reported, to the owner.
 *
 * Pure module: no database import.
 */

export const REQUIRED_BILLING_ENV = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "APP_BASE_URL"] as const;

export interface BillingConfig {
  enabled: boolean;
  /** Names (never values) of required settings that are not set. */
  missing: string[];
  /** BILLING_DISABLED=true turns billing off even with keys present. */
  forcedOff: boolean;
  /** "test" for sk_test_ keys, "live" for sk_live_ keys, null otherwise. */
  mode: "test" | "live" | null;
}

export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const missing = REQUIRED_BILLING_ENV.filter((name) => !env[name]?.trim());
  const forcedOff = env.BILLING_DISABLED === "true";
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const mode = key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" : key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : null;
  return { enabled: missing.length === 0 && !forcedOff, missing: [...missing], forcedOff, mode };
}

export function billingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return billingConfig(env).enabled;
}

/** Where Stripe sends people back to. APP_BASE_URL is the app's public origin, e.g. https://app.example.org. */
export function returnUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
