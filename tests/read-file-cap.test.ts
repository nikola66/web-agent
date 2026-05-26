import test from "node:test";
import assert from "node:assert/strict";

import { getReadFileMaxChars } from "../dist/agent-runtime/tools/filesystem/read.js";

test("getReadFileMaxChars defaults to snapshot unwrap cap", () => {
  const prev = process.env.WEBAGENT_READ_FILE_MAX_CHARS;
  delete process.env.WEBAGENT_READ_FILE_MAX_CHARS;
  try {
    assert.equal(getReadFileMaxChars(), 100_000);
  } finally {
    if (prev != null) process.env.WEBAGENT_READ_FILE_MAX_CHARS = prev;
    else delete process.env.WEBAGENT_READ_FILE_MAX_CHARS;
  }
});
