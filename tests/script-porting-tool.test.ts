import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";

import {
  analyzePythonSource,
  pythonToNodeTool,
} from "../dist/agent-runtime/tools/script-porting.js";

async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-py2node-"));
  const previousWorkspaceRoot = process.env.WEBAGENT_WORKSPACE_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = root;
  try {
    return await run();
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = previousWorkspaceRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("analyzePythonSource detects requests and argparse hints", () => {
  const out = analyzePythonSource(
    "import argparse\nimport requests\n\nif __name__ == '__main__':\n    print('ok')"
  );
  assert.equal(out.skill_ref, "script-porting");
  assert.ok(Array.isArray(out.checklist) && out.checklist.length >= 4);
  assert.ok(Array.isArray(out.mappings) && out.mappings.length > 0);
  assert.ok(out.hints.some((h) => /requests/i.test(h)));
  assert.ok(out.hints.some((h) => /argparse/i.test(h)));
  assert.match(out.run_command_template, /^node scripts\//);
  assert.ok(out.run_shell_example && typeof out.run_shell_example === "object");
});

test("analyzePythonSource extracts env vars and suggests cwd for skill scripts", () => {
  const out = analyzePythonSource(
    "import os\nurl = os.getenv('DIRECTUS_URL')\ntoken = os.environ['DIRECTUS_API_TOKEN']\n",
    ".webagent/skills/imported/directus/scripts/sync.py"
  );
  assert.deepEqual(out.env_vars, ["DIRECTUS_API_TOKEN", "DIRECTUS_URL"]);
  assert.equal(out.suggested_cwd, ".webagent/skills/imported/directus");
  assert.equal(out.run_shell_example.command, "node scripts/sync.js");
  assert.equal(out.run_shell_example.cwd, ".webagent/skills/imported/directus");
  assert.ok(out.run_shell_example.env?.DIRECTUS_URL);
});

test("pythonToNodeTool reads workspace .py file by path", async () => {
  await withIsolatedWorkspace(async () => {
    const rel = "sample.py";
    await fs.writeFile(nodePath.join(process.env.WEBAGENT_WORKSPACE_ROOT!, rel), "import os\nprint(os.getenv('X'))\n", "utf8");
    const out = await pythonToNodeTool({ path: rel }, { cwd: process.env.WEBAGENT_WORKSPACE_ROOT });
    assert.equal(out.path, rel);
    assert.ok(out.hints.some((h) => /process\.env/i.test(h)));
  });
});

test("pythonToNodeTool with empty args returns checklist and note", async () => {
  const out = await pythonToNodeTool({});
  assert.ok(out.checklist.length > 0);
  assert.match(String(out.note || ""), /Provide `path`/);
});
