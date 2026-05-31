import test from "node:test";
import assert from "node:assert/strict";

import {
  isOpencodeBigPickle,
  isBigPickleModel,
  reasoningPreviewSupportedForModel,
  resolveStreamMaxTokens,
} from "../src/agent/runtime/llm/model-quirks.js";

test("resolveStreamMaxTokens raises cap for OpenCode Big Pickle", () => {
  assert.equal(resolveStreamMaxTokens({ provider: "openrouter", model: "x" }), 8192);
  assert.equal(resolveStreamMaxTokens({ provider: "opencode", model: "big-pickle" }), 32_000);
  assert.equal(resolveStreamMaxTokens({ provider: "openrouter", model: "org/big-pickle" }), 32_000);
  assert.equal(isOpencodeBigPickle({ provider: "opencode", model: "big-pickle" }), true);
  assert.equal(isBigPickleModel({ provider: "openrouter", model: "org/big-pickle" }), true);
});

test("reasoning preview supports Big Pickle unless model-specific override disables it", () => {
  const prev = process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW;
  delete process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW;
  try {
    assert.equal(reasoningPreviewSupportedForModel({ provider: "opencode", model: "big-pickle" }), true);
    assert.equal(reasoningPreviewSupportedForModel({ provider: "openrouter", model: "x" }), true);
    process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW = "0";
    assert.equal(reasoningPreviewSupportedForModel({ provider: "opencode", model: "big-pickle" }), false);
    process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW = "1";
    assert.equal(reasoningPreviewSupportedForModel({ provider: "opencode", model: "big-pickle" }), true);
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW;
    else process.env.WEBAGENT_OPENCODE_REASONING_PREVIEW = prev;
  }
});
