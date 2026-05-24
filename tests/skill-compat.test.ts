import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

import {
  analyzeSkillCompat,
  appendCompatSectionIfMissing,
  buildWebAgentExecutionAppendix,
  WEB_AGENT_EXECUTION_HEADING,
} from "../dist/agent-runtime/memory/skill-compat.js";

const FIXTURE = nodePath.join(process.cwd(), "tests/fixtures/skills-sh-top10.json");

const WEB_DESIGN_GUIDELINES = [
  "---",
  "name: Web Design Guidelines",
  "description: Review UI against Vercel web guidelines",
  "---",
  "",
  "Use WebFetch to load https://example.com/guidelines",
  "Then read_file on local assets.",
].join("\n");

const AGENT_BROWSER = [
  "---",
  "name: Agent Browser",
  "allowed-tools: Bash(agent-browser:*)",
  "---",
  "",
  "Run `npx agent-browser open https://example.com`",
].join("\n");

const PDF_SKILL = [
  "---",
  "name: PDF",
  "---",
  "",
  "pip install pypdf",
  "python extract.py input.pdf",
].join("\n");

test("analyzeSkillCompat detects WebFetch as mapped tier", () => {
  const analysis = analyzeSkillCompat(WEB_DESIGN_GUIDELINES);
  assert.equal(analysis.tier, "mapped");
  assert.equal(analysis.uses_web_fetch, true);
  assert.equal(analysis.uses_playwright, false);
});

test("analyzeSkillCompat marks agent-browser as unsupported", () => {
  const analysis = analyzeSkillCompat(AGENT_BROWSER);
  assert.equal(analysis.tier, "unsupported");
  assert.equal(analysis.uses_agent_browser, true);
  assert.equal(analysis.uses_bash, true);
});

test("analyzeSkillCompat marks pdf skill as limited", () => {
  const analysis = analyzeSkillCompat(PDF_SKILL);
  assert.equal(analysis.tier, "limited");
  assert.equal(analysis.uses_python, true);
});

test("buildWebAgentExecutionAppendix includes core mappings", () => {
  const appendix = buildWebAgentExecutionAppendix(analyzeSkillCompat(WEB_DESIGN_GUIDELINES));
  assert.match(appendix, /WebFetch.*web_fetch/);
  assert.match(appendix, /browser-runtime-map/);
  assert.match(appendix, /imported-skill-compat/);
});

