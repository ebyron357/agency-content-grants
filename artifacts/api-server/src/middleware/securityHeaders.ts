import type { Express, RequestHandler } from "express";

/**
 * Baseline HTTP security headers for every response (API, static assets and
 * the SPA shell).
 *
 * The CSP is deliberately limited to directives that cannot break the SPA:
 * it forbids framing this app, plugin content, <base> hijacking and
 * cross-origin form posts. It does not restrict script/style/img/frame
 * sources: the editor renders user-supplied https images and YouTube/Vimeo
 * iframes, and the UI loads Google Fonts and inline styles. A full source
 * allowlist needs browser verification first (see docs/PROJECT_STATUS.md).
 *
 * Referrer-Policy keeps the origin on cross-origin requests because YouTube
 * embeds require a referrer; `no-referrer` would break them.
 */
export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

// One year; no `preload`, which is a separate, hard-to-reverse owner decision.
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export function securityHeaders(options: { hsts: boolean }): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    // HSTS only behind TLS (Render terminates TLS in production); sending it
    // from a plain-http local server would pin localhost to https.
    if (options.hsts) {
      res.setHeader("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
    }
    next();
  };
}

export function applySecurityHeaders(
  app: Express,
  env: NodeJS.ProcessEnv = process.env,
): void {
  app.disable("x-powered-by");
  app.use(securityHeaders({ hsts: env.NODE_ENV === "production" }));
}
