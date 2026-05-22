import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARRIVAL_MS,
  CATCH_UP_IDLE_MS,
  UNITS_CATCH_UP_MAX,
  UNITS_WHILE_DRAINING,
  UNITS_WHILE_STREAMING,
  computeTypewriterDrainBudget,
} from "../src/core/terminal-typewriter";

describe("computeTypewriterDrainBudget", () => {
  it("keeps a slow cadence while bytes are still arriving", () => {
    expect(computeTypewriterDrainBudget(12_000, 0)).toBe(UNITS_WHILE_STREAMING);
    expect(computeTypewriterDrainBudget(12_000, ACTIVE_ARRIVAL_MS - 1)).toBe(UNITS_WHILE_STREAMING);
  });

  it("drains at a moderate pace after a short idle gap", () => {
    expect(computeTypewriterDrainBudget(400, ACTIVE_ARRIVAL_MS + 1)).toBe(UNITS_WHILE_DRAINING);
    expect(computeTypewriterDrainBudget(400, CATCH_UP_IDLE_MS)).toBe(UNITS_WHILE_DRAINING);
  });

  it("catch-up stays capped and never dumps the whole backlog in one tick", () => {
    const budget = computeTypewriterDrainBudget(20_000, CATCH_UP_IDLE_MS + 1);
    expect(budget).toBeLessThanOrEqual(UNITS_CATCH_UP_MAX);
    expect(budget).toBeGreaterThan(UNITS_WHILE_DRAINING);
  });
});
