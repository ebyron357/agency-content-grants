const ALLOWED_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

export function assertDisposableTestDatabase(
  databaseUrl = process.env.DATABASE_URL,
): URL {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Refusing test database operation unless NODE_ENV=test");
  }
  if (process.env.ALLOW_TEST_DATABASE_RESET !== "true") {
    throw new Error(
      "Refusing test database operation unless ALLOW_TEST_DATABASE_RESET=true",
    );
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for disposable database tests");
  }

  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Test database must use PostgreSQL");
  }
  if (!ALLOWED_TEST_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing non-local test database host: ${parsed.hostname}`,
    );
  }

  const databaseName = parsed.pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing database without _test suffix: ${databaseName}`);
  }

  return parsed;
}
