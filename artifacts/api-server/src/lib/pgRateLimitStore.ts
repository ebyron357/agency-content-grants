/**
 * Postgres-backed store for express-rate-limit.
 *
 * Persists hit counters in the `rate_limit` table (created by migration
 * 0007_add_rate_limit_table) so lockouts survive server restarts and are
 * shared across instances of an autoscale deployment.
 *
 * Each limiter gets its own `prefix` so counters never collide.
 */
import type { Store, Options, IncrementResponse } from "express-rate-limit";
import { pool } from "@workspace/db";

export class PgRateLimitStore implements Store {
  /** Keys are stored centrally in Postgres, not per-process. */
  readonly localKeys = false;

  private windowMs = 60_000;

  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    // Atomically bump the counter; if the previous window has expired,
    // start a fresh one instead.
    const { rows } = await pool.query<{ count: number; expires_at: Date }>(
      `INSERT INTO rate_limit (prefix, key, count, expires_at)
       VALUES ($1, $2, 1, now() + ($3 || ' milliseconds')::interval)
       ON CONFLICT (prefix, key) DO UPDATE SET
         count = CASE WHEN rate_limit.expires_at <= now()
                      THEN 1 ELSE rate_limit.count + 1 END,
         expires_at = CASE WHEN rate_limit.expires_at <= now()
                           THEN now() + ($3 || ' milliseconds')::interval
                           ELSE rate_limit.expires_at END
       RETURNING count, expires_at`,
      [this.prefix, key, String(this.windowMs)],
    );
    const row = rows[0]!;
    return { totalHits: Number(row.count), resetTime: new Date(row.expires_at) };
  }

  async decrement(key: string): Promise<void> {
    await pool.query(
      `UPDATE rate_limit SET count = GREATEST(count - 1, 0)
       WHERE prefix = $1 AND key = $2`,
      [this.prefix, key],
    );
  }

  async resetKey(key: string): Promise<void> {
    await pool.query(`DELETE FROM rate_limit WHERE prefix = $1 AND key = $2`, [
      this.prefix,
      key,
    ]);
  }

  async resetAll(): Promise<void> {
    await pool.query(`DELETE FROM rate_limit WHERE prefix = $1`, [this.prefix]);
  }
}
