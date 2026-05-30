import test from "node:test";
import assert from "node:assert/strict";

import { formatApprovalTerminalBlock, summarizeToolApproval } from "../dist/agent-runtime/tools/tool-policy.js";

test("summarizeToolApproval skill manage create omits raw content body", () => {
  const summary = summarizeToolApproval("skill", {
    action: "manage",
    manage_action: "create",
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

test("summarizeToolApproval skill manage truncates long description in summary", () => {
  const summary = summarizeToolApproval("skill", {
    action: "manage",
    manage_action: "create",
    name: "n",
    description: `${"word ".repeat(80)}end`,
    content: "a",
  });
  assert.match(summary, /description=word word.*…/);
  assert.ok(summary.endsWith("content=1 chars"));
});

test("summarizeToolApproval skill manage delete is one line", () => {
  assert.equal(
    summarizeToolApproval("skill", { action: "manage", manage_action: "delete", name: "foo-bar" }),
    "skill manage: manage_action=delete; name=foo-bar"
  );
});

test("summarizeToolApproval skill manage reports string field lengths", () => {
  const summary = summarizeToolApproval("skill", {
    action: "manage",
    manage_action: "create",
    name: "s",
    content: "y".repeat(1000),
  });
  assert.match(summary, /manage_action=create/);
  assert.match(summary, /name=s/);
  assert.match(summary, /content=1000 chars/);
  assert.equal(summary.includes("yyy"), false);
});

test("summarizeToolApproval skill bulk omits item bodies and URLs stay short", () => {
  const summary = summarizeToolApproval("skill", {
    action: "bulk",
    items: [
      { name: "alpha", content: "x".repeat(10_000) },
      { url: "https://raw.githubusercontent.com/foo/bar/main/skills/x/SKILL.md" },
    ],
  });
  assert.match(summary, /skill bulk/);
  assert.match(summary, /total=2/);
  assert.match(summary, /inline=1/);
  assert.match(summary, /url=1/);
  assert.equal(summary.includes("xxxx"), false);
  assert.ok(summary.length < 800);
});

test("summarizeToolApproval skill bulk expands top-level url for counts", () => {
  const summary = summarizeToolApproval("skill", {
    action: "bulk",
    url: "https://example.com/r/SKILL.md",
    category: "imported",
  });
  assert.match(summary, /total=1/);
  assert.match(summary, /inline=0/);
  assert.match(summary, /url=1/);
});

test("summarizeToolApproval skill bulk truncates many item previews", () => {
  const items = [];
  for (let i = 0; i < 20; i += 1) {
    items.push({ name: `skill-${i}`, content: "## Procedure\n\n1. x" });
  }
  const summary = summarizeToolApproval("skill", { action: "bulk", items });
  assert.match(summary, /total=20/);
  assert.match(summary, /\+5 more/);
});

test("formatApprovalTerminalBlock skill bulk is one summary line plus approve/deny", () => {
  const longUrl = `https://example.com/${"path/".repeat(20)}SKILL.md`;
  const items = [
    { name: "n1", content: "SECRET_BODY".repeat(500) },
    { url: longUrl },
  ];
  const summary = summarizeToolApproval("skill", { action: "bulk", items });
  const block = formatApprovalTerminalBlock({
    toolLabel: "skill",
    summary,
    args: { action: "bulk", items },
  });
  assert.match(block, /total=2/);
  assert.match(block, /total=2/);
  assert.equal(block.includes("SECRET_BODY"), false);
  assert.equal(block.includes("Total items"), false);
});

test("formatApprovalTerminalBlock skill manage create is compact", () => {
  const block = formatApprovalTerminalBlock({
    toolLabel: "skill",
    summary: summarizeToolApproval("skill", {
      action: "manage",
      manage_action: "create",
      name: "blog-seo-audit",
      description: "Conduct a comprehensive SEO audit for the blog.",
      content: "x".repeat(4882),
    }),
    args: {
      action: "manage",
      manage_action: "create",
      name: "blog-seo-audit",
      description: "Conduct a comprehensive SEO audit for the blog.",
      content: "x".repeat(4882),
    },
  });
  assert.match(block, /Permission required/i);
  assert.match(block, /skill/);
  assert.match(block, /blog-seo-audit/);
  assert.ok(/4(,?)882/.test(block));
  assert.match(block, /\d+ chars/);
  assert.match(block, /Approve/);
  assert.match(block, /Deny/);
});

test("formatApprovalTerminalBlock email send uses labeled To and Subject rows", () => {
  const block = formatApprovalTerminalBlock({
    toolLabel: "email:send",
    summary: summarizeToolApproval("email:send", {
      to: "a@b.com",
      subject: "Hello there",
      text: "body",
    }),
    args: { to: "a@b.com", subject: "Hello there", text: "body" },
    toolEmoji: "✉️",
  });
  assert.match(block, /Permission required/i);
  assert.match(block, /a@b\.com/);
  assert.match(block, /Hello there/);
  assert.match(block, /📬/);
  assert.match(block, /📋/);
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

test("formatApprovalTerminalBlock generic keeps semicolon summary pieces", () => {
  const block = formatApprovalTerminalBlock({
    toolLabel: "email:send",
    summary: "first piece; second piece; third",
    args: null,
  });
  assert.match(block, /email/);
  assert.ok(block.includes("first piece"));
  assert.ok(block.includes("second piece"));
});
