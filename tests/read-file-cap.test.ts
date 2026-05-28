import test from "node:test";
import assert from "node:assert/strict";

import {
  getReadFileMaxChars,
  binaryReadRecovery,
} from "../dist/agent-runtime/tools/filesystem/read.js";

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

test("binaryReadRecovery redirects binary/media reads to the right tool", () => {
  assert.match(binaryReadRecovery("uploads/skill.zip"), /extract_archive/);
  assert.match(binaryReadRecovery("work/bundle.tar.gz"), /extract_archive/);
  assert.match(binaryReadRecovery("report.pdf"), /pdf_extract/);
  assert.match(binaryReadRecovery("contract.docx"), /docx_extract/);
  assert.match(binaryReadRecovery("uploads/photo.JPG"), /vision_analyze/);
  assert.match(binaryReadRecovery("clip.mp3"), /audio_analyze/);
  // Text-readable files are not blocked.
  assert.equal(binaryReadRecovery("README.md"), null);
  assert.equal(binaryReadRecovery("src/index.ts"), null);
  assert.equal(binaryReadRecovery("data.json"), null);
  assert.equal(binaryReadRecovery(""), null);
});
