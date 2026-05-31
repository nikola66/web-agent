import test from "node:test";
import assert from "node:assert/strict";

import {
  pythonNonZeroExitError,
  type PythonIpcResult,
} from "../src/agent/runtime/tools/python-tools.ts";

test("pythonNonZeroExitError returns null for exit 0", () => {
  assert.equal(pythonNonZeroExitError({ ok: true, exit_code: 0 }), null);
});

test("pythonNonZeroExitError surfaces stderr and recovery hint", () => {
  const msg = pythonNonZeroExitError({
    ok: true,
    exit_code: 1,
    stderr: "TypeError: 'JsProxy' object is not iterable",
    stdout: "",
  });
  assert.ok(msg);
  assert.match(msg!, /exited with code 1/);
  assert.match(msg!, /JsProxy/);
  assert.match(msg!, /web_fetch|web_post/);
});

test("pythonNonZeroExitError falls back to stdout when stderr empty", () => {
  const msg = pythonNonZeroExitError({
    ok: true,
    exit_code: 2,
    stderr: "",
    stdout: "Traceback (most recent call last):\n  File ...",
  });
  assert.ok(msg);
  assert.match(msg!, /stdout:/);
  assert.match(msg!, /Traceback/);
});
