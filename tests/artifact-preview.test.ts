import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";

import {
  fileExtension,
  inferArtifactKind,
  mimeForArtifactKind,
  unsupportedPreviewMessage,
} from "../src/core/artifact-preview.ts";
import { artifactPresentTool } from "../dist/agent-runtime/tools/system-artifact-tools.js";
import { createToolContext } from "../dist/agent-runtime/tools/context.js";

test("inferArtifactKind maps common extensions", () => {
  assert.equal(inferArtifactKind("report.md"), "markdown");
  assert.equal(inferArtifactKind("flow.mmd"), "mermaid");
  assert.equal(inferArtifactKind("uploads/photo.png"), "image");
  assert.equal(inferArtifactKind("clip.mp3"), "audio");
  assert.equal(inferArtifactKind("demo.mp4"), "video");
  assert.equal(inferArtifactKind("paper.pdf"), "pdf");
  assert.equal(inferArtifactKind("brief.docx"), "docx");
  assert.equal(inferArtifactKind("deck.pptx"), "pptx");
  assert.equal(inferArtifactKind("legacy.doc"), "unsupported");
  assert.equal(inferArtifactKind("legacy.ppt"), "unsupported");
  assert.equal(inferArtifactKind("archive.zip"), "unsupported");
});

test("mimeForArtifactKind returns useful MIME types", () => {
  assert.equal(mimeForArtifactKind("pdf", "paper.pdf"), "application/pdf");
  assert.equal(mimeForArtifactKind("markdown", "plan.md"), "text/markdown;charset=utf-8");
  assert.equal(mimeForArtifactKind("image", "x.png"), "image/png");
});

test("unsupportedPreviewMessage explains legacy office formats", () => {
  assert.match(unsupportedPreviewMessage("file.doc"), /Legacy \.doc/);
  assert.match(unsupportedPreviewMessage("file.ppt"), /Legacy \.ppt/);
});

test("fileExtension reads basename extension", () => {
  assert.equal(fileExtension("work/out/report.pdf"), "pdf");
  assert.equal(fileExtension("noext"), "");
});

test("artifactPresentTool accepts path or markdown exclusively", async () => {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-artifact-"));
  const previousWorkspaceRoot = process.env.WEBAGENT_WORKSPACE_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = root;
  const rel = "work/sample.md";
  const abs = nodePath.join(root, rel);
  await fs.mkdir(nodePath.dirname(abs), { recursive: true });
  await fs.writeFile(abs, "# Sample\n", "utf8");
  const ctx = createToolContext({ runId: "artifact_path", autoApprove: true });

  const writes: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await assert.rejects(
      () => artifactPresentTool({ title: "Bad", path: rel, markdown: "# Nope" }, ctx),
      /exactly one/,
    );

    const result = await artifactPresentTool({ title: "Sample", path: rel }, ctx);
    assert.equal(result.ok, true);
    assert.equal(result.kind, "markdown");
    assert.equal(result.path, rel);

    const marker = writes.join("");
    assert.match(marker, /<<<WEBAGENT_ARTIFACT>>>/);
    const json = marker.match(/<<<WEBAGENT_ARTIFACT>>>(.*?)<<<END_WEBAGENT_ARTIFACT>>>/s)?.[1];
    assert.ok(json);
    const payload = JSON.parse(json!) as { title: string; path: string; kind: string; markdown?: string };
    assert.equal(payload.title, "Sample");
    assert.equal(payload.path, rel);
    assert.equal(payload.kind, "markdown");
    assert.equal(payload.markdown, undefined);
  } finally {
    process.stdout.write = origWrite;
    if (previousWorkspaceRoot === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = previousWorkspaceRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});
