import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMcpInputSchema } from "../src/core/mcp/schema-normalize.js";

test("normalizeMcpInputSchema rewrites definitions refs", () => {
  const out = normalizeMcpInputSchema({
    type: "object",
    definitions: { Foo: { type: "string" } },
    properties: { x: { $ref: "#/definitions/Foo" } },
  });
  assert.deepEqual(out.$defs, { Foo: { type: "string" } });
  assert.deepEqual((out.properties as Record<string, unknown>).x, { $ref: "#/$defs/Foo" });
});

test("normalizeMcpInputSchema collapses nullable anyOf", () => {
  const out = normalizeMcpInputSchema({
    type: "object",
    properties: {
      q: {
        anyOf: [{ type: "string" }, { type: "null" }],
        default: null,
      },
    },
  });
  const props = out.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.q.type, "string");
  assert.equal(props.q.nullable, true);
});

test("normalizeMcpInputSchema empty input becomes object schema", () => {
  assert.deepEqual(normalizeMcpInputSchema(null), { type: "object", properties: {} });
});

test("normalizeMcpInputSchema survives deeply nested schema (no stack overflow)", () => {
  let node: Record<string, unknown> = { type: "string" };
  for (let i = 0; i < 5000; i++) {
    node = { type: "object", properties: { child: node } };
  }
  assert.doesNotThrow(() => normalizeMcpInputSchema(node));
});
