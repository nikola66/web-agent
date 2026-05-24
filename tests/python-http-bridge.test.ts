import test from "node:test";
import assert from "node:assert/strict";
import {
  proxyHttpRequest,
  setSyncHttpTransport,
  CORS_PROXY_PATH,
} from "../src/runtimes/webcontainer/python-http-bridge.ts";

test("proxyHttpRequest rejects empty url", () => {
  const resp = proxyHttpRequest({ url: "" });
  assert.match(String(resp.error), /url is required/);
});

test("proxyHttpRequest posts upstream payload to /api/proxy", () => {
  let captured: Record<string, unknown> | null = null;
  setSyncHttpTransport((payload) => {
    captured = payload;
    return {
      status: 200,
      responseText: JSON.stringify({
        status: 201,
        statusText: "Created",
        contentType: "application/json",
        body: '{"ok":true}',
      }),
    };
  });
  try {
    const resp = proxyHttpRequest({
      method: "post",
      url: "https://api.example.com/items",
      headers: { Authorization: "Bearer tok" },
      body: '{"title":"Hi"}',
    });
    assert.equal(captured?.method, "POST");
    assert.equal(captured?.url, "https://api.example.com/items");
    assert.deepEqual(captured?.headers, { Authorization: "Bearer tok" });
    assert.equal(captured?.body, '{"title":"Hi"}');
    assert.equal(resp.status, 201);
    assert.equal(resp.bodyText, '{"ok":true}');
    assert.equal(new TextDecoder().decode(resp.bodyBytes), '{"ok":true}');
  } finally {
    setSyncHttpTransport(null);
  }
});

test("proxyHttpRequest surfaces proxy-side errors", () => {
  setSyncHttpTransport(() => ({
    status: 200,
    responseText: JSON.stringify({ error: "upstream blocked", status: 502 }),
  }));
  try {
    const resp = proxyHttpRequest({ url: "https://api.example.com/x" });
    assert.equal(resp.error, "upstream blocked");
    assert.equal(resp.status, 502);
  } finally {
    setSyncHttpTransport(null);
  }
});

test("CORS_PROXY_PATH matches adapter route", () => {
  assert.equal(CORS_PROXY_PATH, "/api/proxy");
});
