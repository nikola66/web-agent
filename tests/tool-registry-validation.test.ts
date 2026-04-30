import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeToolArguments,
  validateRequiredArguments,
} from "../dist/agent-runtime/tools/argument-normalization.js";
import { createToolContext } from "../dist/agent-runtime/tools/context.js";
import {
  BUILTIN_TOOLS,
  reloadToolCapabilitiesForTest,
  runTools,
} from "../dist/agent-runtime/tools/registry.js";
import { deleteSkill, loadSkill } from "../dist/agent-runtime/memory/index.js";

function registerTestTool(t, name, fn) {
  BUILTIN_TOOLS[name] = fn;
  reloadToolCapabilitiesForTest();
  t.after(() => {
    delete BUILTIN_TOOLS[name];
    reloadToolCapabilitiesForTest();
  });
}

test("argument normalization coerces common scalar drift", async () => {
  const schema = {
    type: "object",
    properties: {
      count: { type: "number" },
      enabled: { type: "boolean" },
      payload: { type: "object" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["count", "enabled"],
    additionalProperties: false,
  };
  const result = normalizeToolArguments(
    {
      count: "7",
      enabled: "true",
      payload: "{\"name\":\"demo\"}",
      tags: "alpha",
    },
    schema
  );
  assert.equal(result.count, 7);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.payload, { name: "demo" });
  assert.deepEqual(result.tags, ["alpha"]);
});

test("runTools infers email action before required-field validation", async (t) => {
  let seenArgs = null;
  registerTestTool(t, "email", async (args) => {
    seenArgs = args;
    return { ok: true };
  });
  const ctx = createToolContext({ runId: "email-infer-runTools" });
  const catalog = {
    email: {
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string" },
          to: { type: "string" },
          subject: { type: "string" },
          text: { type: "string" },
        },
        required: ["action"],
        additionalProperties: true,
      },
    },
  };
  const results = await runTools(
    [{ name: "email", arguments: { to: "x@y.z", subject: "Subj", text: "Body text" } }],
    ctx,
    catalog
  );
  assert.ok(!results[0]?.error, results[0]?.error);
  assert.equal(seenArgs?.action, "send");
  assert.equal(seenArgs?.to, "x@y.z");
});

test("required argument validation reports missing fields clearly", async () => {
  const schema = {
    type: "object",
    properties: {
      requiredField: { type: "string" },
      optional: { type: "string" },
    },
    required: ["requiredField"],
    additionalProperties: false,
  };
  const error = validateRequiredArguments("demo_tool", { optional: "value" }, schema);
  assert.ok(error);
  assert.match(error, /requiredField/);
  assert.match(error, /demo_tool/);
});

test("runTools reports unknown tools before validating catalog schema", async () => {
  const transcript = [];
  const ctx = createToolContext({
    runId: "registry-test",
    onTranscript: (event) => transcript.push(event),
  });
  const results = await runTools(
    [{ name: "missing_registry_tool", arguments: {} }],
    ctx,
    {
      missing_registry_tool: {
        inputSchema: {
          type: "object",
          properties: { requiredValue: { type: "string" } },
          required: ["requiredValue"],
        },
      },
    }
  );

  assert.deepEqual(results, [
    {
      tool: "missing_registry_tool",
      error: "unknown tool",
      error_code: "unknown_tool",
      recovery_hint: "Fix tool name and arguments per schema.",
      retryable: false,
      fail_reason: "format_error",
    },
  ]);
  assert.deepEqual(
    transcript.map((event) => [event.type, event.name, event.status, event.error]),
    [
      ["tool_start", "missing_registry_tool", undefined, undefined],
      ["tool_result", "missing_registry_tool", "error", "unknown tool"],
    ]
  );
});

