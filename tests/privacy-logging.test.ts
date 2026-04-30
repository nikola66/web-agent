import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProxyDebugLogEntry,
  DEFAULT_LAUNCH_MODE,
  TRANSIT_ONLY_PROXY_MODE,
  isTransitOnlyProxyMode,
  normalizeLaunchMode,
  sanitizeForLogs,
  sanitizeHeadersForLogs,
  sanitizeUrlForLogs,
} from "../src/agent/runtime/privacy.ts";

test("normalizeLaunchMode defaults safely and recognizes transit-only mode", () => {
  assert.equal(normalizeLaunchMode(undefined), DEFAULT_LAUNCH_MODE);
  assert.equal(normalizeLaunchMode("TRANSIT_ONLY_PROXY"), TRANSIT_ONLY_PROXY_MODE);
  assert.equal(isTransitOnlyProxyMode("transit_only_proxy"), true);
  assert.equal(isTransitOnlyProxyMode("custom"), false);
});

test("sanitizeUrlForLogs strips query values and credentials", () => {
  assert.equal(
    sanitizeUrlForLogs("https://user:pass@example.com/search?q=secret&token=abc"),
    "https://example.com/search?redacted_query_params=2"
  );
  assert.equal(
    sanitizeUrlForLogs("/api/llm/openrouter/chat/completions?api_key=secret"),
    "/api/llm/openrouter/chat/completions?redacted_query_params=1"
  );
});

test("sanitizeHeadersForLogs redacts credential-bearing headers only", () => {
  assert.deepEqual(
    sanitizeHeadersForLogs({
      Authorization: "Bearer secret",
      Cookie: "session=abc",
      "Content-Type": "application/json",
      "X-Trace-Id": "req-123",
    }),
    {
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      "Content-Type": "application/json",
      "X-Trace-Id": "req-123",
    }
  );
});

test("sanitizeForLogs redacts prompts, email bodies, fetched content, and sensitive urls", () => {
  const sanitized = sanitizeForLogs({
    url: "https://example.com/search?q=what is my secret",
    headers: {
      authorization: "Bearer secret",
      "x-api-key": "secret",
      accept: "application/json",
    },
    body: "{\"prompt\":\"top secret\"}",
    text: "email body",
    html: "<p>email body</p>",
    messages: [{ role: "user", content: "private prompt" }],
    content: "fetched page body",
    nested: {
      requestUrl: "https://api.example.com/items?cursor=private",
      responseBody: "sensitive response",
    },
  }) as Record<string, unknown>;

  assert.equal(sanitized.url, "https://example.com/search?redacted_query_params=1");
  assert.deepEqual(sanitized.headers, {
    authorization: "[redacted]",
    "x-api-key": "[redacted]",
    accept: "application/json",
  });
  assert.equal(sanitized.body, "[redacted:body]");
  assert.equal(sanitized.text, "[redacted:text]");
  assert.equal(sanitized.html, "[redacted:html]");
  assert.equal(sanitized.messages, "[redacted:messages]");
  assert.equal(sanitized.content, "[redacted:content]");
  assert.deepEqual(sanitized.nested, {
    requestUrl: "https://api.example.com/items?redacted_query_params=1",
    responseBody: "[redacted:responseBody]",
  });
});

test("buildProxyDebugLogEntry stays metadata-only", () => {
  assert.deepEqual(
    buildProxyDebugLogEntry({
      requestId: "req-123",
      routeId: "llm:openrouter",
      statusCode: 200,
      durationMs: 42.4,
    }),
    {
      requestId: "req-123",
      routeId: "llm:openrouter",
      statusCode: 200,
      durationMs: 42,
    }
  );
});
