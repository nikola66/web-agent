import test from "node:test";
import assert from "node:assert/strict";

import {
  extractHttpListDigest,
  httpResultLooksLikeHtmlShell,
  looksLikeHtmlDocument,
  summarizeToolResultPreview,
} from "../dist/agent-runtime/tool-result-preview.js";
import { summarizeToolExecutions } from "../dist/agent-runtime/stream-output.js";

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

test("extractHttpListDigest prefers article title and date for /items/ responses", () => {
  const digest = extractHttpListDigest({
    ok: true,
    url: "https://hub.example.com/items/articles",
    data: [
      { id: "a1", title: "Latest launch", date_created: "2026-05-20T12:00:00" },
      { id: "a2", title: "Weekly recap", date_created: "2026-05-18T09:00:00" },
    ],
  });
  assert.equal(digest?.total, 2);
  assert.deepEqual(digest?.preview, ["Latest launch (2026-05-20)", "Weekly recap (2026-05-18)"]);
});

test("looksLikeHtmlDocument detects doctype pages", () => {
  assert.equal(looksLikeHtmlDocument("<!DOCTYPE html><html>"), true);
  assert.equal(looksLikeHtmlDocument("<body>login</body>"), true);
  assert.equal(looksLikeHtmlDocument('{"data":[]}'), false);
});

test("httpResultLooksLikeHtmlShell detects web_fetch HTML text", () => {
  assert.equal(
    httpResultLooksLikeHtmlShell({
      ok: true,
      url: "https://hub.example.com/items/articles",
      text: "<!DOCTYPE html><html></html>",
    }),
    true
  );
  assert.equal(
    httpResultLooksLikeHtmlShell({
      ok: true,
      url: "https://hub.example.com/items/articles",
      data: [{ title: "ok" }],
    }),
    false
  );
});

test("summarizeToolExecutions warns on spilled HTML without list_digest", () => {
  const rows = summarizeToolExecutions(
    [
      {
        tool: "web_fetch",
        result: {
          ok: true,
          url: "https://hub.example.com/items/articles",
          text: "<!DOCTYPE html><html><body>Please enable JavaScript</body></html>",
        },
      },
    ],
    ["memory/snapshots/run_html_r0_0.json"]
  );
  assert.match(rows[0].summary, /HTML, not JSON/i);
  assert.match(rows[0].summary, /do not read_file/i);
  assert.equal(rows[0].list_digest, undefined);
});

test("summarizeToolResultPreview abbreviates HTML web_fetch bodies", () => {
  const s = summarizeToolResultPreview({
    ok: true,
    url: "https://hub.example.com/items/articles",
    text: "<!DOCTYPE html><html><body>x</body></html>",
  });
  assert.match(s, /^html_shell:/);
  assert.doesNotMatch(s, /<!DOCTYPE/);
});

test("summarizeToolResultPreview includes JSON data excerpt for web_fetch", () => {
  const s = summarizeToolResultPreview({
    ok: true,
    url: "https://api.example.com/collections",
    data: [{ collection: "job_posts" }, { collection: "articles" }],
  });
  assert.match(s, /^data \(\d+ chars\):/);
  assert.match(s, /job_posts/);
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
