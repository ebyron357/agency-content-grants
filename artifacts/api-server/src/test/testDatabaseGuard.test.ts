import { afterEach, describe, expect, it } from "vitest";
import { assertDisposableTestDatabase } from "@workspace/db/test-database-guard";

const originalNodeEnv = process.env.NODE_ENV;
const originalResetFlag = process.env.ALLOW_TEST_DATABASE_RESET;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.ALLOW_TEST_DATABASE_RESET = originalResetFlag;
});

describe("assertDisposableTestDatabase", () => {
  it("accepts an explicitly enabled local PostgreSQL test database", () => {
    process.env.NODE_ENV = "test";
    process.env.ALLOW_TEST_DATABASE_RESET = "true";

    const parsed = assertDisposableTestDatabase(
      "postgresql://test:test@localhost:5432/content_machine_test",
    );

    expect(parsed.hostname).toBe("localhost");
    expect(parsed.pathname).toBe("/content_machine_test");
  });

  it("refuses to operate outside the test environment", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_TEST_DATABASE_RESET = "true";

    expect(() =>
      assertDisposableTestDatabase(
        "postgresql://test:test@localhost:5432/content_machine_test",
      ),
    ).toThrow("NODE_ENV=test");
  });

  it("requires an explicit destructive-reset opt-in", () => {
    process.env.NODE_ENV = "test";
    process.env.ALLOW_TEST_DATABASE_RESET = "false";

    expect(() =>
      assertDisposableTestDatabase(
        "postgresql://test:test@localhost:5432/content_machine_test",
      ),
    ).toThrow("ALLOW_TEST_DATABASE_RESET=true");
  });

  it("refuses non-local database hosts", () => {
    process.env.NODE_ENV = "test";
    process.env.ALLOW_TEST_DATABASE_RESET = "true";

    expect(() =>
      assertDisposableTestDatabase(
        "postgresql://test:test@production.example.com:5432/content_machine_test",
      ),
    ).toThrow("Refusing non-local test database host");
  });

  it("requires a database name ending in _test", () => {
    process.env.NODE_ENV = "test";
    process.env.ALLOW_TEST_DATABASE_RESET = "true";

    expect(() =>
      assertDisposableTestDatabase(
        "postgresql://test:test@localhost:5432/content_machine",
      ),
    ).toThrow("Refusing database without _test suffix");
  });
});
