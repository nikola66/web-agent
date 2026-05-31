import test from "node:test";
import assert from "node:assert/strict";
import {
  proxyHttpRequest,
  setSyncHttpTransport,
  buildMultipartBodyBase64,
  proxyHttpUploadMultipart,
  CORS_PROXY_PATH,
} from "../src/runtimes/webcontainer/python-http-bridge.ts";
import { PYTHON_HTTP_SHIM } from "../src/runtimes/webcontainer/python-http-shim.py.ts";

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

test("proxyHttpRequest posts upstream payload with bodyEncoding base64", () => {
  let captured: Record<string, unknown> | null = null;
  setSyncHttpTransport((payload) => {
    captured = payload;
    return {
      status: 200,
      responseText: JSON.stringify({ status: 200, contentType: "text/plain", body: "ok" }),
    };
  });
  try {
    proxyHttpRequest({
      method: "POST",
      url: "https://api.example.com/upload",
      body: "Ym9keQ==",
      bodyEncoding: "base64",
    });
    assert.equal(captured?.bodyEncoding, "base64");
    assert.equal(captured?.body, "Ym9keQ==");
  } finally {
    setSyncHttpTransport(null);
  }
});

test("buildMultipartBodyBase64 builds file part", () => {
  const built = buildMultipartBodyBase64([
    { name: "file", filename: "a.bin", contentType: "application/octet-stream", contentBase64: "aGVsbG8=" },
  ]);
  assert.match(built.contentType, /multipart\/form-data/);
  const decoded = Buffer.from(built.body, "base64").toString("latin1");
  assert.match(decoded, /filename="a\.bin"/);
  assert.match(decoded, /hello/);
});

test("proxyHttpUploadMultipart sends multipart via proxy", () => {
  let captured: Record<string, unknown> | null = null;
  setSyncHttpTransport((payload) => {
    captured = payload;
    return {
      status: 200,
      responseText: JSON.stringify({
        status: 201,
        contentType: "application/json",
        body: '{"data":{"id":1}}',
      }),
    };
  });
  try {
    const resp = proxyHttpUploadMultipart(
      "https://cms.example.com/files",
      { Authorization: "Bearer tok" },
      [{ name: "file", filename: "x.jpg", contentBase64: "aGVsbG8=", contentType: "image/jpeg" }]
    );
    assert.equal(captured?.method, "POST");
    assert.equal(captured?.bodyEncoding, "base64");
    assert.match(String(captured?.headers && (captured.headers as Record<string, string>)["Content-Type"]), /multipart/);
    assert.equal(resp.status, 201);
  } finally {
    setSyncHttpTransport(null);
  }
});

test("CORS_PROXY_PATH matches adapter route", () => {
  assert.equal(CORS_PROXY_PATH, "/api/proxy");
});

test("PYTHON_HTTP_SHIM converts JsProxy headers via to_py", () => {
  assert.match(PYTHON_HTTP_SHIM, /def _headers_from_bridge/);
  assert.match(PYTHON_HTTP_SHIM, /to_py/);
  assert.match(PYTHON_HTTP_SHIM, /_headers_from_bridge\(getattr\(result, "headers"/);
  assert.doesNotMatch(PYTHON_HTTP_SHIM, /hdrs = dict\(getattr\(result, "headers"/);
});
