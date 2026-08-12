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

// Trust Replit's reverse proxy so secure cookies and rate-limiting work correctly
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

const allowedOrigins = new Set<string>([
  // Replit dev domain (e.g. https://abc123.id.repl.co or the workspace preview)
  ...(process.env.REPLIT_DEV_DOMAIN
    ? [`https://${process.env.REPLIT_DEV_DOMAIN}`]
    : []),
  // Replit production domains (comma-separated list injected by the platform)
  ...(process.env.REPLIT_DOMAINS
    ? process.env.REPLIT_DOMAINS.split(",").map((d) => `https://${d.trim()}`)
    : []),
  // Local development
  "http://localhost",
  "http://localhost:3000",
  "http://127.0.0.1",
]);

// CORS: allow credentials so session cookies are sent cross-origin (dev + prod).
// Reflect the request origin only when it matches a known Replit/local origin;
// auth is still session-based, but this narrows which origins can read
// credentialed responses at all.
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

export default app;
