import test from "node:test";
import assert from "node:assert/strict";

import {
  captureBufferTailLines,
  computeDroppedLines,
  resolveTerminalScrollbackConfig,
  shouldTrimScrollback,
  type ScrollbackBufferView,
} from "../src/core/terminal-scrollback-gc.ts";

function mockBuffer(lines: string[]): ScrollbackBufferView {
  return {
    length: lines.length,
    getLine(index: number) {
      const text = lines[index];
      if (text === undefined) return undefined;
      return { translateToString: () => text };
    },
  };
}

test("shouldTrimScrollback skips when buffer is at or below threshold", () => {
  assert.equal(shouldTrimScrollback(1800, 1800), false);
  assert.equal(shouldTrimScrollback(1200, 1800), false);
});

test("shouldTrimScrollback triggers above threshold or when forced", () => {
  assert.equal(shouldTrimScrollback(1801, 1800), true);
  assert.equal(shouldTrimScrollback(100, 1800, true), true);
});

test("computeDroppedLines returns zero when buffer fits keep window", () => {
  assert.equal(computeDroppedLines(900, 900), 0);
  assert.equal(computeDroppedLines(500, 900), 0);
});

test("computeDroppedLines counts lines removed by soft trim", () => {
  assert.equal(computeDroppedLines(1801, 900), 901);
  assert.equal(computeDroppedLines(2500, 900), 1600);
});

test("captureBufferTailLines keeps the most recent rows", () => {
  const buffer = mockBuffer(["a", "b", "c", "d", "e"]);
  assert.deepEqual(captureBufferTailLines(buffer, 2), ["d", "e"]);
  assert.deepEqual(captureBufferTailLines(buffer, 10), ["a", "b", "c", "d", "e"]);
});

test("captureBufferTailLines handles empty buffers", () => {
  assert.deepEqual(captureBufferTailLines(mockBuffer([]), 900), []);
});

test("resolveTerminalScrollbackConfig exposes positive defaults", () => {
  const config = resolveTerminalScrollbackConfig();
  assert.ok(config.scrollbackMax >= config.trimThreshold);
  assert.ok(config.trimThreshold > config.trimKeepLines);
  assert.ok(config.trimKeepLines > 0);
});
