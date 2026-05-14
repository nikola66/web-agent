import test from "node:test";
import assert from "node:assert/strict";

import { formatApprovalTerminalBlock, summarizeToolApproval } from "../dist/agent-runtime/tools/tool-policy.js";

test("summarizeToolApproval skill_save omits raw content body", () => {
  const summary = summarizeToolApproval("skill_save", {
    name: "my-skill",
    description: "Short desc",
    content: "x".repeat(50_000),
  });
  assert.match(summary, /name=my-skill/);
  assert.match(summary, /content=50000 chars/);
  assert.match(summary, /description=Short desc/);
  assert.equal(summary.includes("xxxxx"), false);
  assert.ok(summary.length < 300);
});

test("summarizeToolApproval skill_save truncates long description in summary", () => {
  const summary = summarizeToolApproval("skill_save", {
    name: "n",
    description: `${"word ".repeat(80)}end`,
    content: "a",
  });
  assert.match(summary, /description=word word.*…/);
  assert.ok(summary.endsWith("content=1 chars"));
});

test("summarizeToolApproval skill_delete is one line", () => {
  assert.equal(summarizeToolApproval("skill_delete", { name: "foo-bar" }), "skill_delete: name=foo-bar");
});

test("summarizeToolApproval skill_manage reports string field lengths", () => {
  const summary = summarizeToolApproval("skill_manage", {
    action: "create",
    name: "s",
    content: "y".repeat(1000),
  });
  assert.match(summary, /action=create/);
  assert.match(summary, /name=s/);
  assert.match(summary, /content=1000 chars/);
  assert.equal(summary.includes("yyy"), false);
});

test("summarizeToolApproval skill_bulk_save omits item bodies and URLs stay short", () => {
  const summary = summarizeToolApproval("skill_bulk_save", {
    items: [
      { name: "alpha", content: "x".repeat(10_000) },
      { url: "https://raw.githubusercontent.com/foo/bar/main/skills/x/SKILL.md" },
    ],
  });
  assert.match(summary, /skill_bulk_save/);
  assert.match(summary, /total=2/);
  assert.match(summary, /inline=1/);
  assert.match(summary, /url=1/);
  assert.equal(summary.includes("xxxx"), false);
  assert.ok(summary.length < 800);
});

test("summarizeToolApproval skill_bulk_save expands top-level url for counts", () => {
  const summary = summarizeToolApproval("skill_bulk_save", {
    url: "https://example.com/r/SKILL.md",
    category: "imported",
  });
  assert.match(summary, /total=1/);
  assert.match(summary, /inline=0/);
  assert.match(summary, /url=1/);
});

test("summarizeToolApproval skill_bulk_save truncates many item previews", () => {
  const items = [];
  for (let i = 0; i < 20; i += 1) {
    items.push({ name: `skill-${i}`, content: "## Procedure\n\n1. x" });
  }
  const summary = summarizeToolApproval("skill_bulk_save", { items });
  assert.match(summary, /total=20/);
  assert.match(summary, /\+5 more/);
});

test("formatApprovalTerminalBlock skill_bulk_save is one summary line plus approve/deny", () => {
  const longUrl = `https://example.com/${"path/".repeat(20)}SKILL.md`;
  const items = [
    { name: "n1", content: "SECRET_BODY".repeat(500) },
    { url: longUrl },
  ];
  const summary = summarizeToolApproval("skill_bulk_save", { items });
  const block = formatApprovalTerminalBlock({
    toolLabel: "skill_bulk_save",
    summary,
    args: { items },
  });
  assert.match(block, /skill_bulk_save/);
  assert.match(block, /total=2/);
  assert.equal(block.includes("SECRET_BODY"), false);
  assert.equal(block.includes("Total items"), false);
});

test("formatApprovalTerminalBlock skill_save is compact", () => {
  const block = formatApprovalTerminalBlock({
    toolLabel: "skill_save",
    summary: summarizeToolApproval("skill_save", {
      name: "blog-seo-audit",
      description: "Conduct a comprehensive SEO audit for the blog.",
      content: "x".repeat(4882),
    }),
    args: {
      name: "blog-seo-audit",
      description: "Conduct a comprehensive SEO audit for the blog.",
      content: "x".repeat(4882),
    },
  });
  assert.match(block, /Permission required/i);
  assert.match(block, /skill_save/);
  assert.match(block, /blog-seo-audit/);
  assert.ok(/4(,?)882/.test(block));
  assert.match(block, /content=\d+ chars/);
  assert.match(block, /Approve/);
  assert.match(block, /Deny/);
});

test("summarizeToolApproval email send is readable", () => {
  const s = summarizeToolApproval("email:send", {
    action: "send",
    to: "a@b.com",
    subject: "Hello there",
    text: "BODY".repeat(1000),
  });
  assert.match(s, /email:send/);
  assert.match(s, /a@b\.com/);
  assert.match(s, /Hello there/);
  assert.equal(s.includes("BODY"), false);
});

test("summarizeToolApproval email send reads to/subject from nested arguments", () => {
  const s = summarizeToolApproval("email:send", {
    action: "send",
    arguments: { to: "x@y.z", subject: "Nested subj", text: "…" },
  });
  assert.match(s, /x@y\.z/);
  assert.match(s, /Nested subj/);
});

test("formatApprovalTerminalBlock generic keeps semicolon summary on one line", () => {
  const block = formatApprovalTerminalBlock({
    toolLabel: "email:send",
    summary: "first piece; second piece; third",
    args: null,
  });
  assert.match(block, /email:send/);
  assert.ok(block.includes("first piece"));
  assert.ok(block.includes("second piece"));
});
