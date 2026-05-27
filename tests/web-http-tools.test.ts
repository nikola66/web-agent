import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProxyTransportError,
  graphqlSchemaRecoveryHint,
  guessedResourceRecoveryHint,
  mergeUrlQueryParams,
  normalizeWebPostMethod,
  resolveWebPostBody,
  summarizeHttpErrorBody,
  buildMultipartBody,
  webFetchTool,
  webPostTool,
} from "../dist/agent-runtime/tools/remote-tools.js";
import { BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry.js";

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

test("webPostTool requires url", async () => {
  await assert.rejects(() => webPostTool({}, {}), /`url` is required/);
});

test("webPostTool requires body for POST", async () => {
  await assert.rejects(() => webPostTool({ url: "https://example.com" }, {}), /`body` is required/);
});

test("resolveWebPostBody allows DELETE without body", () => {
  assert.deepEqual(resolveWebPostBody({ url: "https://example.com/x" }, "DELETE"), { body: null });
});

test("resolveWebPostBody stringifies json alias", () => {
  assert.deepEqual(resolveWebPostBody({ json: { a: 1 } }, "POST"), { body: '{"a":1}' });
});

test("resolveWebPostBody builds urlencoded form", () => {
  const r = resolveWebPostBody({ form: { grant_type: "client_credentials", client_id: "x" } }, "POST");
  assert.equal(r.body, "grant_type=client_credentials&client_id=x");
  assert.equal(r.contentTypeHint, "application/x-www-form-urlencoded");
});

test("mergeUrlQueryParams merges params and preserves existing query", () => {
  const out = mergeUrlQueryParams("https://api.example.com/items?limit=5", {
    fields: "id,title",
    limit: 10,
  });
  const u = new URL(out);
  assert.equal(u.searchParams.get("limit"), "10");
  assert.equal(u.searchParams.get("fields"), "id,title");
});

test("normalizeWebPostMethod accepts HEAD and OPTIONS", () => {
  assert.equal(normalizeWebPostMethod("head"), "HEAD");
  assert.equal(normalizeWebPostMethod("options"), "OPTIONS");
  assert.equal(normalizeWebPostMethod("bogus"), "POST");
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

test("formatProxyTransportError adds MCP hint for Failed to fetch", () => {
  const msg = formatProxyTransportError("Failed to fetch", "https://hub.aratech.ae/items/posts");
  assert.match(msg, /\/api\/proxy/);
  assert.match(msg, /mcp_\*/);
  assert.match(msg, /hub\.aratech\.ae/);
});

test("webPostTool rejects non-http URL", async () => {
  await assert.rejects(
    () => webPostTool({ url: "file:///tmp/x", body: "{}" }, {}),
    /http\(s\) URLs/
  );
});

test("resolveWebPostBody rejects multipart array (async path)", () => {
  assert.throws(() => resolveWebPostBody({ multipart: [{ name: "f", text: "x" }] }, "POST"), /multipart/);
});

test("buildMultipartBody supports text-only fields", () => {
  const built = buildMultipartBody([{ name: "grant_type", text: "client_credentials" }]);
  const body = Buffer.from(built.body, "base64").toString("utf8");
  assert.match(body, /grant_type/);
  assert.match(body, /client_credentials/);
});

test("webPostTool schema includes multipart", () => {
  const schema = BUILTIN_TOOLS.web_post.inputSchema;
  assert.ok(schema.properties.multipart);
});

test("webFetchTool schema includes save_to and response_encoding", () => {
  const schema = BUILTIN_TOOLS.web_fetch.inputSchema;
  assert.ok(schema.properties.save_to);
  assert.ok(schema.properties.response_encoding);
});

test("webPostTool schema includes extended methods and optional body", () => {
  const schema = BUILTIN_TOOLS.web_post.inputSchema;
  assert.deepEqual(schema.properties.method.enum, [
    "POST",
    "PATCH",
    "PUT",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ]);
  assert.deepEqual(schema.required, ["url"]);
  assert.ok(schema.properties.params);
  assert.ok(schema.properties.form);
  assert.ok(schema.properties.timeout_ms);
});
