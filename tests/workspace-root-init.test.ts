import test from "node:test";
import assert from "node:assert/strict";

test("readInitialWorkspaceRoot prefers WEBAGENT_WORKSPACE_ROOT outside nodebox", async () => {
  const prev = {
    runtime: process.env.WEBAGENT_RUNTIME,
    workspace: process.env.WEBAGENT_WORKSPACE_ROOT,
  };
  delete process.env.WEBAGENT_RUNTIME;
  process.env.WEBAGENT_WORKSPACE_ROOT = "/workspace/test-profile";
  try {
    const mod = await import(`../dist/agent-runtime/constants.js?v=${Date.now()}`);
    assert.equal(mod.getWorkspaceRoot(), "/workspace/test-profile");
    assert.equal(mod.getSkillsDir(), "/workspace/test-profile/.webagent/skills");
  } finally {
    if (prev.runtime === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prev.runtime;
    if (prev.workspace === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = prev.workspace;
  }
});

test("readInitialWorkspaceRoot prefers nodebox cwd over logical WEBAGENT_WORKSPACE_ROOT", async () => {
  const prev = {
    runtime: process.env.WEBAGENT_RUNTIME,
    workspace: process.env.WEBAGENT_WORKSPACE_ROOT,
  };
  process.env.WEBAGENT_RUNTIME = "nodebox";
  process.env.WEBAGENT_WORKSPACE_ROOT = "/workspace/test-profile";
  try {
    const mod = await import(`../dist/agent-runtime/constants.js?v=${Date.now()}`);
    assert.equal(mod.getWorkspaceRoot(), process.cwd().replace(/\\/g, "/").replace(/\/+$/, "") || "/");
    assert.notEqual(mod.getWorkspaceRoot(), "/workspace/test-profile");
  } finally {
    if (prev.runtime === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prev.runtime;
    if (prev.workspace === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = prev.workspace;
  }
});
