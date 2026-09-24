import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { pool } from "@workspace/db";
import { getMediaRoot } from "./mediaStorage";
import { getSourceRoot } from "./sourceStorage";

export type ReadinessResult = {
  ready: boolean;
  checks: Record<string, "ok" | "failed">;
};

export function getExportRoot(): string {
  return resolve(
    process.env.EXPORT_DIR ?? join(process.cwd(), "data", "exports"),
  );
}

async function writable(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await access(directory, constants.W_OK);
  const probe = join(directory, `.readiness-${process.pid}-${Date.now()}`);
  await writeFile(probe, "ready", { flag: "wx" });
  await unlink(probe);
}

function hasCriticalConfiguration(): boolean {
  if (!process.env.SESSION_SECRET || !process.env.DATABASE_URL) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(
    process.env.ADMIN_PASSWORD &&
    (process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY),
  );
}

export async function checkReadiness(
  dependencies = {
    database: async () => {
      await pool.query("select 1");
      const result = await pool.query(
        "select count(*)::int as count from drizzle.__drizzle_migrations",
      );
      if (Number(result.rows[0]?.count ?? 0) < 1) {
        throw new Error("No applied migrations");
      }
    },
    storage: async () => {
      await Promise.all([
        writable(getMediaRoot()),
        writable(getSourceRoot()),
        writable(getExportRoot()),
      ]);
    },
    configuration: async () => {
      if (!hasCriticalConfiguration())
        throw new Error("Configuration incomplete");
    },
  },
): Promise<ReadinessResult> {
  const checks: ReadinessResult["checks"] = {};
  await Promise.all(
    Object.entries(dependencies).map(async ([name, check]) => {
      try {
        await check();
        checks[name] = "ok";
      } catch {
        checks[name] = "failed";
      }
    }),
  );
  return {
    ready: Object.values(checks).every((status) => status === "ok"),
    checks,
  };
}
