import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSearchLocation } from "../dist/agent-runtime/tools/remote-tools.js";

test("normalizeSearchLocation takes first code from comma list", () => {
  assert.equal(normalizeSearchLocation("ae, sa"), "ae");
  assert.equal(normalizeSearchLocation("AE; SA"), "ae");
  assert.equal(normalizeSearchLocation("us"), "us");
  assert.equal(normalizeSearchLocation(""), undefined);
  assert.equal(normalizeSearchLocation(undefined), undefined);
});
