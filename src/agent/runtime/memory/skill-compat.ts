/**
 * Map external agent-host tool names (skills.sh / Claude Code) to Web Agent built-ins.
 */
import { extractTopLevelImports } from "../tools/python-preflight.js";

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
  uses_deploy_cli: boolean;
  uses_native_media: boolean;
  uses_python_http: boolean;
  uses_system_cli: boolean;
  uses_python_subprocess: boolean;
  uses_shell_scripts: boolean;
  python_libraries: string[];
  flags: string[];
};

export const WEB_AGENT_EXECUTION_HEADING = "## Web Agent execution (auto-appended)";

const COMPAT_SECTION_MARKER = /## Web Agent execution \(auto-appended\)/i;

const SYSTEM_CLI_PATTERN =
  /(?:^|`|\$\s*|run\s+|npx\s+|invoke\s+|execute\s+|requires\.bins[^\n]*\b)(?:aws|azd|az\s|terraform|bicep|docker|kubectl|duckdb|openclaw|osascript|mcporter|edirect|coder|bat\b|brew\s+install|apt\s+install|npm\s+run|curl\b|wget\b|gh\b|git\b|python3\b)(?:\s|`|$|,)/im;

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

function collectNestedMetaStrings(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNestedMetaStrings(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "bins" || k === "requires") collectNestedMetaStrings(v, out);
      else if (typeof v === "string" || Array.isArray(v)) collectNestedMetaStrings(v, out);
      else if (v && typeof v === "object") collectNestedMetaStrings(v, out);
    }
  }
  return out;
}

function metaHaystack(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(...listIncludes(meta, "allowed-tools"));
  parts.push(...listIncludes(meta, "requires-tools"));
  parts.push(...listIncludes(meta, "requires_tools"));
  if (typeof meta.compatibility === "string") parts.push(meta.compatibility);
  for (const key of ["openclaw", "clawdbot"]) {
    if (meta.metadata && typeof meta.metadata === "object") {
      collectNestedMetaStrings((meta.metadata as Record<string, unknown>)[key], parts);
    }
    collectNestedMetaStrings(meta[key], parts);
  }
  if (meta.requires && typeof meta.requires === "object") {
    collectNestedMetaStrings(meta.requires, parts);
  }
  if (meta.metadata && typeof meta.metadata === "object") {
    collectNestedMetaStrings(meta.metadata, parts);
  }
  return parts.join("\n");
}

function normalizePythonLibraryName(name: string): string {
  const lower = String(name || "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    bs4: "beautifulsoup4",
    beautifulsoup: "beautifulsoup4",
    pil: "pillow",
    dotenv: "dotenv",
  };
  return aliases[lower] || lower;
}

export function detectPythonLibraries(source: string): string[] {
  const text = String(source || "");
  const libs = new Set<string>();
  for (const imp of extractTopLevelImports(text)) {
    libs.add(normalizePythonLibraryName(imp));
  }
  if (/\bBeautifulSoup\b/.test(text)) libs.add("beautifulsoup4");
  if (/\bload_dotenv\b/.test(text)) libs.add("dotenv");
  if (/\bfeedparser\b/i.test(text)) libs.add("feedparser");
  if (/\bpyyaml\b/i.test(text)) libs.add("pyyaml");
  if (/\bwikipedia\b/i.test(text) && /\bpip\s+install\b|\bimport\s+wikipedia\b|\bfrom\s+wikipedia\b/i.test(text)) {
    libs.add("wikipedia");
  }
  if (/\bpip\s+install\b/.test(text)) libs.add("pip");
  if (/\bpython3?\s+-m\b/.test(text)) libs.add("python-module-cli");
  return [...libs].sort();
}

