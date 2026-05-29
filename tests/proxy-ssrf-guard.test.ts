import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertProxyTargetAllowed,
  ProxyTargetBlockedError,
  redactProxyError,
} from "../scripts/proxy-ssrf-guard.mjs";

const blocked = [
  "http://169.254.169.254/latest/meta-data/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://127.0.0.1:8080/",
  "http://localhost/admin",
  "http://10.1.2.3/",
  "http://192.168.0.1/",
  "http://172.16.5.5/",
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://0.0.0.0/",
  "http://service.internal/",
  "file:///etc/passwd",
  "data:text/plain;base64,aGk=",
  "gopher://evil/",
];

for (const url of blocked) {
  test(`blocks ${url}`, () => {
    assert.throws(() => assertProxyTargetAllowed(url, {}), ProxyTargetBlockedError);
  });
}

const allowed = [
  "https://hub.aratech.ae/mcp",
  "https://api.github.com/repos/x/y",
  "http://example.com/",
];

for (const url of allowed) {
  test(`allows ${url}`, () => {
    assert.doesNotThrow(() => assertProxyTargetAllowed(url, {}));
  });
}

test("WEBAGENT_PROXY_ALLOW_PRIVATE=1 permits private/loopback", () => {
  const env = { WEBAGENT_PROXY_ALLOW_PRIVATE: "1" };
  assert.doesNotThrow(() => assertProxyTargetAllowed("http://127.0.0.1:9999/", env));
  assert.doesNotThrow(() => assertProxyTargetAllowed("http://192.168.1.10/", env));
});

test("opt-out still blocks metadata and non-http(s)", () => {
  const env = { WEBAGENT_PROXY_ALLOW_PRIVATE: "1" };
  assert.throws(() => assertProxyTargetAllowed("http://169.254.169.254/", env), ProxyTargetBlockedError);
  assert.throws(() => assertProxyTargetAllowed("file:///etc/passwd", env), ProxyTargetBlockedError);
});

test("invalid / missing URL is blocked", () => {
  assert.throws(() => assertProxyTargetAllowed("not a url", {}), ProxyTargetBlockedError);
  assert.throws(() => assertProxyTargetAllowed(undefined, {}), ProxyTargetBlockedError);
});

test("redactProxyError masks credentials", () => {
  assert.match(redactProxyError("fetch failed: Bearer sk-abc123secret"), /\[REDACTED\]/);
  assert.doesNotMatch(redactProxyError("Bearer sk-abc123secret"), /sk-abc123secret/);
});