test("runTools returns invalid_arguments for missing required args without invoking tool", async (t) => {
  let calls = 0;
  registerTestTool(t, "registry_required_demo", () => {
    calls += 1;
    return { ok: true };
  });
  const results = await runTools(
    [{ name: "registry_required_demo", arguments: {} }],
    createToolContext({ runId: "registry-test" }),
    {
      registry_required_demo: {
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    }
  );

  assert.equal(calls, 0);
  assert.equal(results[0].tool, "registry_required_demo");
  assert.equal(results[0].error_code, "invalid_arguments");
  assert.equal(results[0].missing_required, true);
  assert.match(results[0].error, /value/);
});

test("runTools returns denied for rejected confirmation without invoking tool", async (t) => {
  let calls = 0;
  registerTestTool(t, "registry_denied_demo", () => {
    calls += 1;
    return { ok: true };
  });
  const ctx = createToolContext({
    runId: "registry-test",
    autoApprove: false,
    ask: async () => false,
  });
  const results = await runTools(
    [{ name: "registry_denied_demo", arguments: { path: "demo.txt" } }],
    ctx,
    {
      registry_denied_demo: {
        requiresConfirmation: true,
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    }
  );

  assert.equal(calls, 0);
  assert.deepEqual(results, [
    {
      tool: "registry_denied_demo",
      error: "user_denied",
      error_code: "user_denied",
      recovery_hint: "User declined this tool execution.",
      retryable: false,
      fail_reason: "user_denied",
      denied: true,
    },
  ]);
});

test("runTools executes successful calls sequentially in input order", async (t) => {
  const order = [];
  registerTestTool(t, "registry_sequence_demo", async (args) => {
    order.push(`start:${args.id}`);
    await new Promise((resolve) => setTimeout(resolve, Number(args.delayMs || 0)));
    order.push(`end:${args.id}`);
    return { id: args.id };
  });
  const results = await runTools(
    [
      { name: "registry_sequence_demo", arguments: { id: "first", delayMs: 20 } },
      { name: "registry_sequence_demo", arguments: { id: "second", delayMs: 0 } },
    ],
    createToolContext({ runId: "registry-test" }),
    {
      registry_sequence_demo: {
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            delayMs: { type: "number" },
          },
          required: ["id"],
        },
      },
    }
  );

  assert.deepEqual(order, ["start:first", "end:first", "start:second", "end:second"]);
  assert.deepEqual(results, [
    { tool: "registry_sequence_demo", result: { id: "first" } },
    { tool: "registry_sequence_demo", result: { id: "second" } },
  ]);
});

test("runTools aborts queued calls without invoking them", async (t) => {
  const controller = new AbortController();
  let queuedCalls = 0;
  registerTestTool(t, "registry_abort_first_demo", () => {
    controller.abort("stop after first");
    return { ok: true };
  });
  registerTestTool(t, "registry_abort_queued_demo", () => {
    queuedCalls += 1;
    return { ok: true };
  });

  const results = await runTools(
    [
      { name: "registry_abort_first_demo", arguments: {} },
      { name: "registry_abort_queued_demo", arguments: {} },
    ],
    createToolContext({ runId: "registry-test", signal: controller.signal })
  );

  assert.equal(queuedCalls, 0);
  assert.deepEqual(results, [
    { tool: "registry_abort_first_demo", result: { ok: true } },
    {
      tool: "registry_abort_queued_demo",
      error: "aborted",
      error_code: "aborted",
      recovery_hint: "Execution was aborted.",
      retryable: false,
      fail_reason: "unknown",
      aborted: true,
    },
  ]);
});

