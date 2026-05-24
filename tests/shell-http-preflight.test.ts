import test from "node:test";
import assert from "node:assert/strict";

import { runShellTool } from "../dist/agent-runtime/tools/filesystem-tools.js";

test("run_shell preflight rejects HTTP one-liners on Nodebox", async (t) => {
  const prev = process.env.WEBAGENT_RUNTIME;
  process.env.WEBAGENT_RUNTIME = "nodebox";
  t.after(() => {
    if (prev === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prev;
  });

  await assert.rejects(
    () =>
      runShellTool(
        { command: 'node -e "const axios = require(\'axios\');"' },
        { cwd: "." }
      ),
    /HTTP calls belong in web_fetch/
  );
});

test("run_shell returns recovery metadata for pip on Nodebox", async (t) => {
  const prev = process.env.WEBAGENT_RUNTIME;
  process.env.WEBAGENT_RUNTIME = "nodebox";
  t.after(() => {
    if (prev === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prev;
  });

  const out = await runShellTool({ command: "pip install requests" }, { cwd: "." });
  assert.equal((out as { exit_code?: number }).exit_code, 127);
  assert.equal((out as { error_code?: string }).error_code, "nodebox_python_unsupported");
  assert.equal((out as { suggested_tool?: string }).suggested_tool, "run_python");
});

test("run_shell supports simple virtual date on Nodebox", async (t) => {
  const prev = process.env.WEBAGENT_RUNTIME;
  process.env.WEBAGENT_RUNTIME = "nodebox";
  t.after(() => {
    if (prev === undefined) delete process.env.WEBAGENT_RUNTIME;
    else process.env.WEBAGENT_RUNTIME = prev;
  });

  const out = await runShellTool({ command: "date" }, { cwd: "." });
  assert.equal((out as { exit_code?: number }).exit_code, 0);
  assert.match(String((out as { stdout?: string }).stdout || ""), /\d{4}/);
});
