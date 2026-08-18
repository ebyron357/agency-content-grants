/**
 * vitest.unit.config.ts
 *
 * Unit-test configuration for pure, self-contained tests that do not require
 * a running database or any external services. Run via `pnpm run test:unit`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/video-validator.test.ts", "src/__tests__/exporter-html-content.test.ts", "src/__tests__/image-validator.test.ts"],
  },
});
