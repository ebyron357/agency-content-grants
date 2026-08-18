import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { router } from "./routes";
import { logger } from "./lib/logger";
import { seedDatabase } from "./lib/seed";
import { requireAdmin } from "./middleware/requireAdmin";
import { pool } from "@workspace/db";

const PgStore = connectPgSimple(session);

const app: Express = express();

// Trust reverse proxy (Render, nginx, etc.) for secure cookies and rate-limiting
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Build allowed CORS origins from environment configuration.
// ALLOWED_ORIGINS is a comma-separated list of allowed origins (platform-neutral).
// Replit env vars are supported as a fallback for backward compatibility.
const allowedOrigins = new Set<string>([
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : []),
  ...(process.env.REPLIT_DEV_DOMAIN
    ? [`https://${process.env.REPLIT_DEV_DOMAIN}`]
    : []),
  ...(process.env.REPLIT_DOMAINS
    ? process.env.REPLIT_DOMAINS.split(",").map((d) => `https://${d.trim()}`)
    : []),
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

// CORS: In same-origin mode (frontend served by Express) no cross-origin
// requests are made, so CORS headers are largely unused. For split-origin
// dev setups (Vite dev server on :5173), reflect known origins.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "session",
      createTableIfMissing: true, // creates the session table on first run (fresh deployment safe)
      pruneSessionInterval: 60 * 15, // prune expired sessions every 15 minutes (seconds)
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "sid",
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

app.use("/api", router);

// Seed endpoint (initial setup only). Requires an authenticated, admin-unlocked
// session — seeding writes global reference data and must never be anonymous.
app.post("/api/seed", requireAdmin, async (_req, res) => {
  try {
    const result = await seedDatabase();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Seed failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Same-origin frontend serving ─────────────────────────────────────────────
// In production, serve the pre-built Vite frontend from the content-os dist
// directory. This enables same-origin API calls without CORS and keeps
// deployment simple (single process serves both API and UI).
const __dirname =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

// Resolve the content-os build output. In the esbuild dist bundle,
// the directory structure is: dist/index.mjs (this file) and the frontend
// build is at ../../content-os/dist/public relative to the api-server root,
// or provided via FRONTEND_DIST_PATH.
const frontendDistPath =
  process.env.FRONTEND_DIST_PATH ??
  path.resolve(__dirname, "..", "..", "content-os", "dist", "public");

// Serve static assets with caching (fingerprinted assets get long cache)
app.use(
  express.static(frontendDistPath, {
    maxAge: "1d",
    immutable: false,
    index: false, // We handle index.html via the SPA fallback below
  }),
);

// SPA fallback: any non-API GET request that doesn't match a static file
// gets the index.html so client-side routing (wouter) can handle it.
app.get("/{*splat}", (req, res, next) => {
  // Don't serve index.html for API routes or non-GET methods
  if (req.path.startsWith("/api")) {
    return next();
  }
  const indexPath = path.join(frontendDistPath, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      // If index.html doesn't exist (e.g. frontend not built), fall through
      next();
    }
  });
});

export default app;
