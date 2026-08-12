import { Router, type IRouter } from "express";
import { timingSafeEqual, createHash } from "crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logActivity } from "../lib/activity";
import { PgRateLimitStore } from "../lib/pgRateLimitStore";
import { ensureAdminUser } from "../lib/adoptData";

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

/**
 * POST /api/auth/login
 * Accepts { password } and compares against ADMIN_PASSWORD env var.
 * Sets session.authenticated and session.userId on success.
 */
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { password } = req.body ?? {};

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

  req.session.authenticated = true;
  req.session.userId = adminId;

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
 * POST /api/auth/logout
 * Destroys the current session.
 */
router.post("/auth/logout", (req, res) => {
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
    logActivity("admin_unlocked", "Admin access unlocked", { userId: req.session.userId })
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
 * Returns { authenticated: true/false } for the current session.
 */
router.get("/auth/me", (req, res) => {
  res.json({ authenticated: req.session.authenticated === true });
});

export default router;
