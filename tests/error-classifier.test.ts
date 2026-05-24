import test from "node:test";
import assert from "node:assert/strict";

import { classifyToolError } from "../dist/agent-runtime/tools/error-classifier.js";

test("classifyToolError tags shell HTTP misroute", () => {
  const c = classifyToolError(
    "run_shell (nodebox): HTTP calls belong in web_fetch, not shell — use web_fetch"
  );
  assert.equal(c.error_code, "shell_http_misroute");
  assert.match(c.recovery_hint, /web_fetch/);
});

test("classifyToolError tags Nodebox non-shell run_shell as nodebox_shell_unsupported", () => {
  const msg =
    "run_shell (Nodebox): no OS shell — only `node …`, `python3 …`, and simple probes are supported. " +
    "Use `run_python`, `grep`, `read_file`, `web_fetch`, or write a small `node -e` script;";
  const c = classifyToolError(msg);
  assert.equal(c.error_code, "nodebox_shell_unsupported");
  assert.equal(c.retryable, false);
  assert.match(c.recovery_hint, /run_python|grep|read_file|web_fetch/i);
});

test("classifyToolError tags Nodebox background run_shell as nodebox_shell_unsupported", () => {
  const c = classifyToolError(
    "run_shell (Nodebox): background mode is not supported. Omit `background` or use a full Node runtime."
  );
  assert.equal(c.error_code, "nodebox_shell_unsupported");
  assert.equal(c.retryable, false);
});

test("classifyToolError treats run_shell aborted as non-retryable aborted", () => {
  const c = classifyToolError("run_shell aborted");
  assert.equal(c.error_code, "aborted");
  assert.equal(c.retryable, false);
});

test("classifyToolError does not treat generic 'abort' substring as timeout/retryable", () => {
  const c = classifyToolError("Something went wrong: abortedConnection=true");
  assert.notEqual(c.error_code, "timeout");
  assert.equal(c.retryable, false);
});

test("classifyToolError tags Pyodide busy workspace cleanup", () => {
  const c = classifyToolError("OSError: [Errno 10] Resource busy: '/workspace/profile-id'");
  assert.equal(c.error_code, "pyodide_workspace_busy");
  assert.equal(c.retryable, true);
  assert.match(c.recovery_hint, /web_fetch|web_post/);
});

test("classifyToolError tags Pyodide missing module (hallucinated SDK)", () => {
  const c = classifyToolError(
    "Traceback...\nModuleNotFoundError: No module named 'directus'"
  );
  assert.equal(c.error_code, "pyodide_missing_module");
  assert.equal(c.retryable, false);
  assert.equal(c.shouldFallback, true);
  assert.match(c.recovery_hint, /directus/);
  assert.match(c.recovery_hint, /web_fetch|web_post/);
});
