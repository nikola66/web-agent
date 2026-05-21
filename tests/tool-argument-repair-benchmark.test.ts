import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  repairToolCallArgumentsJson,
  parseToolArguments,
  normalizeToolArguments,
  validateRequiredArguments,
  resolveInputSchema,
} from "../dist/agent-runtime/tools/argument-normalization.js";
import { prepareIncomingToolArguments, BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry.js";
import {
  ARGUMENT_REPAIR_TARGET_COUNT,
  TOOL_ARGUMENT_REPAIR_CASES,
  countRepairCasesByCategory,
  type ArgumentRepairCase,
} from "./fixtures/tool-argument-repair-benchmark.ts";

const LOG_DIR = path.resolve(process.cwd(), "test-results/quality-benchmark");
const MIN_PASS_RATE = 1;

function schemaForTool(toolName: string) {
  const entry = BUILTIN_TOOLS[toolName as keyof typeof BUILTIN_TOOLS];
  return resolveInputSchema(entry as { inputSchema?: Record<string, unknown> });
}

function assertSubset(actual: Record<string, unknown>, expect: Record<string, unknown>, caseId: string) {
  for (const [key, value] of Object.entries(expect)) {
    assert.deepEqual(actual[key], value, `${caseId}: field ${key}`);
  }
}

function runRepairCase(repairCase: ArgumentRepairCase): { args: Record<string, unknown>; registryArgs: Record<string, unknown> } {
  const schema = schemaForTool(repairCase.tool);
  const parsed = parseToolArguments(repairCase.raw, repairCase.tool);
  const normalized = normalizeToolArguments(repairCase.raw, schema, repairCase.tool);
  const { args: registryArgs } = prepareIncomingToolArguments(
    repairCase.tool,
    repairCase.raw,
    BUILTIN_TOOLS[repairCase.tool as keyof typeof BUILTIN_TOOLS] as { inputSchema?: Record<string, unknown> }
  );
  return { args: normalized, registryArgs };
}

test(`tool argument repair benchmark has ${ARGUMENT_REPAIR_TARGET_COUNT} cases`, () => {
  assert.equal(TOOL_ARGUMENT_REPAIR_CASES.length, ARGUMENT_REPAIR_TARGET_COUNT);
  const counts = countRepairCasesByCategory(TOOL_ARGUMENT_REPAIR_CASES);
  assert.ok(counts.quoted_keys >= 1);
  assert.ok(counts.wire_json >= 1);
  assert.ok(counts.path_coercion >= 1);
});

test("repairToolCallArgumentsJson repairs trailing comma and unclosed brace", () => {
  assert.deepEqual(JSON.parse(repairToolCallArgumentsJson('{"query": "x",}')), { query: "x" });
  assert.deepEqual(JSON.parse(repairToolCallArgumentsJson('{"query": "x"')), { query: "x" });
});

test("tool argument repair benchmark passes all cases", async () => {
  const failures: string[] = [];
  let passed = 0;

  for (const repairCase of TOOL_ARGUMENT_REPAIR_CASES) {
    try {
      const { args, registryArgs } = runRepairCase(repairCase);
      assertSubset(args, repairCase.expect, repairCase.id);
      assertSubset(registryArgs, repairCase.expect, `${repairCase.id}:registry`);
      if (repairCase.requireValid) {
        const schema = schemaForTool(repairCase.tool);
        const err = validateRequiredArguments(repairCase.tool, registryArgs, schema);
        assert.equal(err, null, `${repairCase.id}: ${err}`);
      }
      passed += 1;
    } catch (err) {
      failures.push(`${repairCase.id} (${repairCase.category}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const report = {
    at: new Date().toISOString(),
    total: TOOL_ARGUMENT_REPAIR_CASES.length,
    passed,
    failed: failures.length,
    passRate: passed / TOOL_ARGUMENT_REPAIR_CASES.length,
    failures,
    byCategory: countRepairCasesByCategory(TOOL_ARGUMENT_REPAIR_CASES),
  };

  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(
    path.join(LOG_DIR, "tool-argument-repair.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  if (failures.length) {
    assert.fail(`argument repair benchmark failures (${failures.length}):\n${failures.slice(0, 12).join("\n")}`);
  }
  assert.ok(report.passRate >= MIN_PASS_RATE);
});
