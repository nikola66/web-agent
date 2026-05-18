import test from "node:test";
import assert from "node:assert/strict";

import {
  sliceProxyFetchBody,
  WEB_FETCH_PROXY_BODY_CAP,
  webFetchTool,
} from "../dist/agent-runtime/tools/remote-tools.js";

test("webFetchTool rejects more than 5 urls", async () => {
  const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
  await assert.rejects(
    () => webFetchTool({ urls }, {}),
    /at most 5 URLs/
  );
});

test("webFetchTool requires url or urls", async () => {
  await assert.rejects(() => webFetchTool({}, {}), /`url` or `urls`/);
});

test("sliceProxyFetchBody marks truncated when body exceeds cap", () => {
  const body = "a".repeat(WEB_FETCH_PROXY_BODY_CAP + 50);
  const out = sliceProxyFetchBody(body);
  assert.equal(out.truncated, true);
  assert.equal(out.text.length, WEB_FETCH_PROXY_BODY_CAP);
  assert.equal(out.truncated_at_chars, WEB_FETCH_PROXY_BODY_CAP);
});

test("sliceProxyFetchBody does not truncate short bodies", () => {
  const out = sliceProxyFetchBody("hello");
  assert.equal(out.truncated, false);
  assert.equal(out.text, "hello");
  assert.equal(out.truncated_at_chars, undefined);
});
