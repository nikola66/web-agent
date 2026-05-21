import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyLlmProviderError,
  formatClassifiedLlmError,
} from "../dist/agent-runtime/llm/llm-error-classifier.js";

test("classifyLlmProviderError marks context overflow as non-retryable and compressible", () => {
  const c = classifyLlmProviderError(
    400,
    '{"error":"maximum context length exceeded"}',
    "openrouter"
  );
  assert.equal(c.reason, "context_overflow");
  assert.equal(c.retryable, false);
  assert.equal(c.shouldCompress, true);
  assert.match(c.recoveryHint, /compact/i);
});

test("classifyLlmProviderError marks 429 as retryable rate limit", () => {
  const c = classifyLlmProviderError(429, "rate limit exceeded", "openrouter");
  assert.equal(c.reason, "rate_limit");
  assert.equal(c.retryable, true);
  assert.equal(c.shouldCompress, false);
});

test("formatClassifiedLlmError includes recovery hint for compressible failures", () => {
  const text = formatClassifiedLlmError(
    classifyLlmProviderError(413, "payload too large", "test")
  );
  assert.match(text, /payload too large/i);
  assert.match(text, /compact/i);
});
