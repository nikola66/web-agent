import assert from "node:assert/strict";
import test from "node:test";
import {
  compareBuildIds,
  prepareUpdateReloadUrl,
  UPDATE_DISMISS_STORAGE_KEY,
} from "../src/core/app-update.ts";

test("compareBuildIds returns true when remote buildId differs", () => {
  assert.equal(compareBuildIds("abc123", { version: "0.0.30", buildId: "def456" }), true);
  assert.equal(compareBuildIds("abc123", { version: "0.0.30", buildId: "abc123" }), false);
  assert.equal(compareBuildIds("abc123", null), false);
  assert.equal(compareBuildIds("abc123", { version: "0.0.30", buildId: "" }), false);
});

test("prepareUpdateReloadUrl adds cache bust and removes clean", () => {
  const out = prepareUpdateReloadUrl(
    "https://webagent.aratech.ae/?clean=once&foo=bar",
    12345,
  );
  const url = new URL(out);
  assert.equal(url.searchParams.get("_refresh"), "12345");
  assert.equal(url.searchParams.has("clean"), false);
  assert.equal(url.searchParams.get("foo"), "bar");
});

test("UPDATE_DISMISS_STORAGE_KEY is stable", () => {
  assert.equal(UPDATE_DISMISS_STORAGE_KEY, "webagent.update.dismissedBuildId");
});