test("appendCompatSectionIfMissing is idempotent", () => {
  const first = appendCompatSectionIfMissing(WEB_DESIGN_GUIDELINES, {}, { force: true });
  assert.equal(first.appended, true);
  assert.match(first.content, new RegExp(WEB_AGENT_EXECUTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const second = appendCompatSectionIfMissing(first.content, {}, { force: true });
  assert.equal(second.appended, false);
  assert.equal(second.content, first.content);
});

test("appendCompatSectionIfMissing skips native skills without force", () => {
  const native = "---\nname: Native\n---\n\nUse read_file only.\n";
  const out = appendCompatSectionIfMissing(native);
  assert.equal(out.appended, false);
  assert.equal(out.analysis.tier, "native");
});

test("analyzeSkillCompat ignores auto-appended section when re-analyzing saved skill", () => {
  const native = "---\nname: Native\n---\n\n## Procedure\n\nUse read_file only.\n";
  const patched = appendCompatSectionIfMissing(native, {}, { force: true });
  assert.equal(patched.appended, true);
  const analysis = analyzeSkillCompat(patched.content);
  assert.equal(analysis.tier, "native");
  assert.equal(analysis.uses_web_fetch, false);
});

test("appendCompatSectionIfMissing does not treat author Web Agent execution heading as auto block", () => {
  const author = [
    "---",
    "name: Custom",
    "---",
    "",
    "## Web Agent execution",
    "",
    "Use WebFetch for guidelines.",
    "",
  ].join("\n");
  const out = appendCompatSectionIfMissing(author, {}, { force: true });
  assert.equal(out.appended, true);
  assert.equal(analyzeSkillCompat(out.content).tier, "mapped");
});

test("analyzeSkillCompat reads allowed-tools from frontmatter meta", () => {
  const analysis = analyzeSkillCompat("---\nname: X\n---\n\n## Procedure\n\nDo work.\n", {
    "allowed-tools": ["Bash"],
  });
  assert.equal(analysis.uses_bash, true);
  assert.equal(analysis.tier, "limited");
});

test("analyzeSkillCompat ignores passive category and SDK references", () => {
  const analysis = analyzeSkillCompat(
    [
      "---",
      "name: find-skills",
      "---",
      "",
      "Use `npx skills find react testing`.",
      "| Testing | testing, jest, playwright, e2e |",
      "- **AI Search**: [Python](references/sdk/azure-search-documents-py.md)",
    ].join("\n")
  );
  assert.equal(analysis.uses_playwright, false);
  assert.equal(analysis.uses_python, false);
  assert.equal(analysis.uses_npx, false);
  assert.equal(analysis.tier, "native");
});

test("analyzeSkillCompat flags MCP and Azure CLI workflow requirements", () => {
  const analysis = analyzeSkillCompat(
    [
      "---",
      "name: azure-ai",
      "---",
      "",
      "| AI Search | MCP Tools | CLI |",
      "| Search | `azure__search` | `az search` |",
      "Run actual validation commands (azd provision --preview, bicep build).",
    ].join("\n")
  );
  assert.equal(analysis.uses_mcp, true);
  assert.equal(analysis.uses_bash, true);
  assert.equal(analysis.tier, "limited");
  assert.ok(analysis.flags.includes("mcp_requires_config"));
});

test("analyzeSkillCompat flags Python HTTP clients", () => {
  const analysis = analyzeSkillCompat(
    "import urllib.request\nresp = urllib.request.urlopen('https://api.example.com/x')"
  );
  assert.equal(analysis.uses_python_http, true);
  assert.ok(analysis.flags.includes("python_http_mapping"));
  const appendix = buildWebAgentExecutionAppendix(analysis);
  assert.match(appendix, /webagent\.http|web_fetch/i);
});

test("analyzeSkillCompat detects feedparser and metadata requires.bins", () => {
  const analysis = analyzeSkillCompat(
    [
      "---",
      "name: openclaw-feeds",
      "compatibility: Requires Python 3, feedparser (pip install feedparser)",
      "allowed-tools: Bash(python3:*)",
      "metadata:",
      "  openclaw:",
      "    requires:",
      "      bins: [curl, python3]",
      "---",
      "",
      "Run scripts/feeds.py for RSS.",
    ].join("\n"),
    {
      compatibility: "Requires Python 3, feedparser (pip install feedparser)",
      metadata: { openclaw: { requires: { bins: ["curl", "python3"] } } },
    }
  );
  assert.equal(analysis.tier, "limited");
  assert.ok(analysis.python_libraries.includes("feedparser"));
  assert.equal(analysis.uses_system_cli, true);
  assert.equal(analysis.uses_shell_scripts, false);
});

test("analyzeSkillCompat detects subprocess and wikipedia module", () => {
  const analysis = analyzeSkillCompat(
    "---\nname: wiki\n---\n\npip install wikipedia\nimport subprocess\n"
  );
  assert.ok(analysis.python_libraries.includes("wikipedia"));
  assert.equal(analysis.uses_python_subprocess, true);
  assert.ok(analysis.flags.includes("python_subprocess"));
});

test("sample-skills-audit fixture tiers match analyzer", async () => {
  const rows = JSON.parse(
    await fs.readFile(nodePath.join(process.cwd(), "tests/fixtures/sample-skills-audit.json"), "utf8")
  );
  for (const row of rows) {
    const analysis = analyzeSkillCompat(`Use ${row.patterns.join(" and ")}`);
    assert.equal(analysis.tier, row.tier, `${row.skill} tier mismatch`);
  }
});

test("skills-sh-top10 fixture: every mapped tier declares a mapping", async () => {
  const rows = JSON.parse(await fs.readFile(FIXTURE, "utf8"));
  const mapped = rows.filter((row: { tier: string }) => row.tier === "mapped");
  assert.ok(mapped.length >= 1);
  for (const row of mapped) {
    assert.ok(row.mapping, `${row.slug} should declare mapping`);
    const appendix = buildWebAgentExecutionAppendix(
      analyzeSkillCompat(`Use ${row.patterns.join(" and ")}`)
    );
    assert.match(appendix, /web_fetch/i, `${row.slug} appendix should mention web_fetch`);
  }
});

test("skills-sh-top10 fixture: every limited tier maps to runtime guidance", async () => {
  const rows = JSON.parse(await fs.readFile(FIXTURE, "utf8"));
  const limited = rows.filter((row: { tier: string }) => row.tier === "limited");
  assert.ok(limited.length >= 1);
  for (const row of limited) {
    assert.ok(row.mapping, `${row.slug} should declare mapping`);
    const appendix = buildWebAgentExecutionAppendix(
      analyzeSkillCompat(`Use ${row.patterns.join(" and ")}`)
    );
    assert.match(
      appendix,
      /run_python|browser-runtime-map/i,
      `${row.slug} appendix should mention run_python or browser-runtime-map`
    );
  }
});
