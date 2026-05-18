import test from "node:test";
import assert from "node:assert/strict";

import { summarizeToolExecutions } from "../dist/agent-runtime/stream-output.js";

test("summarizeToolExecutions adds fetch_truncated hint for truncated web_fetch results", () => {
  const exec = [
    {
      tool: "web_fetch",
      result: {
        ok: true,
        url: "https://example.com/big",
        text: `${"x".repeat(400)}`,
        truncated: true,
        truncated_at_chars: 50_000,
      },
    },
  ];
  const rows = summarizeToolExecutions(exec, []);
  assert.match(rows[0].summary, /fetch_truncated/);
  assert.match(rows[0].summary, /50000/);
});

test("summarizeToolExecutions adds truncation hint when payload spilled and result is truncated", () => {
  const exec = [
    {
      tool: "web_fetch",
      result: {
        ok: true,
        truncated: true,
        truncated_at_chars: 100_000,
        text: "…",
      },
    },
  ];
  const rows = summarizeToolExecutions(exec, ["memory/snapshots/run_x_r0_0.json"]);
  assert.match(rows[0].summary, /payload_spilled_to_snapshot/);
  assert.match(rows[0].summary, /fetch_truncated/);
});
