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
