import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBSCRIPTION_OAUTH_PROVIDER_IDS,
  isSubscriptionLlmUrl,
  isSubscriptionOAuthProvider,
} from "../src/core/subscription-auth-client.ts";

test("subscription provider ids stay in sync with shared manifest", async () => {
  const shared = await import("../src/shared/subscription-providers.json", {
    with: { type: "json" },
  });
  assert.deepEqual([...SUBSCRIPTION_OAUTH_PROVIDER_IDS], shared.default);
});

test("isSubscriptionOAuthProvider recognizes configured providers", () => {
  assert.equal(isSubscriptionOAuthProvider("nous"), true);
  assert.equal(isSubscriptionOAuthProvider("openai-codex"), true);
  assert.equal(isSubscriptionOAuthProvider("openrouter"), false);
});

test("isSubscriptionLlmUrl matches subscription proxy paths only", () => {
  assert.equal(isSubscriptionLlmUrl("/api/llm/nous/chat/completions"), true);
  assert.equal(isSubscriptionLlmUrl("/api/llm/openai-codex/chat/completions"), true);
  assert.equal(isSubscriptionLlmUrl("/api/llm/openrouter/chat/completions"), false);
});
