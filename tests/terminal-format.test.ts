import test from "node:test";
import assert from "node:assert/strict";

import {
  prefixBlock,
  renderMarkdownToAnsi,
  renderTerminalTable,
  terminalColumnCount,
} from "../dist/agent-runtime/terminal-format.js";
import { stripAnsi } from "../dist/agent-runtime/utils.js";

function displayCellWidth(text: string) {
  const graphemes = (() => {
    try {
      return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
        .map((segment) => segment.segment);
    } catch {
      return [...text];
    }
  })();
  return graphemes.reduce((sum, cluster) => sum + (/\p{Extended_Pictographic}/u.test(cluster) ? 2 : cluster.length), 0);
}

test("renderMarkdownToAnsi formats bold headings and bullet lists", () => {
  const md = [
    "**The Model War**",
    "*   **GPT-5.5** is the current benchmark, but the gap is closing.",
    "**Bottom Line:** It's no longer about who has the biggest cluster.",
  ].join("\n");
  const plain = stripAnsi(renderMarkdownToAnsi(md));
  assert.match(plain, /The Model War/);
  assert.doesNotMatch(plain, /\*\*The Model War\*\*/);
  assert.match(plain, /•.*GPT-5\.5.*benchmark/);
  assert.doesNotMatch(plain, /\*\*GPT-5\.5\*\*/);
  assert.match(plain, /Bottom Line:/);
});

test("renderMarkdownToAnsi preserves underscores inside exact tokens", () => {
  assert.equal(stripAnsi(renderMarkdownToAnsi("LIVE_DIRECT_OK_TOKEN")), "LIVE_DIRECT_OK_TOKEN");
  assert.equal(
    stripAnsi(renderMarkdownToAnsi("Project done - LIST_DONE_TOKEN")),
    "Project done - LIST_DONE_TOKEN"
  );
});

test("renderMarkdownToAnsi still supports standalone underscore emphasis", () => {
  assert.equal(stripAnsi(renderMarkdownToAnsi("This is _important_.")), "This is important.");
});

test("renderMarkdownToAnsi converts LaTeX inline arrows to Unicode", () => {
  const md =
    "Web Search $\\rightarrow$ Write File $\\rightarrow$ Email to ping you that it's ready for review.";
  const plain = stripAnsi(renderMarkdownToAnsi(md));
  assert.equal(
    plain,
    "Web Search → Write File → Email to ping you that it's ready for review."
  );
});

test("renderMarkdownToAnsi preserves a single authored space after emoji", () => {
  assert.equal(stripAnsi(renderMarkdownToAnsi("🛠️ Tools")), "🛠️ Tools");
  assert.equal(stripAnsi(renderMarkdownToAnsi("⏱️ Cron")), "⏱️ Cron");
  assert.equal(stripAnsi(renderMarkdownToAnsi("✉️ Email")), "✉️ Email");
  assert.equal(stripAnsi(renderMarkdownToAnsi("⌨️ Commands")), "⌨️ Commands");
  assert.equal(stripAnsi(renderMarkdownToAnsi("✍️ Write")), "✍️ Write");
  assert.equal(stripAnsi(renderMarkdownToAnsi("🫡 Profile")), "🫡 Profile");
});

