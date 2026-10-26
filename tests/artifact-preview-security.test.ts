import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
const { renderArtifactMarkdown, sanitizeArtifactHtml } = await import(
  "../src/ui/components/artifact-preview/markdown-render.ts"
);

function fragment(html: string) {
  const host = dom.window.document.createElement("div");
  host.innerHTML = sanitizeArtifactHtml(html);
  return host;
}

test("artifact sanitizer strips executable HTML, event handlers and unsafe URLs", () => {
  const host = fragment(`<script>alert(1)</script><img src=x onerror=alert(1)>
    <a href="java&#x73;cript:alert(1)">bad</a><iframe srcdoc="<script>alert(1)</script>"></iframe>
    <math><mtext><img src=x onerror=alert(1)></mtext></math>`);
  assert.equal(host.querySelector("script, iframe, [onerror], [href]"), null);
  assert.ok(host.querySelector("img"));
});

test("artifact sanitizer strips executable SVG while preserving Mermaid labels", () => {
  const host = fragment(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
    <script>alert(1)</script><a xlink:href="javascript:alert(1)"><text>bad</text></a>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Label<img src=x onerror=alert(1)></div></foreignObject>
    <path d="M0 0 L10 10" /></svg>`);
  assert.equal(host.querySelector("script, [onload], [onerror]"), null);
  assert.equal(host.querySelector("a")?.hasAttribute("xlink:href"), false);
  assert.ok(host.querySelector("svg path"));
  assert.match(host.querySelector("foreignObject")?.textContent ?? "", /Label/);
});

test("sanitized Markdown retains math, code, tasks, tables, links and Mermaid data", () => {
  const code = "flowchart LR\nA --> B";
  const host = fragment(renderArtifactMarkdown(`## Heading\n\n$E=mc^2$\n\n- [x] done\n\n| A |\n| --- |\n| B |\n\n[Safe](https://example.com)\n\n\`\`\`typescript\nconst x = 1;\n\`\`\`\n\n\`\`\`mermaid\n${code}\n\`\`\``));
  for (const selector of ["#heading", ".katex math", ".hljs", 'input[type="checkbox"]', "table"]) {
    assert.ok(host.querySelector(selector), selector);
  }
  assert.equal(host.querySelector('a[href="https://example.com"]')?.getAttribute("rel"), "noopener noreferrer");
  assert.equal(host.querySelector('a[href="https://example.com"]')?.getAttribute("target"), "_blank");
  assert.equal(decodeURIComponent(host.querySelector(".mermaid-block")?.getAttribute("data-code") ?? ""), `${code}\n`);
});

test("reported payloads stay inert in Markdown and Mermaid-only placeholders", () => {
  const payload = `<img src=x onerror=alert(1)><script>alert(1)</script>`;
  const host = fragment(renderArtifactMarkdown(`${payload}\n\n[bad](javascript:alert(1))`));
  assert.equal(host.querySelector("img, script, a"), null);
  const diagram = fragment(renderArtifactMarkdown(payload, true));
  assert.equal(diagram.querySelector("img, script"), null);
  assert.equal(decodeURIComponent(diagram.firstElementChild!.getAttribute("data-code")!), payload);
});