export function analyzeSkillCompat(
  text: string,
  meta: Record<string, unknown> = {}
): SkillCompatAnalysis {
  const body = skillSourceForCompatAnalysis(String(text || ""));
  const metaText = metaHaystack(meta);
  const allowed = listIncludes(meta, "allowed-tools");
  const requires = listIncludes(meta, "requires-tools").concat(
    listIncludes(meta, "requires_tools")
  );
  const toolText = [...allowed, ...requires, metaText].join(" ").toLowerCase();
  const toolNames = [...allowed, ...requires].map((t) => String(t).trim().toLowerCase());
  const hay = `${body}\n${metaText}\n${toolText}`;

  const uses_web_fetch = /\bWebFetch\b|\bweb_fetch\b(?!\s*\/)/i.test(hay);
  const uses_system_cli =
    SYSTEM_CLI_PATTERN.test(hay) ||
    /\baws\s+(?:cli|s3|iam|ec2|lambda|cloudformation)\b/i.test(hay) ||
    /\b(?:azd|openclaw|mcporter|duckdb|kubectl|docker|terraform)\b/i.test(hay);
  const uses_bash =
    /\bbash\s*\(/i.test(hay) ||
    toolNames.some((t) => t === "bash" || t.startsWith("bash(")) ||
    /\ballowed-tools:[^\n]*\bBash\b/i.test(body) ||
    /\brequires-tools:[^\n]*\bBash\b/i.test(body) ||
    /`(?:azd|az|terraform|bicep)(?:\s|`)|\b(?:azd|terraform|bicep)\s+(?:up|deploy|provision|validate|build|plan|apply)\b|\baz\s+(?:deployment|cognitiveservices|search)\b/i.test(hay) ||
    uses_system_cli;
  const python_libraries = detectPythonLibraries(hay);
  const uses_python =
    /\b(pip install|python3?\s+(?:-|[\w./])|python\s+-m|python script|\.py\b|pdftotext|qpdf)\b/i.test(hay) ||
    python_libraries.length > 0;
  const uses_playwright =
    /\b(npx\s+)?playwright\s+(test|install|codegen|open)\b/i.test(hay) ||
    /\b(?:use|using|run|with)\s+Playwright\b/i.test(hay) ||
    /\b@playwright\/test\b|\bfrom\s+["']playwright["']|\bpuppeteer\.(launch|connect)\b/i.test(hay) ||
    toolNames.some((t) => t.includes("playwright") || t.includes("puppeteer"));
  const uses_agent_browser = /\bagent-browser\b/i.test(hay);
  const uses_mcp =
    /\bCallMcpTool\b|\bMCP\b|\bmcp_[a-z]|\bazure__[a-z]/i.test(hay) ||
    toolNames.some((t) => t.includes("mcp"));
  const uses_npx = /\bnpx\s+(?!skills\b)/i.test(hay);
  const uses_deploy_cli = /(?:^|`|\$\s*|run\s+|npx\s+|invoke\s+|execute\s+)(?:vercel|netlify|flyctl|fly\s+deploy|railway\s+(?:up|deploy|run)|heroku\s+\w|gh\s+(?:pr|issue|release|repo)|stripe\s+\w|firecrawl\s+\w)(?:\s|`|$)/im.test(hay);
  const uses_native_media = /\b(?:ffmpeg|ffprobe|whisper|tesseract|pdftoppm|pdftotext|ghostscript|imagemagick|convert\s+-\w)\b/i.test(hay);
  const uses_python_http =
    /\burllib\.request\b|\bimport\s+requests\b|\bfrom\s+requests\b|\bimport\s+httpx\b|\bfrom\s+httpx\b/i.test(body);
  const uses_python_subprocess = /\bsubprocess\b|\bos\.system\b|\bos\.popen\b/i.test(hay);
  const uses_shell_scripts =
    /(?:^|\s)(?:\.\/)?scripts\/[^\s`]+\.sh\b|`[^`]+\.sh`|^#!\/(?:usr\/)?bin\/(?:ba)?sh/im.test(hay);

  const flags: string[] = [];
  if (uses_web_fetch) flags.push("web_fetch_mapping");
  if (uses_bash) flags.push("bash_shell");
  if (uses_system_cli) flags.push("system_cli_unavailable");
  if (uses_python) flags.push("python_runtime");
  if (uses_python_subprocess) flags.push("python_subprocess");
  if (uses_shell_scripts) flags.push("shell_scripts");
  if (uses_playwright) flags.push("playwright_unavailable");
  if (uses_agent_browser) flags.push("agent_browser_unavailable");
  if (uses_mcp) flags.push("mcp_requires_config");
  if (uses_npx) flags.push("npx_unavailable");
  if (uses_deploy_cli) flags.push("deploy_cli_unavailable");
  if (uses_native_media) flags.push("native_media_unavailable");
  if (uses_python_http) flags.push("python_http_mapping");

  let tier: CompatTier = "native";
  if (uses_agent_browser || uses_playwright) tier = "unsupported";
  else if (
    uses_python ||
    uses_mcp ||
    uses_bash ||
    uses_npx ||
    uses_deploy_cli ||
    uses_native_media ||
    uses_python_subprocess ||
    uses_shell_scripts
  ) tier = "limited";
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
    uses_deploy_cli,
    uses_native_media,
    uses_python_http,
    uses_system_cli,
    uses_python_subprocess,
    uses_shell_scripts,
    python_libraries,
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
    "| WebFetch / fetch URL | `web_fetch` `{ url, headers? }` — binary → `save_to` |",
    "| POST / GraphQL / PATCH / PUT / DELETE | `web_post` — optional `method`; not for CMS file bytes — **`http-api`** |",
    "| CMS file upload (`/files`, featured image) | `web_upload` with `source_url` or `file_path` — never base64 — **`http-api`** |",
    "| Mixed multipart (fields + file) | `web_post` `{ multipart: [{ name, text? }, { name, file_path?|source_url? }] }` — **`http-api`** |",
    "| Read / Glob / Grep | `read_file` / `list_dir` / `find_files` / `grep` |",
    "| Skill / Read skill | `skill_view` `{ name }` |",
    "| Bash / curl / npx | `skill_view` **`browser-runtime-map`** — Nodebox has no POSIX shell |",
    "| Python / `.py` | `run_python` for Pyodide-compatible scripts |",
    "| pip / native Python deps | Unsupported as system installs — use Pyodide packages if available or replace the native dependency step |",
  ];

  if (analysis.uses_agent_browser || analysis.uses_playwright) {
    lines.push(
      "| agent-browser / Playwright / Selenium | **Not available** — Chromium cannot run inside browser sandbox; use `web_fetch` + source inspection |"
    );
  }
  if (analysis.uses_mcp) {
    lines.push("| MCP / CallMcpTool | Configure via `/mcp add` or `.webagent/mcp-servers.json`, then `/reload-mcp` |");
  }
  if (analysis.uses_system_cli || analysis.uses_bash) {
    lines.push("| aws / az / azd / terraform / docker / kubectl / openclaw CLI | **Not available** — use that service's REST API via `web_fetch`/`web_post`; see **`browser-runtime-map`** CLI→REST table |");
  }
  if (analysis.uses_deploy_cli) {
    lines.push("| vercel / netlify / gh / fly / railway / heroku CLI | **Not available** — use that service's REST API via `web_fetch`/`web_post` |");
  }
  if (analysis.uses_native_media) {
    lines.push("| ffmpeg / whisper / tesseract / pdftoppm / ghostscript | **Not available** — call a hosted transcoding/OCR API, or use pure-Python alternatives (`pypdf`, `Pillow`, `imageio`) |");
  }
  if (analysis.uses_python_http) {
    lines.push("| Python HTTP (`urllib`, `requests`) | `webagent.http` inside `run_python`, or `web_fetch`/`web_post` for REST/CMS — **`http-api`** |");
  }
  if (analysis.python_libraries.includes("feedparser")) {
    lines.push("| RSS / feedparser scripts | `run_python` with micropip `feedparser`, or fetch RSS XML via `web_fetch` and parse with stdlib `xml.etree` |");
  }
  if (analysis.python_libraries.includes("wikipedia")) {
    lines.push("| `wikipedia` Python module | Wikipedia REST API via `web_fetch` (`https://en.wikipedia.org/api/rest_v1/…`) |");
  }
  if (/\bwp-json\b|\bWordPress REST\b|\bwp_publisher\b/i.test(analysis.flags.join(" ") + analysis.python_libraries.join(" "))) {
    lines.push("| WordPress REST publisher | `web_post` to `/wp-json/wp/v2/*` with Basic auth — **`http-api`** |");
  }
  if (analysis.uses_python_subprocess || analysis.flags.includes("shell_scripts")) {
    lines.push("| subprocess / git / `.sh` scripts | **Not available** in Pyodide — use built-in `memory_*`/`session_*` tools instead of git-notes, or rewrite shell steps as `run_python`/`web_fetch` |");
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
  if (analysis.uses_system_cli) {
    warnings.push("references system CLI tools (aws/az/docker/kubectl/openclaw/etc.) — use REST APIs via web_fetch/web_post");
  }
  if (analysis.uses_shell_scripts) {
    warnings.push("references shell scripts (.sh) — not runnable in Nodebox; rewrite as run_python or web_fetch/web_post");
  }
  if (analysis.uses_python_subprocess) {
    warnings.push("references Python subprocess/os.system — blocked in Pyodide; use built-in tools or web_fetch/web_post");
  }
  if (analysis.uses_web_fetch) {
    warnings.push("references WebFetch — use web_fetch with the same URL");
  }
  if (analysis.uses_python) {
    const libs = analysis.python_libraries.length
      ? ` (${analysis.python_libraries.slice(0, 8).join(", ")})`
      : "";
    warnings.push(`contains Python/pip references${libs} — use run_python for Pyodide-compatible scripts; no system pip/native deps`);
  }
  if (analysis.uses_mcp) {
    warnings.push("references MCP tools — configure servers with /mcp add or .webagent/mcp-servers.json, then /reload-mcp");
  }
  if (analysis.uses_npx) {
    warnings.push("references npx — use skill_manage import_url / skill_bulk_save instead of CLI install");
  }
  if (analysis.uses_deploy_cli) {
    warnings.push("references deploy/infra CLI (vercel/netlify/gh/fly/railway/heroku) — use that service's REST API via web_fetch/web_post instead");
  }
  if (analysis.uses_native_media) {
    warnings.push("references native media/codec binaries (ffmpeg/whisper/tesseract/ghostscript) — call a hosted API or use pure-Python alternatives (pypdf, Pillow, imageio)");
  }
  if (analysis.uses_python_http) {
    warnings.push("references Python HTTP clients — use webagent.http in run_python or web_fetch/web_post for REST/CMS calls");
  }
  return warnings;
}

export function compatNotesForView(
  analysis: SkillCompatAnalysis,
  source: string,
  scriptWarnings: string[] = []
): { compatibility_notes: string[]; compatibility_tier: CompatTier; script_warnings?: string[] } | null {
  if (source === "bundled") return null;
  if (analysis.tier === "native" && scriptWarnings.length === 0) return null;
  const notes = [
    `Tier: ${analysis.tier} — follow the "${WEB_AGENT_EXECUTION_HEADING}" section in this skill.`,
    ...compatScanWarnings(analysis),
  ];
  const out: { compatibility_notes: string[]; compatibility_tier: CompatTier; script_warnings?: string[] } = {
    compatibility_notes: notes,
    compatibility_tier: analysis.tier,
  };
  if (scriptWarnings.length) out.script_warnings = scriptWarnings;
  return out;
}