test("runTools leaves read-only skill tools ungated and gates skill_bulk_save batch writes", async (t) => {
  const askCalls = [];
  const ctx = createToolContext({
    runId: "registry-test",
    autoApprove: false,
    ask: async (payload) => {
      askCalls.push(payload);
      return false;
    },
  });

  const readResults = await runTools(
    [{ name: "skill_list", arguments: { query: "unlikely-skill-query" } }],
    ctx,
    {
      skill_list: {
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: [],
          additionalProperties: false,
        },
      },
    }
  );

  assert.equal(readResults[0].tool, "skill_list");
  assert.equal(readResults[0].result.ok, true);
  assert.equal(askCalls.length, 0);

  const savedName = `Auto Skill ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  t.after(async () => {
    await deleteSkill(savedName).catch(() => {});
  });
  const saveResults = await runTools(
    [
      {
        name: "skill_save",
        arguments: {
          name: savedName,
          description: "Created without approval gate",
          content: "## Procedure\n\n1. Auto-saved.",
        },
      },
    ],
    ctx,
    {
      skill_save: {
        requiresConfirmation: false,
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            content: { type: "string" },
          },
          required: ["name", "content"],
          additionalProperties: false,
        },
      },
    }
  );

  assert.equal(askCalls.length, 0);
  assert.equal(saveResults[0].tool, "skill_save");
  assert.ok(saveResults[0].result?.ok !== false && !saveResults[0].error, "skill_save should succeed");
  const loaded = await loadSkill(savedName);
  assert.ok(String(loaded).includes("Auto-saved"));

  const deniedSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const writeResults = await runTools(
    [
      {
        name: "skill_bulk_save",
        arguments: {
          items: [
            {
              name: `Denied Bulk A ${deniedSuffix}`,
              description: "a",
              content: "## Procedure\n\n1. No.",
            },
            {
              name: `Denied Bulk B ${deniedSuffix}`,
              description: "b",
              content: "## Procedure\n\n1. No.",
            },
          ],
        },
      },
    ],
    ctx,
    {
      skill_bulk_save: {
        requiresConfirmation: true,
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "object", additionalProperties: true },
              minItems: 1,
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    }
  );

  assert.equal(askCalls.length, 1);
  assert.deepEqual(writeResults, [
    {
      tool: "skill_bulk_save",
      error: "user_denied",
      error_code: "user_denied",
      recovery_hint: "User declined this tool execution.",
      retryable: false,
      fail_reason: "user_denied",
      denied: true,
    },
  ]);
  await assert.rejects(loadSkill(`Denied Bulk A ${deniedSuffix}`), /not found/);
  await assert.rejects(loadSkill(`Denied Bulk B ${deniedSuffix}`), /not found/);
});

test("normalizeToolArguments coerces types from validation module", () => {
  const schema = {
    type: "object",
    properties: {
      count: { type: "number" },
      enabled: { type: "boolean" },
      items: { type: "array" },
      data: { type: "object" },
    },
    required: [],
    additionalProperties: false,
  };

  const result = normalizeToolArguments(
    {
      count: "42",
      enabled: "yes",
      items: "first",
      data: '{"key":"value"}',
    },
    schema
  );

  assert.equal(result.count, 42);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.items, ["first"]);
  assert.deepEqual(result.data, { key: "value" });
});

test("validateRequiredArguments with empty required array", () => {
  const schema = {
    type: "object",
    properties: { optional: { type: "string" } },
    required: [],
  };

  const error = validateRequiredArguments("test_tool", {}, schema);
  assert.equal(error, null);
});

test("validateRequiredArguments handles null schema", () => {
  const error = validateRequiredArguments("test_tool", {}, null);
  assert.equal(error, null);
});

test("normalizeToolArguments handles string JSON input", () => {
  const schema = {
    type: "object",
    properties: { value: { type: "string" } },
    required: [],
    additionalProperties: false,
  };

  const result = normalizeToolArguments(
    '{"value":"from json"}',
    schema
  );

  assert.equal(result.value, "from json");
});

test("normalizeToolArguments with invalid JSON defaults to empty object", () => {
  const schema = {
    type: "object",
    properties: { value: { type: "string" } },
    required: [],
    additionalProperties: false,
  };

  const result = normalizeToolArguments(
    'not valid json',
    schema
  );

  assert.deepEqual(result, {});
});
