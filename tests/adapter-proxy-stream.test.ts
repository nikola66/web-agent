import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildMultipartBody } from "../dist/agent-runtime/tools/remote-tools.js";

/** Mirrors scripts/cors-proxy-server.mjs upstream body decode. */
function decodeProxyUpstreamBody(body: string | null, bodyEncoding?: string): Buffer | null {
  if (body == null) return null;
  if (bodyEncoding === "base64" && typeof body === "string") {
    return Buffer.from(body, "base64");
  }
  return Buffer.from(body, "utf8");
}

test("adapter streaming proxy uses direct same-origin fetch for subscription LLM URLs", async () => {
  const src = await fs.readFile(new URL("../src/agent/adapter.ts", import.meta.url), "utf8");
  const handlerMarker = 'if (agentOutputBuffer.startsWith(PROXY_STREAM_REQ_PREFIX))';
  const streamIdx = src.indexOf(handlerMarker);
  assert.ok(streamIdx >= 0, "streaming proxy handler missing");
  const streamBlock = src.slice(streamIdx, streamIdx + 5500);
  assert.match(streamBlock, /resolveSubscriptionLlmFetchPath/);
  assert.match(streamBlock, /if \(subscriptionPath\)/);
  assert.match(streamBlock, /await fetch\(subscriptionPath/);
  assert.match(streamBlock, /upstream\.body\.getReader\(\)/);
});

test("streaming adapter proxy forward preserves bodyEncoding for /api/proxy", async () => {
  const src = await fs.readFile(new URL("../src/agent/adapter.ts", import.meta.url), "utf8");
  const handlerMarker = 'if (agentOutputBuffer.startsWith(PROXY_STREAM_REQ_PREFIX))';
  const streamIdx = src.indexOf(handlerMarker);
  assert.ok(streamIdx >= 0, "streaming proxy handler missing");
  const streamBlock = src.slice(streamIdx, streamIdx + 5500);
  assert.match(streamBlock, /bodyEncoding\?: string/);
  assert.match(streamBlock, /decodeProxyStreamBody/);
});

test("proxy base64 decode preserves multipart file bytes (upload path)", () => {
  const fileBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const built = buildMultipartBody([
    { name: "file", bytes: fileBytes, filename: "hero.jpg", content_type: "image/jpeg" },
  ]);
  assert.equal(built.bodyEncoding, "base64");
  const upstream = decodeProxyUpstreamBody(built.body, built.bodyEncoding);
  assert.ok(upstream);
  const text = upstream.toString("latin1");
  assert.match(text, /filename="hero\.jpg"/);
  assert.match(text, /Content-Type: image\/jpeg/);
  assert.ok(text.includes("\xff\xd8\xff\xe0"), "binary JPEG header must survive base64 round-trip");
});

test("proxy without bodyEncoding corrupts multipart (regression guard)", () => {
  const built = buildMultipartBody([
    { name: "file", bytes: Buffer.from("hello-image"), filename: "x.jpg", content_type: "image/jpeg" },
  ]);
  const wrong = decodeProxyUpstreamBody(built.body, undefined);
  assert.ok(wrong);
  const text = wrong.toString("utf8");
  assert.doesNotMatch(text, /hello-image/);
});
