import test from "node:test";
import assert from "node:assert/strict";
import { isBitnetLlmPath, parseBitnetLlmTarget } from "../scripts/bitnet/router.mjs";

test("parseBitnetLlmTarget accepts chat completions path", () => {
  assert.deepEqual(parseBitnetLlmTarget("/api/llm/bitnet/chat/completions"), {
    targetPath: "/chat/completions",
  });
  assert.equal(parseBitnetLlmTarget("/api/llm/openrouter/chat/completions"), null);
});

test("isBitnetLlmPath matches bitnet prefix only", () => {
  assert.equal(isBitnetLlmPath("/api/llm/bitnet/chat/completions"), true);
  assert.equal(isBitnetLlmPath("/api/llm/openrouter/chat/completions"), false);
});
