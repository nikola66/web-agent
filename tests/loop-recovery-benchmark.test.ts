import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikePostToolStall,
  looksLikePreToolPromiseStall,
  shouldContinuePostToolStall,
} from "../dist/agent-runtime/turn-continuation.js";
import {
  isExecutionContinuationIntent,
  buildExecutionContinuationContextPrefix,
} from "../dist/agent-runtime/turn-sequencing.js";
import { prepareIncomingToolArguments, BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry.js";

const LOG_DIR = path.resolve(process.cwd(), "test-results/quality-benchmark");
const NO_TOOLS: never[] = [];

type LoopRecoveryCase = {
  id: string;
  check: () => void;
};

const LOOP_RECOVERY_CASES: LoopRecoveryCase[] = [
  {
    id: "continue_intent_bare",
    check: () => {
      assert.equal(isExecutionContinuationIntent("Continue"), true);
      assert.equal(isExecutionContinuationIntent("keep going"), true);
      assert.ok(buildExecutionContinuationContextPrefix("Continue"));
    },
  },
  {
    id: "post_tool_trying_wider_search",
    check: () => {
      const text = 'Trying a wider search for any "Ainex" or "outreach" files.';
      assert.equal(looksLikePostToolStall(text, true), true);
      assert.equal(shouldContinuePostToolStall(text, true, 0), true);
    },
  },
  {
    id: "post_tool_pick_one_of_then_ill_fetch",
    check: () => {
      const text =
        "Found a goldmine. I'll pick one of the documented projects from the archive. " +
        "Step 1 begins now. I'll fetch the cemetery's contents to pick a victim.";
      assert.equal(looksLikePostToolStall(text, true), true);
      assert.equal(shouldContinuePostToolStall(text, true, 0), true);
    },
  },
  {
    id: "pre_tool_lets_finish_assets",
    check: () => {
      const text =
        "Let's get back into the Ainex sales outreach plan and finish up those assets.";
      assert.equal(looksLikePreToolPromiseStall(text, NO_TOOLS, false), true);
    },
  },
  {
    id: "registry_session_search_quoted",
    check: () => {
      const { args } = prepareIncomingToolArguments(
        "session_search",
        { '"query"': '"Ainex plan"' },
        BUILTIN_TOOLS.session_search
      );
      assert.equal(args.query, "Ainex plan");
    },
  },
  {
    id: "registry_list_dir_slash",
    check: () => {
      const { args } = prepareIncomingToolArguments(
        "list_dir",
        { path: "/" },
        BUILTIN_TOOLS.list_dir
      );
      assert.equal(args.path, ".");
    },
  },
];

test("loop recovery benchmark covers Continue and Trying-a-search stalls", async () => {
  const failures: string[] = [];
  for (const c of LOOP_RECOVERY_CASES) {
    try {
      c.check();
    } catch (err) {
      failures.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const report = {
    at: new Date().toISOString(),
    total: LOOP_RECOVERY_CASES.length,
    passed: LOOP_RECOVERY_CASES.length - failures.length,
    failed: failures.length,
    failures,
  };

  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(path.join(LOG_DIR, "loop-recovery.json"), JSON.stringify(report, null, 2), "utf8");

  if (failures.length) {
    assert.fail(failures.join("\n"));
  }
});
