import test from "node:test";
import assert from "node:assert/strict";

import { decideFromScores, LOOP_GUARD_DEFAULTS } from "../src/agent/supervisor/thresholds.ts";

test("decideFromScores prefers stop at high stop score", () => {
  assert.equal(
    decideFromScores({ continue: 0.4, stop: 0.7, ask_user: 0.3 }),
    "stop"
  );
});

test("decideFromScores prefers ask_user when stop below threshold", () => {
  assert.equal(
    decideFromScores({ continue: 0.4, stop: 0.5, ask_user: 0.65 }),
    "ask_user"
  );
});

test("decideFromScores prefers continue when stop and ask_user below thresholds", () => {
  assert.equal(
    decideFromScores({ continue: 0.6, stop: 0.5, ask_user: 0.4 }),
    "continue"
  );
});

test("decideFromScores defaults to stop when no threshold met", () => {
  assert.equal(
    decideFromScores({ continue: 0.1, stop: 0.2, ask_user: 0.3 }),
    LOOP_GUARD_DEFAULTS.fallbackDecision
  );
});

test("decideFromScores checks stop before ask_user before continue", () => {
  assert.equal(
    decideFromScores({ continue: 0.9, stop: 0.62, ask_user: 0.9 }),
    "stop"
  );
});
