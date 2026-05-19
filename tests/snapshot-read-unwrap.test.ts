import test from "node:test";
import assert from "node:assert/strict";

import {
  createTurnInlineBudgetState,
  saveCompressedToolResults,
  unwrapSnapshotReadFileExecutions,
  spillInlineCharBudgetForToolResultItem,
} from "../dist/agent-runtime/memory/index.js";

test("unwrapSnapshotReadFileExecutions inlines each primary body field from nested tool results", () => {
  const cases = [
    { field: "text", sample: "Hello from inner web_fetch body. ".repeat(40) },
    { field: "markdown", sample: "## Hello\n\n" + "paragraph ".repeat(40) },
    { field: "content", sample: "File body ".repeat(40) },
    { field: "transcript", sample: "Spoken line from the video. ".repeat(40) },
  ];
  for (const { field, sample } of cases) {
    const inner = { ok: true, [field]: sample };
    const executions = [
      {
        tool: "read_file",
        result: {
          ok: true,
          path: `memory/snapshots/run_${field}_r1_0.json`,
          content: snapshotFileContent(inner),
        },
      },
    ];
    const out = unwrapSnapshotReadFileExecutions(executions);
    assert.equal(out[0].result.from_snapshot, true, field);
    assert.match(out[0].result.content, new RegExp(sample.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), field);
    assert.equal(out[0].result.content.includes('"payload"'), false, field);
  }
});

function snapshotFileContent(toolResult, tool = "web_fetch") {
  return JSON.stringify({
    run_id: "run_test",
    round: 1,
    index: 0,
    tool,
    created_at: new Date().toISOString(),
    payload: {
      tool,
      result: toolResult,
    },
  });
}

test("unwrapSnapshotReadFileExecutions inlines text from snapshot-shaped read_file payload", () => {
  const inner = { text: "Hello from inner web_fetch body".repeat(50) };
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "memory/snapshots/run_x_r1_0.json",
        content: snapshotFileContent(inner),
      },
    },
  ];
  const out = unwrapSnapshotReadFileExecutions(executions);
  assert.equal(out[0].result.from_snapshot, true);
  assert.match(out[0].result.content, /Hello from inner/);
  assert.equal(out[0].result.content.includes('"payload"'), false);
});

test("unwrapSnapshotReadFileExecutions truncates very long inner text", () => {
  const long = "x".repeat(120_000);
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "memory/snapshots/run_x_r2_0.json",
        content: snapshotFileContent({ text: long }),
      },
    },
  ];
  const out = unwrapSnapshotReadFileExecutions(executions);
  assert.equal(out[0].result.content_truncated, true);
  assert.ok(out[0].result.content.length < long.length);
  assert.match(out[0].result.content, /\.\.\.\[truncated\]/);
});

test("unwrapSnapshotReadFileExecutions reads markdown from nested web_fetch result", () => {
  const md = "## Hello\n\n" + "paragraph ".repeat(100);
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "memory/snapshots/run_md_r1_0.json",
        content: snapshotFileContent({ ok: true, url: "https://x.test", provider: "tinyfish", markdown: md }),
      },
    },
  ];
  const out = unwrapSnapshotReadFileExecutions(executions);
  assert.equal(out[0].result.from_snapshot, true);
  assert.match(out[0].result.content, /## Hello/);
});

test("unwrapSnapshotReadFileExecutions leaves non-snapshot paths unchanged", () => {
  const executions = [
    {
      tool: "read_file",
      result: { ok: true, path: "src/foo.txt", content: '{"payload":1}' },
    },
  ];
  const out = unwrapSnapshotReadFileExecutions(executions);
  assert.equal(out[0].result.content, '{"payload":1}');
  assert.equal(out[0].result.from_snapshot, undefined);
});

test("unwrapSnapshotReadFileExecutions leaves other tools unchanged", () => {
  const executions = [{ tool: "web_fetch", result: { ok: true, text: "z" } }];
  assert.deepEqual(unwrapSnapshotReadFileExecutions(executions), executions);
});

test("from_snapshot read_file gets spill budget large enough for unwrapped JSON", () => {
  const text = '"'.repeat(56_000);
  const item = {
    tool: "read_file",
    result: {
      ok: true,
      path: "memory/snapshots/x.json",
      from_snapshot: true,
      bytes: 1,
      content: text,
    },
  };
  const budget = spillInlineCharBudgetForToolResultItem(item, 1200);
  const serialized = JSON.stringify(item.result, null, 2);
  assert.ok(
    serialized.length <= budget,
    `expected serialized.length ${serialized.length} <= budget ${budget}`
  );
});

test("non-snapshot read_file keeps default small spill budget", () => {
  const item = {
    tool: "read_file",
    result: { ok: true, path: "src/a.txt", content: "x".repeat(5000) },
  };
  assert.equal(spillInlineCharBudgetForToolResultItem(item, 1200), 1200);
});

test("unwrapSnapshotReadFileExecutions inlines batch web_fetch documents from snapshot", () => {
  const inner = {
    ok: true,
    count: 2,
    documents: [
      {
        ok: true,
        url: "https://raw.githubusercontent.com/org/repo/main/run_simulation_server.py",
        text: "def main():\n    pass\n",
      },
      {
        ok: true,
        url: "https://raw.githubusercontent.com/org/repo/main/humanoid_agent.py",
        text: "class HumanoidAgent:\n    ...\n",
      },
    ],
  };
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "memory/snapshots/run_batch_r13_0.json",
        content: snapshotFileContent(inner),
      },
    },
  ];
  const out = unwrapSnapshotReadFileExecutions(executions);
  assert.equal(out[0].result.from_snapshot, true);
  assert.match(out[0].result.content, /def main\(\)/);
  assert.match(out[0].result.content, /class HumanoidAgent/);
  assert.match(out[0].result.content, /run_simulation_server\.py/);
  assert.equal(out[0].result.content.includes('"documents"'), false);
});

test("saveCompressedToolResults inlines from_snapshot read_file even when turn budget is exhausted", async () => {
  const content = "import os\n".repeat(4000);
  const executions = [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "memory/snapshots/run_x_r13_0.json",
        from_snapshot: true,
        bytes: content.length,
        content,
      },
    },
  ];
  const turnInlineBudget = createTurnInlineBudgetState();
  turnInlineBudget.remaining = 500;
  const refs = await saveCompressedToolResults({
    runId: "run_test",
    round: 13,
    executions,
    inlineCharBudget: 10_000,
    turnInlineBudget,
  });
  assert.deepEqual(refs, [null]);
});
