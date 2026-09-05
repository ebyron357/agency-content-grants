import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const moduleUrl = new URL("./assert-api-test-env.mjs", import.meta.url).href;
const safeUrl =
  "postgresql://test:private-sentinel@localhost:5432/content_test";
function check(overrides = {}) {
  // These subprocesses import only the preflight guard, never a DB client.
  const env = {
    NODE_ENV: "test",
    ALLOW_TEST_DATABASE_RESET: "true",
    DATABASE_URL: safeUrl,
    ...overrides,
  };
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { assertApiTestEnv } from ${JSON.stringify(moduleUrl)}; assertApiTestEnv();`,
    ],
    { env, encoding: "utf8" },
  );
}

for (const protocol of ["postgres", "postgresql"]) {
  for (const host of ["localhost", "127.0.0.1", "postgres"]) {
    test(`accepts ${protocol} on ${host}`, () => {
      assert.equal(
        check({
          DATABASE_URL: `${protocol}://test:private-sentinel@${host}:5432/content_test`,
        }).status,
        0,
      );
    });
  }
}

const rejected = [
  ["missing URL", { DATABASE_URL: "" }, "DATABASE_URL must point"],
  ["blank URL", { DATABASE_URL: "  " }, "DATABASE_URL must point"],
  [
    "malformed URL",
    { DATABASE_URL: "private-sentinel-not-a-url" },
    "valid PostgreSQL URL",
  ],
  [
    "wrong protocol",
    { DATABASE_URL: "https://test:private-sentinel@localhost/content_test" },
    "must use PostgreSQL",
  ],
  [
    "remote host",
    {
      DATABASE_URL:
        "postgresql://test:private-sentinel@production.example.com/content_test",
    },
    "local test host",
  ],
  [
    "host suffix spoof",
    {
      DATABASE_URL:
        "postgresql://test:private-sentinel@localhost.example.com/content_test",
    },
    "local test host",
  ],
  [
    "production database",
    { DATABASE_URL: "postgresql://test:private-sentinel@localhost/production" },
    "end in _test",
  ],
  [
    "empty database",
    { DATABASE_URL: "postgresql://test:private-sentinel@localhost/" },
    "end in _test",
  ],
  ["production environment", { NODE_ENV: "production" }, "NODE_ENV must be"],
  [
    "missing reset opt-in",
    { ALLOW_TEST_DATABASE_RESET: "" },
    "ALLOW_TEST_DATABASE_RESET must be",
  ],
  [
    "false reset opt-in",
    { ALLOW_TEST_DATABASE_RESET: "false" },
    "ALLOW_TEST_DATABASE_RESET must be",
  ],
];
for (const [label, overrides, message] of rejected) {
  test(`rejects ${label} without disclosing credentials`, () => {
    const result = check(overrides);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(message));
    assert.ok(!result.stderr.includes("private-sentinel"));
    assert.ok(!result.stdout.includes("private-sentinel"));
  });
}
