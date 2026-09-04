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
