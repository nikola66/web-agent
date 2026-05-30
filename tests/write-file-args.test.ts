import assert from "node:assert/strict";
import test from "node:test";
import {
  WRITE_FILE_MAX_BYTES,
  looksLikeIncompleteMarkdownWrite,
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

test("parseWriteFileToolArguments salvages from object wire when parsed is empty", () => {
  const raw = { path: "work/x.txt", content: "hello" };
  const args = parseWriteFileToolArguments(raw, {});
  assert.equal(args.path, "work/x.txt");
  assert.equal(args.content, "hello");
});

test("WRITE_FILE_MAX_BYTES defaults to 16 MiB", () => {
  assert.equal(WRITE_FILE_MAX_BYTES, 16 * 1024 * 1024);
});

const TRUNCATED_BITNET_FRONTMATTER = `---
title: "BitNet b1.58 2B4T: Microsoft's 1-Bit LLM That Runs 100B Models on a Single CPU"
slug: "bitnet-b1-58-microsoft-1-bit-llm-cpu"
published_at: "2026-05-29T20`;

test("looksLikeIncompleteMarkdownWrite detects truncated BitNet frontmatter repro", () => {
  assert.equal(
    looksLikeIncompleteMarkdownWrite(
      TRUNCATED_BITNET_FRONTMATTER,
      "work/bitnet-article/bitnet-b1-58-2b4t.md"
    ),
    true
  );
});

test("looksLikeIncompleteMarkdownWrite accepts closed frontmatter with body", () => {
  const complete = `---
title: "BitNet"
slug: "bitnet"
---
# BitNet

${"Body paragraph with enough content. ".repeat(80)}`;
  assert.equal(
    looksLikeIncompleteMarkdownWrite(complete, "work/bitnet-article/bitnet-b1-58-2b4t.md"),
    false
  );
});

test("looksLikeIncompleteMarkdownWrite allows small README frontmatter-only stubs", () => {
  const stub = `---
title: "Project"
description: "Notes"
---
`;
  assert.equal(looksLikeIncompleteMarkdownWrite(stub, "README.md"), false);
  assert.equal(looksLikeIncompleteMarkdownWrite(stub, "docs/guide.md"), false);
});

test("looksLikeIncompleteMarkdownWrite flags small article draft without body", () => {
  const frontmatterOnly = `---
title: "BitNet"
slug: "bitnet"
---
`;
  assert.equal(
    looksLikeIncompleteMarkdownWrite(frontmatterOnly, "work/bitnet-article/bitnet-b1-58-2b4t.md"),
    true
  );
});

test("parseWriteFileToolArguments prefers longer salvaged content over shorter parsed", () => {
  const longBody = "# Title\n\n" + "Section text. ".repeat(100);
  const wire = `{"path":"work/article.md","content":${JSON.stringify(longBody)}}`;
  const shortParsed = { path: "work/article.md", content: "# Title" };
  const args = parseWriteFileToolArguments(wire, shortParsed);
  assert.equal(args.path, "work/article.md");
  assert.ok(String(args.content).length > String(shortParsed.content).length);
  assert.ok(String(args.content).includes("Section text."));
});
