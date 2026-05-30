import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProxyTransportError,
  graphqlSchemaRecoveryHint,
  guessedResourceRecoveryHint,
  looksLikeApiFetchUrl,
  mergeUrlQueryParams,
  normalizeWebPostMethod,
  resolveHttpAuthHeaders,
  resolveWebFetchResponseFormat,
  resolveWebPostBody,
  shouldWebFetchUseDirectProxy,
  summarizeHttpErrorBody,
  buildMultipartBody,
  urlExpectsApiJson,
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
  assert.match(String(hint), /skill/i);
  assert.doesNotMatch(String(hint), /directus/i);
});

test("graphqlSchemaRecoveryHint teaches relation linking on input-shape error", () => {
  const data = {
    errors: [
      {
        message: 'Field "name" of required type "String!" was not provided.',
        extensions: { code: "GRAPHQL_VALIDATION_EXCEPTION" },
      },
      { message: 'Expected value of type "create_Blog_Authors_input".' },
    ],
  };
  const hint = graphqlSchemaRecoveryHint(data, 400);
  assert.match(String(hint), /id/);
  assert.match(String(hint), /variables/i);
  assert.match(String(hint), /http-api/);
  assert.match(String(hint), /create_.*Collection.*_item/i);
  assert.doesNotMatch(String(hint), /directus/i);
});

test("graphqlSchemaRecoveryHint nudges CMS mutation naming on create_*_item errors", () => {
  const data = {
    errors: [{ message: 'Cannot query field "create_posts_item" on type "Mutation". Did you mean "create_Blog_Posts_item"?' }],
  };
  const hint = graphqlSchemaRecoveryHint(data, 400);
  assert.match(String(hint), /create_.*Collection.*_item|Blog_Posts/i);
  assert.match(String(hint), /http-api/);
  assert.doesNotMatch(String(hint), /directus/i);
});

test("graphqlSchemaRecoveryHint ignores REST validation errors with no GraphQL signal", () => {
  // A plain REST 422 can say "was not provided" / "of required type" — it must
  // NOT receive GraphQL relation advice.
  const restBody = {
    errors: [{ message: 'Field "email" of required type "String!" was not provided.' }],
  };
  assert.equal(graphqlSchemaRecoveryHint(restBody, 422), undefined);
  // A real GraphQL error (validation code present) still gets a hint.
  const gqlBody = {
    errors: [{ message: "x", extensions: { code: "GRAPHQL_VALIDATION_EXCEPTION" } }],
  };
  assert.match(String(graphqlSchemaRecoveryHint(gqlBody, 400)), /skill/i);
});

test("resolveHttpAuthHeaders adds Bearer from auth aliases and respects an existing header", async () => {
  const fromAuth = await resolveHttpAuthHeaders(
    { auth: { directus_token: "tok123" } } as never,
    "https://api.example.com/graphql"
  );
  assert.equal(fromAuth.Authorization, "Bearer tok123");
  const existing = await resolveHttpAuthHeaders(
    { headers: { Authorization: "Bearer keep" }, auth: { token: "other" } } as never,
    "https://api.example.com/x"
  );
  assert.equal(existing.Authorization, "Bearer keep");
});

test("guessedResourceRecoveryHint nudges discovery after deep-path 403", () => {
  const hint = guessedResourceRecoveryHint("https://api.example.com/v1/items/posts?limit=0", 403);
  assert.match(String(hint), /skill/i);
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
  assert.ok(schema.properties.response_format);
});

test("looksLikeApiFetchUrl detects REST and CMS paths", () => {
  assert.equal(looksLikeApiFetchUrl("https://hub.aratech.ae/items/posts"), true);
  assert.equal(looksLikeApiFetchUrl("https://api.example.com/v1/users"), true);
  assert.equal(looksLikeApiFetchUrl("https://cms.example.com/graphql"), true);
  assert.equal(looksLikeApiFetchUrl("https://example.com/blog/post"), false);
});

test("urlExpectsApiJson treats CMS GET and all writes as API", () => {
  assert.equal(urlExpectsApiJson("https://hub.aratech.ae/items/posts", "GET"), true);
  assert.equal(urlExpectsApiJson("https://hub.aratech.ae/items/posts", "POST"), true);
  assert.equal(urlExpectsApiJson("https://example.com/about", "GET"), false);
  assert.equal(urlExpectsApiJson("https://example.com/about", "POST"), true);
});

test("resolveHttpAuthHeaders maps auth.directus_token to Bearer", async () => {
  const headers = await resolveHttpAuthHeaders(
    { auth: { directus_token: "tok123" } },
    "https://hub.example.com/items/posts"
  );
  assert.equal(headers.Authorization, "Bearer tok123");
});

test("resolveHttpAuthHeaders preserves existing Authorization", async () => {
  const headers = await resolveHttpAuthHeaders(
    {
      headers: { Authorization: "Bearer existing" },
      auth: { directus_token: "ignored" },
    },
    "https://hub.example.com/items/posts"
  );
  assert.equal(headers.Authorization, "Bearer existing");
});

test("shouldWebFetchUseDirectProxy routes API URLs and headers away from TinyFish", () => {
  assert.equal(
    shouldWebFetchUseDirectProxy("https://hub.aratech.ae/items/posts", {}, "markdown"),
    true
  );
  assert.equal(
    shouldWebFetchUseDirectProxy("https://example.com/about", {}, "markdown"),
    false
  );
  assert.equal(
    shouldWebFetchUseDirectProxy(
      "https://example.com/about",
      { Authorization: "Bearer x" },
      "markdown"
    ),
    true
  );
  assert.equal(
    shouldWebFetchUseDirectProxy("https://example.com/about", {}, "api"),
    true
  );
});

test("resolveWebFetchResponseFormat accepts api aliases", () => {
  assert.equal(resolveWebFetchResponseFormat({ response_format: "api" }), "api");
  assert.equal(resolveWebFetchResponseFormat({ format: "json" }), "api");
  assert.equal(resolveWebFetchResponseFormat({}), "markdown");
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
