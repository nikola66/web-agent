#!/usr/bin/env node
/**
 * Run automated tool contract + smoke tests.
 *
 *   npm run test:tools
 *   npm run test:tools -- --network   # also run proxy-backed tools (needs dev server / browser adapter)
 */

import { spawnSync } from "node:child_process";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const network = process.argv.includes("--network");

const env = {
  ...process.env,
  ...(network ? { WEBAGENT_TOOL_SMOKE_NETWORK: "1" } : {}),
};

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "build:embed-runtime"]);
run("npx", [
  "tsx",
  "--test",
  "tests/tool-smoke-matrix.test.ts",
  "tests/tool-coverage-execution.test.ts",
  "tests/bundled-skills-coverage.test.ts",
  "tests/skills-system.test.ts",
  "tests/tool-result-preview.test.ts",
  "tests/tool-registry-catalog.test.ts",
  "tests/tool-registry-validation.test.ts",
  "tests/snapshot-read-unwrap.test.ts",
]);
