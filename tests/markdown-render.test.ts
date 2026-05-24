import test from "node:test";
import assert from "node:assert/strict";

import { renderArtifactMarkdown } from "../src/ui/components/artifact-preview/markdown-render.ts";

test("renderArtifactMarkdown highlights fenced code with language label", () => {
  const html = renderArtifactMarkdown("```typescript\nconst x = 1;\n```");
  assert.match(html, /md-code-block/);
  assert.match(html, /md-code-lang">typescript/);
  assert.match(html, /hljs/);
  assert.match(html, /const/);
});

test("renderArtifactMarkdown renders GFM tables", () => {
  const html = renderArtifactMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.match(html, /<table>/);
  assert.match(html, /md-table-wrap/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});

test("renderArtifactMarkdown renders task lists and strikethrough", () => {
  const html = renderArtifactMarkdown("- [x] done\n- [ ] todo\n\n~~removed~~");
  assert.match(html, /task-list-item/);
  assert.match(html, /<s>removed<\/s>/);
});

test("renderArtifactMarkdown renders GitHub alerts", () => {
  const html = renderArtifactMarkdown("> [!WARNING]\n> Be careful.");
  assert.match(html, /md-alert-warning/);
  assert.match(html, /Warning/);
  assert.match(html, /Be careful/);
  assert.doesNotMatch(html, /\[!WARNING\]/);
});

test("renderArtifactMarkdown renders inline math", () => {
  const html = renderArtifactMarkdown("Energy $E=mc^2$ here.");
  assert.match(html, /katex/);
});

test("renderArtifactMarkdown preserves mermaid fences", () => {
  const html = renderArtifactMarkdown("```mermaid\nflowchart LR\n  A --> B\n```");
  assert.match(html, /mermaid-block/);
  assert.match(html, /data-code=/);
});

test("renderArtifactMarkdown adds heading anchors", () => {
  const html = renderArtifactMarkdown("## My Section");
  assert.match(html, /id="my-section"/);
  assert.match(html, /md-heading-anchor/);
});
