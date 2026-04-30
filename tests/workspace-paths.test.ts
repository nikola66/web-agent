import test from "node:test";
import assert from "node:assert/strict";
import nodePath from "node:path";
import fs from "node:fs/promises";

test("normalizeWorkspaceRelativePath collapses duplicated workspace segment prefixes", async () => {
  const module = await import("../dist/agent-runtime/workspace-paths.js");
  const sessionDir = nodePath.basename(process.cwd());
  const duplicated = `${sessionDir}/${sessionDir}/tool_test_project/data/sample_data.jsonl`;

  const normalized = module.normalizeWorkspaceRelativePath(duplicated);

  assert.equal(normalized, "tool_test_project/data/sample_data.jsonl");
});

test("normalizeWorkspaceRelativePath preserves absolute paths outside workspace", async () => {
  const module = await import("../dist/agent-runtime/workspace-paths.js");
  const hostAbsolutePath = "/Users/nsin/tools/license_visualizer/license_visualizer.py";

  const normalized = module.normalizeWorkspaceRelativePath(hostAbsolutePath);

  assert.equal(normalized, hostAbsolutePath);
});

test("assertAllowedWorkspaceWritePath rejects top-level stray file", async () => {
  const { assertAllowedWorkspaceWritePath } = await import("../dist/agent-runtime/workspace-paths.js");
  const abs = nodePath.join(process.cwd(), `_guard_root_reject_${Date.now()}.md`);
  assert.throws(() => assertAllowedWorkspaceWritePath(abs), /Refusing to write at workspace root/);
});

test("assertAllowedWorkspaceWritePath allows nested file", async () => {
  const { assertAllowedWorkspaceWritePath } = await import("../dist/agent-runtime/workspace-paths.js");
  const abs = nodePath.join(process.cwd(), "tmp", `_guard_nested_${Date.now()}`, "a.txt");
  assert.doesNotThrow(() => assertAllowedWorkspaceWritePath(abs));
});

test("assertAllowedWorkspaceWritePath allows allowlisted README at root", async () => {
  const { assertAllowedWorkspaceWritePath } = await import("../dist/agent-runtime/workspace-paths.js");
  const abs = nodePath.join(process.cwd(), "README.md");
  assert.doesNotThrow(() => assertAllowedWorkspaceWritePath(abs));
});

test("assertAllowedWorkspaceWritePath skips when WEBAGENT_DISABLE_ROOT_WRITE_GUARD=1", async () => {
  const prev = process.env.WEBAGENT_DISABLE_ROOT_WRITE_GUARD;
  process.env.WEBAGENT_DISABLE_ROOT_WRITE_GUARD = "1";
  try {
    const { assertAllowedWorkspaceWritePath } = await import("../dist/agent-runtime/workspace-paths.js");
    const abs = nodePath.join(process.cwd(), `_guard_env_bypass_${Date.now()}.csv`);
    assert.doesNotThrow(() => assertAllowedWorkspaceWritePath(abs));
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_DISABLE_ROOT_WRITE_GUARD;
    else process.env.WEBAGENT_DISABLE_ROOT_WRITE_GUARD = prev;
  }
});

test("assertAllowedWorkspaceWritePath rejects workspace root directory as file target", async () => {
  const { assertAllowedWorkspaceWritePath } = await import("../dist/agent-runtime/workspace-paths.js");
  assert.throws(() => assertAllowedWorkspaceWritePath(process.cwd()), /workspace root as a writable file target/);
});

test("writeFileTool rejects top-level stray path", async () => {
  const { writeFileTool } = await import("../dist/agent-runtime/tools/filesystem-tools.js");
  const stray = `_write_guard_reject_${Date.now()}.md`;
  await assert.rejects(writeFileTool({ path: stray, content: "x" }, {}), /Refusing to write at workspace root/);
});

test("writeFileTool accepts path under subdirectory", async (t) => {
  const { writeFileTool } = await import("../dist/agent-runtime/tools/filesystem-tools.js");
  const rootTmp = nodePath.join(process.cwd(), "tmp");
  await fs.mkdir(rootTmp, { recursive: true });
  const slug = `_write_guard_ok_${Date.now()}`;
  const dir = nodePath.join(rootTmp, slug);
  await fs.mkdir(dir, { recursive: true });
  const rel = nodePath.relative(process.cwd(), nodePath.join(dir, "notes.txt"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const result = await writeFileTool({ path: rel, content: "ok" }, {});
  assert.equal(result.ok, true);
  const content = await fs.readFile(nodePath.join(dir, "notes.txt"), "utf8");
  assert.equal(content, "ok");
});
