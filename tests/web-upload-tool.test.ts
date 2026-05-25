import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMultipartBody,
  WEB_UPLOAD_MAX_BYTES,
  webUploadTool,
} from "../dist/agent-runtime/tools/remote-tools.js";
import { BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry.js";
import { classifyToolError } from "../dist/agent-runtime/tools/error-classifier.js";
import { looksLikeBinaryPayload } from "../dist/agent-runtime/tool-result-preview.js";

test("buildMultipartBody encodes file part as base64 multipart", () => {
  const payload = Buffer.from("hello-image");
  const built = buildMultipartBody([
    { name: "title", text: "Hero" },
    { name: "file", bytes: payload, filename: "hero.jpg", content_type: "image/jpeg" },
  ]);
  assert.equal(built.bodyEncoding, "base64");
  assert.match(built.contentType, /multipart\/form-data/);
  const decoded = Buffer.from(built.body, "base64").toString("latin1");
  assert.match(decoded, /name="title"/);
  assert.match(decoded, /Hero/);
  assert.match(decoded, /filename="hero\.jpg"/);
  assert.match(decoded, /hello-image/);
});

test("webUploadTool rejects raw bytes in args", async () => {
  await assert.rejects(
    () =>
      webUploadTool(
        {
          upload_url: "https://cms.example.com/files",
          source_url: "https://example.com/x.jpg",
          base64: "abc",
        },
        {}
      ),
    /never accepts raw bytes/
  );
});

test("webUploadTool requires source_url or file_path", async () => {
  await assert.rejects(
    () => webUploadTool({ upload_url: "https://cms.example.com/files" }, {}),
    /source_url.*file_path/
  );
});

test("web_upload schema has no body/base64 fields", () => {
  const schema = BUILTIN_TOOLS.web_upload.inputSchema;
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.upload_url);
  assert.ok(schema.properties.source_url);
  assert.ok(schema.properties.file_path);
  assert.equal(schema.properties.body, undefined);
});

test("WEB_UPLOAD_MAX_BYTES defaults to 10MB", () => {
  assert.equal(WEB_UPLOAD_MAX_BYTES, 10 * 1024 * 1024);
});

test("classifyToolError upload_misroute hints web_upload", () => {
  const c = classifyToolError(
    "web_upload never accepts raw bytes in tool args",
    "web_post"
  );
  assert.equal(c.error_code, "upload_misroute");
  assert.match(c.recovery_hint, /web_upload/);
});

test("looksLikeBinaryPayload detects long base64 strings", () => {
  const blob = Buffer.from("hello-binary-payload").toString("base64").repeat(120);
  assert.equal(looksLikeBinaryPayload(blob), true);
  assert.equal(looksLikeBinaryPayload({ base64: blob }), true);
  assert.equal(looksLikeBinaryPayload("short"), false);
  assert.equal(looksLikeBinaryPayload("x".repeat(3000)), false);
});
