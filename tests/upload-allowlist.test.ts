import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  isAllowedUploadFile,
} from "../dist/agent-runtime/tools/upload-allowlist.js";

test("upload allowlist uses normalized lowercase extensions", () => {
  assert.ok(ALLOWED_UPLOAD_EXTENSIONS.has("png"));
  assert.ok(!ALLOWED_UPLOAD_EXTENSIONS.has(".png"));
});

test("isAllowedUploadFile is case-insensitive and requires an extension", () => {
  assert.equal(isAllowedUploadFile("photo.PNG"), true);
  assert.equal(isAllowedUploadFile("archive"), false);
  assert.equal(isAllowedUploadFile(".env"), true);
  assert.equal(isAllowedUploadFile("script.sh"), true);
});
