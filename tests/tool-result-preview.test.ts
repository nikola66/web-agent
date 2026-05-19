import test from "node:test";
import assert from "node:assert/strict";

import { summarizeToolResultPreview } from "../dist/agent-runtime/tool-result-preview.js";

test("summarizeToolResultPreview includes text excerpt for web_fetch-shaped result", () => {
  const s = summarizeToolResultPreview({
    ok: true,
    url: "https://example.com",
    text: `${"hello world ".repeat(100)}END`,
  });
  assert.match(s, /^text \(\d+ chars\):/);
  assert.match(s, /hello world/);
  assert.match(s, /…$/);
});

test("summarizeToolResultPreview includes longer content when from_snapshot", () => {
  const body = "x".repeat(3_000);
  const s = summarizeToolResultPreview({
    ok: true,
    from_snapshot: true,
    path: "memory/snapshots/a.json",
    content: body,
  });
  assert.match(s, /^content \(3000 chars\):/);
  assert.ok(s.length < body.length + 80);
  assert.match(s, /…$/);
});

test("summarizeToolResultPreview surfaces TinyFish-style web_fetch (text + provider id)", () => {
  const s = summarizeToolResultPreview({
    ok: true,
    url: "https://example.com",
    provider: "tinyfish",
    text: "Nous Hermes docs: section on tools…",
  });
  assert.match(s, /^text \(\d+ chars\):/);
  assert.match(s, /Nous Hermes/);
});

test("summarizeToolResultPreview surfaces markdown body when no text", () => {
  const s = summarizeToolResultPreview({
    ok: true,
    markdown: "# Title\n\nBody ".repeat(80),
  });
  assert.match(s, /^markdown \(\d+ chars\):/);
});

test("summarizeToolResultPreview surfaces youtube_transcribe transcript body", () => {
  const s = summarizeToolResultPreview({
    ok: true,
    videoId: "pl90LATQlHI",
    transcript: "Opening remarks from the speaker. ".repeat(40),
  });
  assert.match(s, /^transcript \(\d+ chars\):/);
  assert.match(s, /Opening remarks from the speaker/);
});

test("summarizeToolResultPreview surfaces list_dir entries as paths", () => {
  const s = summarizeToolResultPreview({
    entries: [
      { path: "memory/snapshots", kind: "dir" },
      { path: "AGENT.md", kind: "file" },
    ],
    scanned: 10,
    truncated: false,
  });
  assert.match(s, /^entries \(\d+ chars\):/);
  assert.match(s, /memory\/snapshots/);
  assert.match(s, /AGENT\.md/);
});

test("summarizeToolResultPreview surfaces find_files paths", () => {
  const s = summarizeToolResultPreview({
    files: ["src/foo.ts", "src/bar.ts"],
    scanned: 2,
    truncated: true,
  });
  assert.match(s, /^files \(\d+ chars\):/);
  assert.match(s, /src\/foo\.ts/);
});

test("tool result body fields stay visible in compact previews", () => {
  const fields = [
    { field: "text", sample: "Hello from web_fetch. ".repeat(20) },
    { field: "markdown", sample: "## Title\n\nBody ".repeat(20) },
    { field: "content", sample: "File body ".repeat(20) },
    { field: "transcript", sample: "Spoken line. ".repeat(20) },
  ];
  for (const { field, sample } of fields) {
    const preview = summarizeToolResultPreview({ ok: true, [field]: sample });
    assert.match(preview, new RegExp(`^${field} \\(\\d+ chars\\):`), field);
  }
});
