import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_ARRIVAL_MS,
  CATCH_UP_IDLE_MS,
  UNITS_CATCH_UP_MAX,
  UNITS_WHILE_DRAINING,
  UNITS_WHILE_STREAMING,
  computeTypewriterDrainBudget,
} from "../src/core/terminal-typewriter.ts";

test("computeTypewriterDrainBudget keeps a slow cadence while bytes are still arriving", () => {
  assert.equal(computeTypewriterDrainBudget(12_000, 0), UNITS_WHILE_STREAMING);
  assert.equal(computeTypewriterDrainBudget(12_000, ACTIVE_ARRIVAL_MS - 1), UNITS_WHILE_STREAMING);
});

test("computeTypewriterDrainBudget drains at a moderate pace after a short idle gap", () => {
  assert.equal(computeTypewriterDrainBudget(400, ACTIVE_ARRIVAL_MS + 1), UNITS_WHILE_DRAINING);
  assert.equal(computeTypewriterDrainBudget(400, CATCH_UP_IDLE_MS), UNITS_WHILE_DRAINING);
});

test("computeTypewriterDrainBudget catch-up stays capped and never dumps the whole backlog in one tick", () => {
  const budget = computeTypewriterDrainBudget(20_000, CATCH_UP_IDLE_MS + 1);
  assert.ok(budget <= UNITS_CATCH_UP_MAX);
  assert.ok(budget > UNITS_WHILE_DRAINING);
});
