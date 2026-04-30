import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTinyFishUrlKey,
  parseTinyFishFetchPayload,
} from "../dist/agent-runtime/tools/tinyfish-fetch.js";

test("normalizeTinyFishUrlKey strips hash and trailing slash on path", () => {
  assert.equal(
    normalizeTinyFishUrlKey("https://example.com/a/b/#frag"),
    "https://example.com/a/b"
  );
  assert.equal(normalizeTinyFishUrlKey("https://example.com/"), "https://example.com/");
});

test("parseTinyFishFetchPayload picks row matching requested URL not results[0]", () => {
  const requested = "https://wanted.example/page";
  const payload = {
    results: [
      { url: "https://other.example/", text: "", title: "bad" },
      { url: requested, text: "correct body", title: "ok" },
    ],
    errors: [],
  };
  const r = parseTinyFishFetchPayload(payload, requested, "markdown", "TinyFish");
  assert.equal(r.ok, true);
  assert.equal(r.text, "correct body");
});

test("parseTinyFishFetchPayload matches final_url", () => {
  const requested = "https://start.example/x";
  const payload = {
    results: [{ url: "https://redirect.example/", final_url: requested, text: "via final" }],
    errors: [],
  };
  const r = parseTinyFishFetchPayload(payload, requested, "markdown", "TinyFish");
  assert.equal(r.ok, true);
  assert.equal(r.text, "via final");
});

test("parseTinyFishFetchPayload uses single-result fallback", () => {
  const payload = {
    results: [{ url: "https://only.one/", text: "solo" }],
    errors: [],
  };
  const r = parseTinyFishFetchPayload(payload, "https://different.requested/", "markdown", "X");
  assert.equal(r.ok, true);
  assert.equal(r.text, "solo");
});

test("parseTinyFishFetchPayload resolves errors by URL", () => {
  const requested = "https://target.example/t";
  const payload = {
    results: [
      { url: "https://other.example/", text: "ignore" },
      { url: requested, text: "" },
    ],
    errors: [
      { url: "https://other.example/", error: "wrong_err" },
      { url: requested, error: "fetch_error" },
    ],
  };
  const r = parseTinyFishFetchPayload(payload, requested, "markdown", "TinyFish");
  assert.equal(r.ok, false);
  assert.match(r.error, /fetch_error/);
  assert.match(r.error, /target\.example/);
  assert.equal(r.errorCode, "fetch_error");
});

test("parseTinyFishFetchPayload uses single-error fallback", () => {
  const requested = "https://a.example/";
  const payload = {
    results: [],
    errors: [{ url: "https://b.example/", error: "timeout" }],
  };
  const r = parseTinyFishFetchPayload(payload, requested, "markdown", "TinyFish");
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "timeout");
});