test("renderMarkdownToAnsi draws GFM table with box Unicode", () => {
  const md = [
    "| # | Job ID |",
    "|---|---------|",
    "| 1 | cron-a |",
  ].join("\n");
  const plain = stripAnsi(renderMarkdownToAnsi(md));
  assert.match(plain, /┌───.*┐/s);
  assert.match(plain, /│.*#.*│.*Job ID.*│/s);
  assert.match(plain, /cron-a/);
});

test("renderMarkdownToAnsi table allows leading indent on rows", () => {
  const md = [
    "   | A | B |",
    "   | --- | --- |",
    "   | x | y |",
  ].join("\n");
  const plain = stripAnsi(renderMarkdownToAnsi(md));
  assert.match(plain, /│.*x.*│.*y.*│/s);
});

test("renderMarkdownToAnsi does not treat malformed pipe row as table", () => {
  const md = "| one |\nnot a table";
  assert.match(stripAnsi(renderMarkdownToAnsi(md)), /\| one \|/);
});

test("renderMarkdownToAnsi horizontal rule matches terminalColumnCount", () => {
  const prev = process.stdout.columns;
  const prevEnv = process.env.COLUMNS;
  Object.defineProperty(process.stdout, "columns", { value: 15, configurable: true });
  delete process.env.COLUMNS;
  try {
    const plain = stripAnsi(renderMarkdownToAnsi("---"));
    assert.equal(plain.length, 15);
    assert.ok([...plain].every((c) => c === "─"));
  } finally {
    Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    if (prevEnv !== undefined) process.env.COLUMNS = prevEnv;
    else delete process.env.COLUMNS;
  }
});

test("terminalColumnCount prefers larger of stdout.columns and COLUMNS", () => {
  const prev = process.stdout.columns;
  const prevEnv = process.env.COLUMNS;
  Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
  process.env.COLUMNS = "132";
  try {
    assert.equal(terminalColumnCount(), 132);
  } finally {
    Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    if (prevEnv !== undefined) process.env.COLUMNS = prevEnv;
    else delete process.env.COLUMNS;
  }
});

test("renderTerminalTable wraps wide cells to fit terminal width", () => {
  const prev = process.stdout.columns;
  const prevEnv = process.env.COLUMNS;
  Object.defineProperty(process.stdout, "columns", { value: 48, configurable: true });
  process.env.COLUMNS = "48";
  try {
    const plain = stripAnsi(
      renderTerminalTable(
        [
          { label: "Command", minWidth: 8, maxWidth: 12, wrap: false },
          { label: "Description", minWidth: 14, maxWidth: 24, wrap: true },
        ],
        [
          ["/help", "A very long description that must wrap cleanly inside the xterm table border."],
        ]
      )
    );
    const lines = plain.split("\n");
    assert.ok(lines.some((line) => line.includes("must wrap")));
    assert.ok(lines.every((line) => line.length <= 48));
  } finally {
    Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    if (prevEnv !== undefined) process.env.COLUMNS = prevEnv;
    else delete process.env.COLUMNS;
  }
});

test("renderMarkdownToAnsi GFM table wraps within terminal width", () => {
  const prev = process.stdout.columns;
  const prevEnv = process.env.COLUMNS;
  Object.defineProperty(process.stdout, "columns", { value: 52, configurable: true });
  process.env.COLUMNS = "52";
  try {
    const md = [
      "| Source | Summary |",
      "| --- | --- |",
      "| Example Corp | A very long summary that should wrap inside the rendered terminal table borders. |",
    ].join("\n");
    const plain = stripAnsi(renderMarkdownToAnsi(md));
    const lines = plain.split("\n");
    assert.ok(lines.some((line) => line.includes("wrap inside")));
    assert.ok(lines.every((line) => line.length <= 52));
  } finally {
    Object.defineProperty(process.stdout, "columns", { value: prev, configurable: true });
    if (prevEnv !== undefined) process.env.COLUMNS = prevEnv;
    else delete process.env.COLUMNS;
  }
});

test("renderTerminalTable aligns emoji cells by display width", () => {
  const plain = stripAnsi(
    renderTerminalTable(
      [
        { label: "", minWidth: 2, maxWidth: 3, wrap: false },
        { label: "Name", minWidth: 5, maxWidth: 10, wrap: false },
      ],
      [
        ["🛠️", "Tools"],
        ["⏱️", "Cron"],
        ["✉️", "Email"],
        ["⌨️", "Commands"],
        ["✍️", "Write"],
        ["🫡", "Profile"],
        ["📄", "Read"],
      ]
    )
  );
  const widths = plain.split("\n").map(displayCellWidth);
  assert.deepEqual([...new Set(widths)], [widths[0]]);
});

test("prefixBlock leaves full-width divider lines flush", () => {
  const rendered = ["Summary", "────────────────────", "Next line"].join("\n");
  const prefixed = stripAnsi(prefixBlock(rendered, true));
  const lines = prefixed.split("\n");
  assert.equal(lines[0], " └ Summary");
  assert.equal(lines[1], "────────────────────");
  assert.equal(lines[2], "Next line");
});

test("renderMarkdownToAnsi linkifies bare https URLs with OSC 8 hyperlink", () => {
  const url = "https://connect.composio.dev/link/lk_5oiVSeNBNB6P";
  const rendered = renderMarkdownToAnsi(`Authorize Gmail: ${url}`);
  assert.match(rendered, /\x1b\]8;;https:\/\/connect\.composio\.dev\/link\/lk_5oiVSeNBNB6P\x07/);
  assert.match(rendered, /\x1b\[4m/);
  assert.doesNotMatch(rendered, /\x1b\[38;2;96;165;250m/);
  assert.equal(stripAnsi(rendered), `Authorize Gmail: ${url}`);
});

test("renderMarkdownToAnsi leaves markdown link syntax visible and does not restyle labels", () => {
  const raw = "[Click here](https://example.com/oauth)";
  const rendered = renderMarkdownToAnsi(raw);
  assert.equal(stripAnsi(rendered), raw);
});

test("renderMarkdownToAnsi does not linkify http URLs", () => {
  const rendered = renderMarkdownToAnsi("Visit http://example.com for details");
  assert.doesNotMatch(rendered, /\x1b\]8;;/);
  assert.equal(stripAnsi(rendered), "Visit http://example.com for details");
});

test("renderMarkdownToAnsi does not linkify URLs inside inline code", () => {
  const rendered = renderMarkdownToAnsi("Run `curl https://example.com`");
  assert.doesNotMatch(rendered, /\x1b\]8;;/);
  assert.equal(stripAnsi(rendered), "Run curl https://example.com");
});
