import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeToolSchemas } from "../src/agent/runtime/llm/tool-schema-sanitizer.ts";

test("sanitizeToolSchemas strips top-level examples and fixes array items", () => {
  const [sanitized] = sanitizeToolSchemas([
    {
      type: "function",
      function: {
        name: "skill_bulk_save",
        description: "test",
        parameters: {
          type: "object",
          properties: {
            items: { type: "array", description: "rows" },
          },
          examples: [{ items: [] }],
        },
      },
    },
  ]);
  const params = sanitized.function.parameters;
  assert.equal("examples" in params, false);
  const items = params.properties.items as Record<string, unknown>;
  assert.ok(items.items);
});

test("sanitizeToolSchemas injects properties for bare object nodes", () => {
  const [sanitized] = sanitizeToolSchemas([
    {
      type: "function",
      function: {
        name: "composio_action",
        description: "test",
        parameters: {
          type: "object",
          properties: {
            args: { type: "object" },
          },
        },
      },
    },
  ]);
  const args = (sanitized.function.parameters.properties as Record<string, unknown>).args as Record<
    string,
    unknown
  >;
  assert.deepEqual(args.properties, {});
});

test("sanitizeToolSchemas strips top-level combinators", () => {
  const [sanitized] = sanitizeToolSchemas([
    {
      type: "function",
      function: {
        name: "demo",
        description: "test",
        parameters: {
          type: "object",
          properties: { x: { type: "string" } },
          anyOf: [{ required: ["x"] }],
        },
      },
    },
  ]);
  assert.equal("anyOf" in sanitized.function.parameters, false);
});

test("sanitizeToolSchemas collapses nullable unions", () => {
  const [sanitized] = sanitizeToolSchemas([
    {
      type: "function",
      function: {
        name: "demo",
        description: "test",
        parameters: {
          type: "object",
          properties: {
            note: { type: ["string", "null"] },
          },
        },
      },
    },
  ]);
  const note = (sanitized.function.parameters.properties as Record<string, unknown>).note as Record<
    string,
    unknown
  >;
  assert.equal(note.type, "string");
  assert.equal(note.nullable, true);
});

test("sanitizeToolSchemas drops invalid tool definitions", () => {
  const sanitized = sanitizeToolSchemas([
    { type: "function", function: undefined as unknown as { name: string; description: string; parameters: {} } },
    {
      type: "function",
      function: { name: "ok", description: "ok", parameters: { type: "object", properties: {} } },
    },
  ]);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0]?.function.name, "ok");
});
