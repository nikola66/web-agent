import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTinyFishUrlKey,
  parseTinyFishFetchPayload,
  spaShellPageRecoveryHint,
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

test("spaShellPageRecoveryHint flags Directus JS shell at HTTP 200", () => {
  const text =
    "We're sorry but Directus doesn't work without JavaScript enabled. Please enable it to continue.";
  const hint = spaShellPageRecoveryHint(text, "https://hub.aratech.ae/admin");
  assert.ok(hint);
  assert.match(hint, /HTTP 200/);
  assert.match(hint, /not down|usually up/i);
  assert.match(hint, /Authorization|Bearer|web_fetch/i);
});

test("spaShellPageRecoveryHint nudges auth when API path returns HTML shell", () => {
  const hint = spaShellPageRecoveryHint(
    "Please enable JavaScript to continue.",
    "https://hub.aratech.ae/items/blog_posts"
  );
  assert.ok(hint);
  assert.match(hint, /API path/i);
  assert.match(hint, /not treat HTTP 200 here as unreachable/i);
});

test("spaShellPageRecoveryHint ignores normal markdown", () => {
  assert.equal(spaShellPageRecoveryHint("# Hello\n\nReal article body.", "https://blog.example/post"), undefined);
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
