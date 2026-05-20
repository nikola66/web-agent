import assert from "node:assert/strict";
import test from "node:test";
import { isChunkLoadError } from "../src/ui/lazy-with-retry.ts";

test("isChunkLoadError detects Vite stale chunk failures", () => {
  assert.equal(
    isChunkLoadError(
      new Error(
        "Failed to fetch dynamically imported module: https://webagent.aratech.ae/assets/ProfileEditor-DJ6CjXuD.js",
      ),
    ),
    true,
  );
  assert.equal(isChunkLoadError(new Error("Importing a module script failed.")), true);
  assert.equal(isChunkLoadError(new Error("render is not a function")), false);
  assert.equal(isChunkLoadError("not an error"), false);
});
