import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertApiTestEnv } from "./assert-api-test-env.mjs";

assertApiTestEnv();

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "tsx", "src/test/prepareDatabase.ts"],
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
