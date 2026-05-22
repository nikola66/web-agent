import test from "node:test";
import assert from "node:assert/strict";

import {
  graphqlSchemaRecoveryHint,
  guessedResourceRecoveryHint,
  summarizeHttpErrorBody,
  webFetchTool,
  webPostTool,
} from "../dist/agent-runtime/tools/remote-tools.js";

test("webFetchTool rejects non-GET method", async () => {
  await assert.rejects(
    () => webFetchTool({ url: "https://example.com", method: "POST" }, {}),
    /web_fetch is GET-only.*web_post/
  );
});

test("webFetchTool rejects body and points to web_post", async () => {
  await assert.rejects(
    () => webFetchTool({ url: "https://example.com", body: "{}" }, {}),
    /web_post/
  );
});

test("webPostTool requires url and body", async () => {
  await assert.rejects(() => webPostTool({}, {}), /`url` is required/);
  await assert.rejects(() => webPostTool({ url: "https://example.com" }, {}), /`body` is required/);
});

test("graphqlSchemaRecoveryHint points to skill discovery", () => {
  const data = {
    errors: [
      {
        message: "GraphQL validation error.",
        extensions: { errors: [{ message: 'Cannot query field "collections" on type "Query".' }] },
      },
    ],
  };
  assert.match(summarizeHttpErrorBody(data, 400), /GraphQL validation/i);
  const hint = graphqlSchemaRecoveryHint(data, 400);
  assert.match(String(hint), /http-api/);
  assert.match(String(hint), /skill_view/i);
  assert.doesNotMatch(String(hint), /directus/i);
});

test("guessedResourceRecoveryHint nudges discovery after deep-path 403", () => {
  const hint = guessedResourceRecoveryHint("https://api.example.com/v1/items/posts?limit=0", 403);
  assert.match(String(hint), /skill_view/i);
  assert.match(String(hint), /discovery/i);
  assert.doesNotMatch(String(hint), /directus/i);
});

test("guessedResourceRecoveryHint ignores shallow paths", () => {
  assert.equal(guessedResourceRecoveryHint("https://api.example.com/health", 404), undefined);
});

test("webPostTool rejects non-http URL", async () => {
  await assert.rejects(
    () => webPostTool({ url: "file:///tmp/x", body: "{}" }, {}),
    /http\(s\) URLs/
  );
});
