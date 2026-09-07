import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertApiTestEnv } from "./assert-api-test-env.mjs";

assertApiTestEnv();

const extraArgs = process.argv.slice(2);
if (extraArgs.length > 0) {
  console.error(
    "The canonical API test command runs the full suite through vitest.config.ts.",
  );
  console.error(
    "Passing individual test files skips that contract and is rejected.",
  );
  console.error("For hermetic unit tests without Postgres:");
  console.error("  pnpm --filter @workspace/api-server test:unit -- <file>");
  process.exit(1);
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.config.ts"],
  {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
