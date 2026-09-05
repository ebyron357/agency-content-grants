/**
 * Fail-fast guard for the API test lane.
 *
 * `@workspace/db` throws at import when DATABASE_URL is unset. ESM imports are
 * hoisted, so calling this from a TypeScript test file is too late. The
 * canonical runners invoke this module *before* Vitest or prepareDatabase load
 * the database package.
 */
export function assertApiTestEnv() {
  const problems = [];

  if (process.env.NODE_ENV !== "test") {
    problems.push('NODE_ENV must be exactly "test"');
  }
  if (process.env.ALLOW_TEST_DATABASE_RESET !== "true") {
    problems.push('ALLOW_TEST_DATABASE_RESET must be "true"');
  }
  if (!process.env.DATABASE_URL?.trim()) {
    problems.push(
      "DATABASE_URL must point at a disposable PostgreSQL database whose name ends in _test",
    );
  } else {
    // Mirror the reset guard without importing the database package. Never
    // print URL values or parser errors: they can contain credentials.
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
        problems.push("DATABASE_URL must use PostgreSQL");
      }
      if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname)) {
        problems.push("DATABASE_URL must use a local test host");
      }
      if (!parsed.pathname.slice(1).endsWith("_test")) {
        problems.push("DATABASE_URL database name must end in _test");
      }
    } catch {
      problems.push("DATABASE_URL must be a valid PostgreSQL URL");
    }
  }

  if (problems.length === 0) {
    return;
  }

  console.error(
    "API database tests were invoked without the disposable test-database contract:",
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error("");
  console.error(
    "Do not invoke individual Vitest files from the repository root.",
  );
  console.error(
    "Use the package scripts so the Vitest config and global setup run:",
  );
  console.error("  pnpm --filter @workspace/api-server test:unit");
  console.error("  pnpm --filter @workspace/api-server test:db:prepare");
  console.error("  pnpm --filter @workspace/api-server test");
  process.exit(1);
}
