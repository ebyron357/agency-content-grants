import { defineConfig } from "vitest/config";

/**
 * Hermetic API unit tests. These files do not import `@workspace/db` at
 * runtime (or they mock it before load), so they can run without DATABASE_URL.
 * The full suite in vitest.config.ts still requires the disposable test database.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/__tests__/admin-access.test.ts",
      "src/__tests__/auth.test.ts",
      "src/__tests__/ownership.test.ts",
      "src/__tests__/patch-hardening.test.ts",
      "src/lib/ai/demo.test.ts",
      "src/lib/repurposing.test.ts",
      "src/lib/webhooks/signing.test.ts",
      "src/lib/webhooks/urlSafety.test.ts",
      "src/test/testDatabaseGuard.test.ts",
    ],
  },
});
