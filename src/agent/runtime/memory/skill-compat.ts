/**
 * Map external agent-host tool names (skills.sh / Claude Code) to Web Agent built-ins.
 */

export type CompatTier = "native" | "mapped" | "limited" | "unsupported";

export type SkillCompatAnalysis = {
  tier: CompatTier;
  uses_web_fetch: boolean;
  uses_bash: boolean;
  uses_python: boolean;
  uses_playwright: boolean;
  uses_agent_browser: boolean;
  uses_mcp: boolean;
  uses_npx: boolean;
  flags: string[];
};

export const WEB_AGENT_EXECUTION_HEADING = "## Web Agent execution (auto-appended)";

const COMPAT_SECTION_MARKER = /## Web Agent execution \(auto-appended\)/i;

function skillSourceForCompatAnalysis(text: string): string {
  const idx = text.search(COMPAT_SECTION_MARKER);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function listIncludes(meta: Record<string, unknown> | undefined, key: string): string[] {
  const raw = meta?.[key];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function analyzeSkillCompat(
  text: string,
  meta: Record<string, unknown> = {}
): SkillCompatAnalysis {
  const body = skillSourceForCompatAnalysis(String(text || ""));
  const allowed = listIncludes(meta, "allowed-tools");
  const requires = listIncludes(meta, "requires-tools").concat(
    listIncludes(meta, "requires_tools")
  );
  const toolText = [...allowed, ...requires].join(" ").toLowerCase();
  const toolNames = [...allowed, ...requires].map((t) => String(t).trim().toLowerCase());
  const hay = `${body}\n${toolText}`;

  const uses_web_fetch = /\bWebFetch\b|\bweb_fetch\b(?!\s*\/)/i.test(hay);
  const uses_bash =
    /\bbash\s*\(/i.test(hay) ||
    toolNames.some((t) => t === "bash" || t.startsWith("bash(")) ||
    /\ballowed-tools:[^\n]*\bBash\b/i.test(body) ||
    /\brequires-tools:[^\n]*\bBash\b/i.test(body);
  const uses_python = /\b(pip install|python3?|python\s+-m|\.py\b|pdftotext|qpdf)\b/i.test(hay);
  const uses_playwright = /\bplaywright\b|\bpuppeteer\b/i.test(hay);
  const uses_agent_browser = /\bagent-browser\b/i.test(hay);
  const uses_mcp =
    /\bCallMcpTool\b|\bmcp_[a-z]/i.test(hay) ||
    toolNames.some((t) => t.includes("mcp"));
  const uses_npx = /\bnpx\b/i.test(hay);

  const flags: string[] = [];
  if (uses_web_fetch) flags.push("web_fetch_mapping");
  if (uses_bash) flags.push("bash_shell");
  if (uses_python) flags.push("python_porting");
  if (uses_playwright) flags.push("playwright_unavailable");
  if (uses_agent_browser) flags.push("agent_browser_unavailable");
  if (uses_mcp) flags.push("mcp_unavailable");
  if (uses_npx) flags.push("npx_unavailable");

  let tier: CompatTier = "native";
  if (uses_agent_browser || uses_playwright) tier = "unsupported";
  else if (uses_python || uses_mcp || uses_bash || uses_npx) tier = "limited";
  else if (uses_web_fetch || flags.length > 0) tier = "mapped";

  return {
    tier,
    uses_web_fetch,
    uses_bash,
    uses_python,
    uses_playwright,
    uses_agent_browser,
    uses_mcp,
    uses_npx,
    flags,
  };
}

export function buildWebAgentExecutionAppendix(analysis: SkillCompatAnalysis): string {
  const lines = [
    "## Web Agent execution (auto-appended)",
    "",
    "This skill was written for other agent hosts. In Web Agent use:",
    "",
    "| External | Web Agent |",
    "|----------|-----------|",
    "| WebFetch / fetch URL | `web_fetch` `{ url, headers? }` |",
    "| POST / GraphQL | `web_post` — `skill_view` **`http-api`** |",
    "| Read / Glob / Grep | `read_file` / `list_dir` / `find_files` / `grep` |",
    "| Skill / Read skill | `skill_view` `{ name }` |",
    "| Bash / curl / npx | `skill_view` **`browser-runtime-map`** — Nodebox: `run_shell` **`node …` only** |",
    "| Python / pip / `.py` | `skill_view` **`script-porting`** + `python_to_node` |",
  ];

  if (analysis.uses_agent_browser || analysis.uses_playwright) {
    lines.push(
      "| agent-browser / Playwright | **Not available** — use `web_fetch` + file tools; QA via source inspection |"
    );
  }
  if (analysis.uses_mcp) {
    lines.push("| MCP / CallMcpTool | **Not built-in** — add a capability or use `web_fetch`/`web_post` for REST |");
  }

  lines.push(
    "",
    `Compatibility tier: **${analysis.tier}**.`,
    "",
    "Call `skill_view` **`browser-runtime-map`** before the first tool fan-out.",
    "After install from skills.sh, also read `skill_view` **`imported-skill-compat`**.",
    ""
  );

  return lines.join("\n");
}

export function appendCompatSectionIfMissing(
  raw: string,
  meta: Record<string, unknown> = {},
  { force = false }: { force?: boolean } = {}
): { content: string; appended: boolean; analysis: SkillCompatAnalysis } {
  const text = String(raw || "");
  const analysis = analyzeSkillCompat(text, meta);
  if (COMPAT_SECTION_MARKER.test(text)) {
    return { content: text, appended: false, analysis };
  }
  if (!force && analysis.tier === "native") {
    return { content: text, appended: false, analysis };
  }
  const appendix = buildWebAgentExecutionAppendix(analysis);
  const trimmed = text.trimEnd();
  const content = `${trimmed}\n\n${appendix}`;
  return { content: content.endsWith("\n") ? content : `${content}\n`, appended: true, analysis };
}

export function compatScanWarnings(analysis: SkillCompatAnalysis): string[] {
  const warnings: string[] = [];
  if (analysis.uses_agent_browser || analysis.uses_playwright) {
    warnings.push(
      "references browser automation (agent-browser/Playwright) — unavailable in Web Agent; see skill_view imported-skill-compat"
    );
  }
  if (analysis.uses_bash) {
    warnings.push("references Bash/shell — Nodebox run_shell is node-only; see browser-runtime-map");
  }
  if (analysis.uses_web_fetch) {
    warnings.push("references WebFetch — use web_fetch with the same URL");
  }
  if (analysis.uses_mcp) {
    warnings.push("references MCP tools — not built-in unless added as a capability");
  }
  if (analysis.uses_npx) {
    warnings.push("references npx — use skill_manage import_url / skill_bulk_save instead of CLI install");
  }
  return warnings;
}

export function compatNotesForView(
  analysis: SkillCompatAnalysis,
  source: string
): { compatibility_notes: string[]; compatibility_tier: CompatTier } | null {
  if (source === "bundled") return null;
  if (analysis.tier === "native") return null;
  const notes = [
    `Tier: ${analysis.tier} — follow the "${WEB_AGENT_EXECUTION_HEADING}" section in this skill.`,
    ...compatScanWarnings(analysis),
  ];
  if (analysis.uses_python) {
    notes.push("Python/pip steps require script-porting before run_shell");
  }
  return { compatibility_notes: notes, compatibility_tier: analysis.tier };
}
