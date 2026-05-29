import test from "node:test";
import assert from "node:assert/strict";

test("readInitialWorkspaceRoot prefers WEBAGENT_WORKSPACE_ROOT and normalizes relative cwd", async () => {
  const prev = process.env.WEBAGENT_WORKSPACE_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = "/workspace/test-profile";
  try {
    const mod = await import(`../dist/agent-runtime/constants.js?v=${Date.now()}`);
    assert.equal(mod.getWorkspaceRoot(), "/workspace/test-profile");
    assert.equal(mod.getSkillsDir(), "/workspace/test-profile/.webagent/skills");
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = prev;
  }
});
