import assert from "node:assert/strict";
import test from "node:test";
import { workspaceBootstrapDirRels, WORKSPACE_TELEGRAM_INBOX_REL } from "../src/core/workspace-layout";

test("workspaceBootstrapDirRels includes standard vaults", () => {
  const dirs = workspaceBootstrapDirRels();
  assert.ok(dirs.includes("projects"));
  assert.ok(dirs.includes("work"));
  assert.ok(dirs.includes(WORKSPACE_TELEGRAM_INBOX_REL));
  assert.ok(dirs.includes(".webagent/skills"));
  assert.ok(dirs.includes("memory/runs"));
  assert.equal(new Set(dirs).size, dirs.length);
});

test("embed buildWorkspaceMapBlock documents skills vs capabilities", async () => {
  const { buildWorkspaceMapBlock } = await import("../dist/agent-runtime/workspace-map.js");
  const block = buildWorkspaceMapBlock();
  assert.match(block, /\.webagent\/skills\/<category>/);
  assert.match(block, /\.webagent\/capabilities\/skills/);
  assert.match(block, /do NOT install/i);
  assert.match(block, /write_file.*`path`.*`content`/i);
});
