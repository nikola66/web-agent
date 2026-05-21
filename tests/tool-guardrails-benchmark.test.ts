import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ToolCallGuardrailController,
  TOOL_LOOP_GUARDRAIL_DEFAULTS,
  type ToolGuardrailDecision,
  type ToolLoopGuardrailConfig,
} from "../src/agent/runtime/tools/tool-loop-guardrails.ts";
import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_TARGET_COUNT,
  TOOL_GUARDRAILS_BENCHMARK_CASES,
  countCasesByCategory,
  type BenchmarkCase,
  type ExpectedDecision,
} from "./fixtures/tool-guardrails-benchmark.ts";

const LOG_DIR = path.resolve(process.cwd(), "test-results/tool-guardrails-benchmark");
const MIN_CASES = BENCHMARK_TARGET_COUNT;
const MIN_PASS_RATE = 1;

type StepOutcome = {
  before: ToolGuardrailDecision;
  after: ToolGuardrailDecision;
  blocked: boolean;
};

function mergeConfig(partial?: Partial<ToolLoopGuardrailConfig>): ToolLoopGuardrailConfig {
  return { ...TOOL_LOOP_GUARDRAIL_DEFAULTS, ...partial };
}

function matchesExpected(actual: ToolGuardrailDecision, expected?: ExpectedDecision): boolean {
  if (!expected) return true;
  if (actual.action !== expected.action) return false;
  if (expected.code != null && actual.code !== expected.code) return false;
  return true;
}

function runCase(benchmarkCase: BenchmarkCase): {
  outcomes: StepOutcome[];
  haltDecision: ToolGuardrailDecision | null;
} {
  const controller = new ToolCallGuardrailController(mergeConfig(benchmarkCase.config));
  const outcomes: StepOutcome[] = [];

  for (const step of benchmarkCase.steps) {
    const before = controller.beforeCall(step.tool, step.args);
    const blocked = before.action === "block";
    let after: ToolGuardrailDecision;
    if (blocked) {
      after = before;
    } else {
      after = controller.afterCall(step.tool, step.args, step.result, step.failed);
    }
    outcomes.push({ before, after, blocked });
  }

  return { outcomes, haltDecision: controller.haltDecision };
}

test(`tool guardrails benchmark library has ${BENCHMARK_TARGET_COUNT} cases`, () => {
  assert.equal(TOOL_GUARDRAILS_BENCHMARK_CASES.length, MIN_CASES);
  const counts = countCasesByCategory(TOOL_GUARDRAILS_BENCHMARK_CASES);
  for (const category of BENCHMARK_CATEGORIES) {
    assert.ok(counts[category] > 0, `missing cases for ${category}`);
  }
});

test("tool guardrails benchmark matches expected decisions", async () => {
  const failures: Array<{
    id: string;
    prompt: string;
    category: string;
    stepIndex: number;
    phase: "before" | "after";
    expected?: ExpectedDecision;
    actual: ToolGuardrailDecision;
  }> = [];

  for (const benchmarkCase of TOOL_GUARDRAILS_BENCHMARK_CASES) {
    const { outcomes, haltDecision } = runCase(benchmarkCase);

    for (let i = 0; i < benchmarkCase.steps.length; i++) {
      const step = benchmarkCase.steps[i]!;
      const outcome = outcomes[i]!;

      if (!matchesExpected(outcome.before, step.expectBefore)) {
        failures.push({
          id: benchmarkCase.id,
          prompt: benchmarkCase.prompt,
          category: benchmarkCase.category,
          stepIndex: i,
          phase: "before",
          expected: step.expectBefore,
          actual: outcome.before,
        });
      }

      if (!outcome.blocked && !matchesExpected(outcome.after, step.expectAfter)) {
        failures.push({
          id: benchmarkCase.id,
          prompt: benchmarkCase.prompt,
          category: benchmarkCase.category,
          stepIndex: i,
          phase: "after",
          expected: step.expectAfter,
          actual: outcome.after,
        });
      }
    }

    if (benchmarkCase.expectHalt === true && !haltDecision) {
      failures.push({
        id: benchmarkCase.id,
        prompt: benchmarkCase.prompt,
        category: benchmarkCase.category,
        stepIndex: -1,
        phase: "after",
        expected: { action: "halt" },
        actual: { action: "allow", code: "allow", message: "", toolName: "", count: 0 },
      });
    }
    if (benchmarkCase.expectHalt === false && haltDecision) {
      failures.push({
        id: benchmarkCase.id,
        prompt: benchmarkCase.prompt,
        category: benchmarkCase.category,
        stepIndex: -1,
        phase: "after",
        expected: { action: "allow" },
        actual: haltDecision,
      });
    }
  }

  const totalChecks = TOOL_GUARDRAILS_BENCHMARK_CASES.reduce(
    (sum, c) => sum + c.steps.reduce((s, step) => s + (step.expectBefore ? 1 : 0) + (step.expectAfter ? 1 : 0), 0),
    0
  );
  const passRate = (totalChecks - failures.length) / totalChecks;

  await fs.mkdir(LOG_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    caseCount: TOOL_GUARDRAILS_BENCHMARK_CASES.length,
    categoryCounts: countCasesByCategory(TOOL_GUARDRAILS_BENCHMARK_CASES),
    totalChecks,
    failures: failures.length,
    passRate,
    failureSamples: failures.slice(0, 50),
  };
  await fs.writeFile(path.join(LOG_DIR, "latest.json"), JSON.stringify(report, null, 2), "utf8");

  if (failures.length > 0) {
    const sample = failures
      .slice(0, 5)
      .map(
        (f) =>
          `${f.id} [${f.category}] step ${f.stepIndex} ${f.phase}: expected ${JSON.stringify(f.expected)} got ${JSON.stringify({ action: f.actual.action, code: f.actual.code })}`
      )
      .join("\n");
    assert.fail(
      `${failures.length}/${totalChecks} decision checks failed (pass rate ${(passRate * 100).toFixed(1)}%, need ${MIN_PASS_RATE * 100}%)\n${sample}`
    );
  }

  assert.ok(passRate >= MIN_PASS_RATE, `pass rate ${passRate} below ${MIN_PASS_RATE}`);
});
