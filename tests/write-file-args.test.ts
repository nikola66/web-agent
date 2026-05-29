import assert from "node:assert/strict";
import test from "node:test";
import {
  WRITE_FILE_MAX_BYTES,
  normalizeWriteFileArgs,
  parseWriteFileToolArguments,
  salvageWriteFileArgumentsFromRawJson,
} from "../dist/agent-runtime/tools/write-file-args.js";
import { validateRequiredArguments } from "../dist/agent-runtime/tools/argument-normalization.js";
import { prepareIncomingToolArguments } from "../dist/agent-runtime/tools/tool-prep.js";

test("normalizeWriteFileArgs maps body aliases to content", () => {
  assert.equal(
    normalizeWriteFileArgs({ path: "work/a.md", markdown: "# Hi" }).content,
    "# Hi"
  );
  assert.equal(
    normalizeWriteFileArgs({ path: "work/a.md", contents: "x" }).content,
    "x"
  );
});

test("salvageWriteFileArgumentsFromRawJson recovers path and large content", () => {
  const body = "# Title\n\n".repeat(200);
  const raw = `{"path":"projects/blog/post.md","content":${JSON.stringify(body)}}`;
  const broken = raw.slice(0, -3);
  const salvaged = salvageWriteFileArgumentsFromRawJson(broken);
  assert.ok(salvaged);
  assert.equal(salvaged?.path, "projects/blog/post.md");
  assert.ok(String(salvaged?.content).startsWith("# Title"));
});

test("parseWriteFileToolArguments salvages when JSON.parse yields empty object", () => {
  const raw = `{"path":"work/x.txt","content":"line1\\nline2"}`;
  const args = parseWriteFileToolArguments(raw, {});
  assert.equal(args.path, "work/x.txt");
  assert.equal(args.content, "line1\nline2");
});

test("validateRequiredArguments accepts contents alias for write_file", () => {
  const err = validateRequiredArguments(
    "write_file",
    { path: "work/a.md", contents: "ok" },
    { type: "object", required: ["path", "content"], properties: {} }
  );
  assert.equal(err, null);
});

test("prepareIncomingToolArguments salvages broken write_file wire", () => {
  const article = "## Section\n\n".repeat(50);
  const raw = `{"path":"projects/demo/article.md","content":${JSON.stringify(article)}}`;
  const broken = raw.replace(/"}$/, "");
  const { args, name } = prepareIncomingToolArguments("write_file", broken, {
    inputSchema: {
      type: "object",
      required: ["path", "content"],
      properties: { path: { type: "string" }, content: { type: "string" } },
    },
  });
  assert.equal(name, "write_file");
  assert.equal(args.path, "projects/demo/article.md");
  assert.ok(String(args.content).includes("## Section"));
});

test("WRITE_FILE_MAX_BYTES defaults to 16 MiB", () => {
  assert.equal(WRITE_FILE_MAX_BYTES, 16 * 1024 * 1024);
});
