/**
 * Read-only Python→Node porting guidance for Nodebox (not an auto-transpiler).
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { resolveWorkspacePath } from "../workspace-paths.js";

export const PORTING_CHECKLIST = [
  "Load the Python source (read_file, skill_view, or web_fetch raw URL).",
  "Call python_to_node for construct hints before writing JS.",
  "Map HTTP: requests.get → web_fetch (+ headers); requests.post/GraphQL → web_post.",
  "Port non-HTTP logic to ESM at scripts/<basename>.js under the skill folder.",
  "Replace SKILL.md CLI examples: python/pip → node scripts/….js or web_fetch/web_post.",
  "Verify local scripts with run_shell (node command, cwd, env); verify API calls with web_fetch/web_post.",
  "Persist via skill_manage write_file; keep secrets in Settings/vault or tool headers/env.",
];

export const HTTP_TOOL_ROUTING = {
  get: "web_fetch",
  post: "web_post",
  skill_ref: "http-api",
  note: "Call skill_view http-api for REST/GraphQL shapes; do not port requests.get/post to run_shell axios one-liners.",
};

export const PORTING_MAPPINGS: { python: string; node: string }[] = [
  { python: "requests.get", node: "web_fetch({ url, headers: { Authorization: 'Bearer …' } })" },
  { python: "requests.post / GraphQL", node: "web_post({ url, headers, body })" },
  { python: "requests (generic)", node: "web_fetch (GET) or web_post (POST) — not run_shell axios" },
  { python: "argparse / sys.argv", node: "process.argv or node:util parseArgs" },
  { python: "os.environ / os.getenv", node: "process.env (or run_shell env for this run)" },
  { python: "json.loads / json.dumps", node: "JSON.parse / JSON.stringify" },
  { python: "pathlib.Path", node: "node:path (join, dirname, basename)" },
  { python: "open(path).read()", node: "node:fs/promises readFile" },
  { python: "if __name__ == '__main__'", node: "async main().catch(...) at top level" },
  { python: "print(x)", node: "console.log(x)" },
  { python: "None", node: "null" },
  { python: "True / False", node: "true / false" },
  { python: "dict/list comprehensions", node: "array map/filter/reduce" },
  { python: "subprocess / shell", node: "not available in Nodebox scripts — use fetch or tools" },
  { python: "python -m scripts.foo", node: "node scripts/foo.js (port the module first)" },
  { python: "zipfile.ZipFile", node: "manual .skill packaging or deliver folder via artifact_present; no stdlib zip writer" },
  { python: "http.server / HTTPServer", node: "write standalone HTML (--static pattern) + artifact_present" },
  { python: "webbrowser.open", node: "artifact_present or inline markdown review; no browser launch in Nodebox" },
  { python: "ProcessPoolExecutor / claude -p", node: "unsupported — use Task subagents or manual skill_view review loops" },
  { python: "pip install", node: "not available to the agent — port logic inline or use fetch" },
  { python: "httpx / aiohttp / urllib", node: "web_fetch/web_post for tool calls, or global fetch in ESM scripts" },
  { python: "BeautifulSoup / bs4", node: "web_fetch + simple text/link extraction helpers; no full DOM parser by default" },
  { python: "csv", node: "node:fs/promises + small parse/stringify helpers for simple CSV" },
  { python: "glob", node: "node:fs/promises readdir recursive walk + RegExp/endsWith filters" },
  { python: "shutil.copyfile / move", node: "node:fs/promises copyFile / rename" },
  { python: "logging", node: "console.error / console.log with small level wrapper" },
  { python: "datetime / time", node: "Date, Intl.DateTimeFormat, performance.now" },
  { python: "pandas / numpy", node: "manual redesign or CSV/JSON streaming helpers; do not bundle heavy equivalents" },
  { python: "selenium / playwright", node: "manual redesign around Web Agent web tools; browser automation is not a Nodebox script port" },
];

const CACHE_REL = ".webagent/python-porting-cache.json";
const CACHE_VERSION = 1;
const CACHE_LIMIT = 50;

type CompatibilityTier = "direct" | "template" | "manual" | "unsupported";

type LibraryRecipe = {
  library: string;
  tier: CompatibilityTier;
  replacement: string;
  notes: string;
  tool?: string;
};

const LIBRARY_RECIPES: LibraryRecipe[] = [
  { library: "requests", tier: "template", replacement: "web_fetch/web_post or global fetch", notes: "Route simple GET/POST through Web Agent tools; use fetch only inside reusable scripts.", tool: "web_fetch" },
  { library: "httpx", tier: "template", replacement: "web_fetch/web_post or global fetch", notes: "Async client features collapse to fetch plus explicit status checks.", tool: "web_fetch" },
  { library: "aiohttp", tier: "template", replacement: "web_fetch/web_post or global fetch", notes: "Use fetch promises; avoid porting session pools unless the task needs them.", tool: "web_fetch" },
  { library: "urllib", tier: "template", replacement: "web_fetch/web_post or global fetch", notes: "Map URL reads to fetch and parse text/json explicitly.", tool: "web_fetch" },
  { library: "beautifulsoup4", tier: "template", replacement: "web_fetch + simple extraction helpers", notes: "Good for links/text/title extraction; complex CSS selectors need manual redesign." },
  { library: "bs4", tier: "template", replacement: "web_fetch + simple extraction helpers", notes: "Alias for BeautifulSoup; no full DOM parser is bundled." },
  { library: "argparse", tier: "direct", replacement: "node:util parseArgs", notes: "Use parseArgs for flags/options and process.argv for positional args." },
  { library: "sys", tier: "direct", replacement: "process.argv / process.exit", notes: "Skip argv[0] and argv[1] for user args." },
  { library: "dotenv", tier: "direct", replacement: "process.env / run_shell env", notes: "Do not read .env secrets from skills; pass env through Settings/vault or tool env." },
  { library: "os", tier: "direct", replacement: "process.env and node:os where needed", notes: "Most skill ports only need env vars and paths." },
  { library: "json", tier: "direct", replacement: "JSON.parse / JSON.stringify", notes: "Use explicit try/catch for invalid JSON." },
  { library: "csv", tier: "template", replacement: "small CSV helpers + node:fs/promises", notes: "Suitable for simple comma CSV; quoted/newline-heavy CSV needs manual handling." },
  { library: "pathlib", tier: "direct", replacement: "node:path", notes: "Use path.join, dirname, basename, extname." },
  { library: "glob", tier: "template", replacement: "recursive readdir helper", notes: "Use a small walk function plus suffix/regex filters." },
  { library: "shutil", tier: "direct", replacement: "node:fs/promises copyFile, rename, rm", notes: "Use Web Agent file tools for broad workspace mutations when possible." },
  { library: "logging", tier: "direct", replacement: "console.log / console.error", notes: "Keep CLI output parseable; log diagnostics to stderr." },
  { library: "time", tier: "direct", replacement: "Date.now / performance.now / setTimeout", notes: "Use Date for wall-clock, performance.now for duration." },
  { library: "datetime", tier: "direct", replacement: "Date / Intl.DateTimeFormat", notes: "Timezone-heavy code needs explicit UTC handling." },
  { library: "subprocess", tier: "unsupported", replacement: "Web Agent tools or inline JS", notes: "Nodebox scripts cannot shell out; redesign the step around tools/fetch/files." },
  { library: "pandas", tier: "manual", replacement: "CSV/JSON streaming helpers or artifact output", notes: "Port only the needed transformation; no bundled DataFrame equivalent." },
  { library: "numpy", tier: "manual", replacement: "plain arrays or manual numeric helper", notes: "Small numeric loops are fine; vectorized/scientific code needs redesign." },
  { library: "matplotlib", tier: "manual", replacement: "Mermaid/markdown/table artifact or inline SVG", notes: "Generate an artifact instead of reproducing pyplot." },
  { library: "selenium", tier: "manual", replacement: "Web Agent web tools or dedicated browser capability", notes: "Browser automation is not a Nodebox script port." },
  { library: "playwright", tier: "manual", replacement: "Web Agent web tools or dedicated browser capability", notes: "Do not assume Playwright is installed in Nodebox skills." },
  { library: "zipfile", tier: "manual", replacement: "folder tree + artifact_present, or inline zip helper", notes: "Node has no stdlib zip writer; .skill packaging may be skipped or ported with a small helper." },
  { library: "fnmatch", tier: "template", replacement: "RegExp or simple glob suffix match", notes: "Map fnmatch patterns to endsWith/includes or minimatch-style logic." },
  { library: "math", tier: "direct", replacement: "Math.*", notes: "sqrt, floor, etc. map directly." },
  { library: "random", tier: "direct", replacement: "Math.random (seed manually if needed)", notes: "Stratified splits need an explicit seed for reproducibility." },
  { library: "tempfile", tier: "direct", replacement: "fs.mkdtemp / os.tmpdir", notes: "Use node:fs/promises mkdtemp for temp dirs." },
  { library: "uuid", tier: "direct", replacement: "crypto.randomUUID()", notes: "Import from node:crypto." },
  { library: "webbrowser", tier: "unsupported", replacement: "artifact_present / static HTML file", notes: "Cannot open a local browser from Nodebox; write HTML and present it." },
  { library: "concurrent", tier: "unsupported", replacement: "Promise.all or sequential Task subagents", notes: "ProcessPoolExecutor and claude -p subprocess pools are not available." },
  { library: "http", tier: "manual", replacement: "static HTML embed + artifact_present", notes: "Port generate_review.py --static instead of HTTPServer + webbrowser." },
  { library: "mimetypes", tier: "direct", replacement: "path.extname + small MIME map", notes: "Use a lookup table for common extensions." },
  { library: "base64", tier: "direct", replacement: "Buffer.from(...).toString('base64')", notes: "Node Buffer replaces Python base64 module for embeds." },
  { library: "signal", tier: "unsupported", replacement: "process.on('SIGINT') or skip", notes: "lsof/kill port cleanup is host-only; prefer --static output." },
];

const TEMPLATE_SNIPPETS = {
  fetch_json: [
    "async function fetchJson(url, headers = {}) {",
    "  const res = await fetch(url, { headers });",
    "  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);",
    "  return await res.json();",
    "}",
  ].join("\n"),
  post_json: [
    "async function postJson(url, body, headers = {}) {",
    "  const res = await fetch(url, {",
    "    method: 'POST',",
    "    headers: { 'Content-Type': 'application/json', ...headers },",
    "    body: JSON.stringify(body),",
    "  });",
    "  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);",
    "  return await res.json();",
    "}",
  ].join("\n"),
  parse_args: [
    "import { parseArgs } from 'node:util';",
    "const { values, positionals } = parseArgs({",
    "  args: process.argv.slice(2),",
    "  options: { dryRun: { type: 'boolean' } },",
    "  allowPositionals: true,",
    "});",
  ].join("\n"),
  require_env: [
    "function requireEnv(name) {",
    "  const value = process.env[name];",
    "  if (!value) throw new Error(`Missing required env var ${name}`);",
    "  return value;",
    "}",
  ].join("\n"),
  extract_links: [
    "function extractLinks(html) {",
    "  return [...String(html).matchAll(/<a\\s+[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)<\\/a>/gis)]",
    "    .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }));",
    "}",
  ].join("\n"),
  simple_csv: [
    "function parseSimpleCsv(text) {",
    "  const [headerLine, ...rows] = String(text).trim().split(/\\r?\\n/);",
    "  const headers = headerLine.split(',').map((h) => h.trim());",
    "  return rows.map((row) => Object.fromEntries(row.split(',').map((v, i) => [headers[i], v.trim()])));",
    "}",
  ].join("\n"),
  walk_files: [
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "async function walk(dir) {",
    "  const entries = await fs.readdir(dir, { withFileTypes: true });",
    "  const nested = await Promise.all(entries.map((entry) => {",
    "    const p = path.join(dir, entry.name);",
    "    return entry.isDirectory() ? walk(p) : p;",
    "  }));",
    "  return nested.flat();",
    "}",
  ].join("\n"),
  mkdtemp: [
    "import fs from 'node:fs/promises';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-'));",
  ].join("\n"),
  stats_mean_stddev: [
    "function stats(values) {",
    "  if (!values.length) return { mean: 0, stddev: 0, min: 0, max: 0 };",
    "  const mean = values.reduce((a, b) => a + b, 0) / values.length;",
    "  const variance = values.length > 1",
    "    ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1)",
    "    : 0;",
    "  return { mean, stddev: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) };",
    "}",
  ].join("\n"),
};

const HINT_RULES: { pattern: RegExp; hint: string }[] = [
  { pattern: /\bimport\s+requests\b|\bfrom\s+requests\b/, hint: "Uses requests → skill_view http-api; web_fetch for GET, web_post for POST/GraphQL (headers for Bearer)." },
  { pattern: /\brequests\.get\b/, hint: "requests.get → web_fetch with url + headers (not run_shell axios)." },
  { pattern: /\brequests\.post\b/, hint: "requests.post → web_post with url, headers, body." },
  { pattern: /\brequire\s*\(\s*['"]axios['"]\)|\bimport\s+axios\b|\bfrom\s+['"]axios['"]/, hint: "axios is unavailable — use web_fetch/web_post instead of run_shell HTTP one-liners." },
  { pattern: /\bimport\s+argparse\b|\bArgumentParser\b/, hint: "Uses argparse → use process.argv or node:util parseArgs." },
  { pattern: /\bimport\s+os\b|\bos\.environ\b|\bos\.getenv\b/, hint: "Uses os.environ → process.env; pass tokens via run_shell `env` or Settings/vault." },
  { pattern: /\bimport\s+json\b/, hint: "Uses json module → JSON.parse / JSON.stringify." },
  { pattern: /\bimport\s+pathlib\b|\bfrom\s+pathlib\b|\bPath\s*\(/, hint: "Uses pathlib → node:path." },
  { pattern: /\bopen\s*\(/, hint: "Uses open() → node:fs/promises readFile/writeFile." },
  { pattern: /\bif\s+__name__\s*==\s*['\"]__main__['\"]/, hint: "Has __main__ guard → top-level async main().catch(...)." },
  { pattern: /\bimport\s+subprocess\b|\bsubprocess\./, hint: "Uses subprocess — not available in Nodebox; use fetch, file tools, or inline logic." },
  { pattern: /\bpip\s+install\b/, hint: "References pip install — port deps inline; agent cannot run pip (bootstrap may use npm internally)." },
  { pattern: /\bpython3?\s+-m\b/, hint: "CLI via python -m → node scripts/<module>.js with same args." },
  { pattern: /\burllib\b|\bhttpx\b|\baiohttp\b/, hint: "HTTP client library → web_fetch (GET) or web_post (POST/GraphQL)." },
  { pattern: /\bBeautifulSoup\b|\bbs4\b/, hint: "BeautifulSoup/bs4 → web_fetch plus simple text/link extraction helpers; full DOM selectors need manual redesign." },
  { pattern: /\bimport\s+csv\b|\bfrom\s+csv\b/, hint: "csv module → node:fs/promises plus small CSV parse/stringify helpers for simple CSV." },
  { pattern: /\bimport\s+glob\b|\bglob\.glob\b/, hint: "glob → recursive node:fs/promises readdir helper plus suffix/regex filters." },
  { pattern: /\bimport\s+shutil\b|\bshutil\./, hint: "shutil → node:fs/promises copyFile, rename, rm; prefer Web Agent file tools for broad workspace edits." },
  { pattern: /\bimport\s+logging\b|\blogging\./, hint: "logging → console.log/console.error or a tiny level wrapper." },
  { pattern: /\bimport\s+(?:time|datetime)\b|\bfrom\s+datetime\b/, hint: "time/datetime → Date, Intl.DateTimeFormat, Date.now, or performance.now." },
  { pattern: /\bimport\s+pandas\b|\bfrom\s+pandas\b|\bpd\./, hint: "pandas → manual redesign; port only needed CSV/JSON transforms, no bundled DataFrame equivalent." },
  { pattern: /\bimport\s+numpy\b|\bfrom\s+numpy\b|\bnp\./, hint: "numpy → manual redesign with arrays for small numeric logic; scientific/vectorized code is not a direct Nodebox port." },
  { pattern: /\bselenium\b|\bplaywright\b/, hint: "selenium/playwright → manual redesign around Web Agent web tools; do not assume browser automation packages in Nodebox." },
  { pattern: /\bimport\s+sys\b|\bsys\.argv\b/, hint: "Uses sys.argv → process.argv (skip node + script path)." },
  { pattern: /\.env\b|load_dotenv/, hint: "Dotenv pattern → process.env or run_shell `env`; user sets keys in Settings/vault." },
  { pattern: /\bfrom\s+\.(\w+)\s+import\b|\bfrom\s+(\w+)\s+import\b/, hint: "Relative/package imports → ESM import paths under scripts/ (e.g. import { x } from './lib.js')." },
  { pattern: /\bpython3?\s+-m\s+scripts\./, hint: "python -m scripts.foo → node scripts/foo.js after porting (ESM top-level main)." },
  { pattern: /\bProcessPoolExecutor\b|\bconcurrent\.futures\b/, hint: "ProcessPoolExecutor — not available; use Promise.all, sequential runs, or Task subagents." },
  { pattern: /\bclaude\b\s+-p\b|\[\s*["']claude["']\s*,\s*["']-p["']/, hint: "claude -p trigger eval — not available in Web Agent; use skill_view + manual review or description tuning inline." },
  { pattern: /\bHTTPServer\b|\bhttp\.server\b|\bBaseHTTPRequestHandler\b/, hint: "http.server viewer — port to --static HTML embed + artifact_present instead of a local server." },
  { pattern: /\bwebbrowser\.open\b/, hint: "webbrowser.open — use artifact_present or write static HTML; cannot launch a browser from Nodebox." },
  { pattern: /\bimport\s+zipfile\b|\bZipFile\s*\(/, hint: "zipfile — manual port or skip .skill packaging; deliver folder tree via artifact_present." },
  { pattern: /\bimport\s+fnmatch\b|\bfnmatch\.fnmatch\b/, hint: "fnmatch → RegExp or suffix/glob match on filenames." },
  { pattern: /\bimport\s+math\b|\bmath\.(sqrt|floor|ceil)\b/, hint: "math → Math.sqrt / Math.floor / Math.ceil." },
  { pattern: /\bimport\s+uuid\b|\buuid\.uuid4\b/, hint: "uuid → crypto.randomUUID() from node:crypto." },
  { pattern: /\bimport\s+tempfile\b|\btempfile\./, hint: "tempfile → fs.mkdtemp under os.tmpdir()." },
  { pattern: /\bimport\s+base64\b|\bbase64\.b64encode\b/, hint: "base64 → Buffer.from(bytes).toString('base64')." },
];

function normalizeLibraryName(name: string): string {
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
  const libs = new Set<string>();
  const text = String(source || "");
  for (const m of text.matchAll(/^\s*import\s+([^\n#]+)/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/i)[0]?.split(".")[0];
      if (/^[A-Za-z_]\w*$/.test(name || "")) libs.add(normalizeLibraryName(name));
    }
  }
  for (const m of text.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/gm)) {
    libs.add(normalizeLibraryName(m[1].split(".")[0]));
  }
  if (/\bBeautifulSoup\b/.test(text)) libs.add("beautifulsoup4");
  if (/\bload_dotenv\b/.test(text)) libs.add("dotenv");
  if (/\bimport\s+zipfile\b|\bZipFile\s*\(/.test(text)) libs.add("zipfile");
  if (/\bimport\s+fnmatch\b|\bfnmatch\./.test(text)) libs.add("fnmatch");
  if (/\bimport\s+math\b|\bmath\./.test(text)) libs.add("math");
  if (/\bimport\s+random\b|\brandom\./.test(text)) libs.add("random");
  if (/\bimport\s+tempfile\b|\btempfile\./.test(text)) libs.add("tempfile");
  if (/\bimport\s+uuid\b|\buuid\./.test(text)) libs.add("uuid");
  if (/\bimport\s+webbrowser\b|\bwebbrowser\./.test(text)) libs.add("webbrowser");
  if (/\bimport\s+http\b|\bHTTPServer\b|\bhttp\.server\b/.test(text)) libs.add("http");
  if (/\bimport\s+base64\b|\bbase64\./.test(text)) libs.add("base64");
  if (/\bimport\s+mimetypes\b|\bmimetypes\./.test(text)) libs.add("mimetypes");
  if (/\bProcessPoolExecutor\b|\bconcurrent\.futures\b/.test(text)) libs.add("concurrent");
  if (/\[\s*["']claude["']\s*,\s*["']-p["']/.test(text)) libs.add("claude-cli");
  if (/\bimport\s+signal\b|\bsignal\./.test(text)) libs.add("signal");
  if (/\bpip\s+install\b/.test(text)) libs.add("pip");
  if (/\bpython3?\s+-m\b/.test(text)) libs.add("python-module-cli");
  return [...libs].sort();
}

function tierRank(tier: CompatibilityTier): number {
  return { direct: 0, template: 1, manual: 2, unsupported: 3 }[tier] ?? 0;
}

function recipesForLibraries(libraries: string[]): LibraryRecipe[] {
  const byLibrary = new Map(LIBRARY_RECIPES.map((recipe) => [recipe.library, recipe]));
  return libraries.map((library) => {
    if (library === "pip" || library === "python-module-cli") {
      return {
        library,
        tier: "unsupported" as CompatibilityTier,
        replacement: "node scripts/<name>.js or Web Agent tools",
        notes: "Do not run Python/pip in Nodebox; port the referenced script or replace the step with dedicated tools.",
      };
    }
    if (library === "claude-cli") {
      return {
        library,
        tier: "unsupported" as CompatibilityTier,
        replacement: "manual skill_view review loops",
        notes: "claude -p subprocess eval is Claude Code only; not available in Web Agent.",
      };
    }
    return byLibrary.get(library) || {
      library,
      tier: "manual" as CompatibilityTier,
      replacement: "manual ESM port",
      notes: "No dedicated recipe yet; inspect the call sites and port only the behavior actually used.",
    };
  });
}

function compatibilityTier(recipes: LibraryRecipe[], hasSource: boolean): CompatibilityTier {
  if (!hasSource || !recipes.length) return "direct";
  return recipes.reduce<CompatibilityTier>(
    (tier, recipe) => (tierRank(recipe.tier) > tierRank(tier) ? recipe.tier : tier),
    "direct"
  );
}

function templateNamesForLibraries(libraries: string[]): string[] {
  const names = new Set<string>();
  if (libraries.some((lib) => ["requests", "httpx", "aiohttp", "urllib"].includes(lib))) {
    names.add("fetch_json");
    names.add("post_json");
  }
  if (libraries.includes("argparse")) names.add("parse_args");
  if (libraries.some((lib) => ["os", "dotenv"].includes(lib))) names.add("require_env");
  if (libraries.includes("beautifulsoup4")) names.add("extract_links");
  if (libraries.includes("csv")) names.add("simple_csv");
  if (libraries.includes("glob")) names.add("walk_files");
  if (libraries.some((lib) => ["math"].includes(lib))) names.add("stats_mean_stddev");
  if (libraries.some((lib) => ["tempfile", "random"].includes(lib))) names.add("mkdtemp");
  return [...names];
}

function buildTemplates(libraries: string[]) {
  return templateNamesForLibraries(libraries).map((name) => ({
    name,
    code: TEMPLATE_SNIPPETS[name as keyof typeof TEMPLATE_SNIPPETS],
  }));
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cachePath(): string {
  return workspaceStatePath(CACHE_REL);
}

async function loadPortingCache(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function savePortingCache(cache: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(cache).slice(-CACHE_LIMIT);
  await fs.mkdir(nodePath.dirname(cachePath()), { recursive: true });
  await fs.writeFile(cachePath(), JSON.stringify(Object.fromEntries(entries), null, 2), "utf8");
}

function extractPythonEnvVars(source: string): string[] {
  const vars = new Set<string>();
  const text = String(source || "");
  for (const m of text.matchAll(/os\.getenv\s*\(\s*['"]([^'"]+)['"]/g)) vars.add(m[1]);
  for (const m of text.matchAll(/os\.environ\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) vars.add(m[1]);
  for (const m of text.matchAll(/os\.environ\.get\s*\(\s*['"]([^'"]+)['"]/g)) vars.add(m[1]);
  for (const m of text.matchAll(/environ\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) vars.add(m[1]);
  return [...vars].sort();
}

function suggestScriptRel(source: string, filePath?: string): string {
  if (filePath) {
    const base = nodePath.basename(filePath, nodePath.extname(filePath));
    if (filePath.replace(/\\/g, "/").includes("/scripts/")) return `scripts/${base}.js`;
    return `scripts/${base}.js`;
  }
  const shebang = source.match(/^#!.*python[^\n]*\s+(\S+\.py)/m);
  if (shebang) {
    const base = nodePath.basename(shebang[1], ".py");
    return `scripts/${base}.js`;
  }
  return "scripts/<basename>.js";
}

function suggestCwd(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const norm = filePath.replace(/\\/g, "/");
  const scriptsIdx = norm.indexOf("/scripts/");
  if (scriptsIdx >= 0) return norm.slice(0, scriptsIdx);
  const dir = nodePath.posix.dirname(norm);
  if (!dir || dir === ".") return undefined;
  return dir;
}

function buildRunShellExample(scriptRel: string, filePath?: string, envVars: string[] = []) {
  const cwd = suggestCwd(filePath);
  const example: Record<string, unknown> = {
    command: `node ${scriptRel}`,
  };
  if (cwd) example.cwd = cwd;
  if (envVars.length) {
    example.env = Object.fromEntries(envVars.map((v) => [v, `<${v} from Settings/vault>`]));
  }
  return example;
}

function suggestRunCommand(source: string, filePath?: string): string {
  return buildRunShellExample(suggestScriptRel(source, filePath), filePath).command as string;
}

export function analyzePythonSource(source: string, filePath?: string) {
  const text = String(source || "");
  const cache_key = `py2node-v${CACHE_VERSION}-${stableHash(`${filePath || ""}\n${text}`)}`;
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const { pattern, hint } of HINT_RULES) {
    if (pattern.test(text) && !seen.has(hint)) {
      seen.add(hint);
      hints.push(hint);
    }
  }
  if (!hints.length && text.trim()) {
    hints.push("No special constructs detected — port line-by-line using the mappings table.");
  }
  const env_vars = extractPythonEnvVars(text);
  const script_rel = suggestScriptRel(text, filePath);
  const suggested_cwd = suggestCwd(filePath);
  const detected_libraries = detectPythonLibraries(text);
  const recipes = recipesForLibraries(detected_libraries);
  const unsupported = recipes.filter((recipe) => recipe.tier === "unsupported");
  return {
    checklist: PORTING_CHECKLIST,
    mappings: PORTING_MAPPINGS,
    http_routing: HTTP_TOOL_ROUTING,
    http_skill_ref: "http-api",
    cache_key,
    cache_hit: false,
    compatibility_tier: compatibilityTier(recipes, Boolean(text.trim())),
    detected_libraries,
    recipes,
    templates: buildTemplates(detected_libraries),
    unsupported,
    hints,
    env_vars,
    suggested_cwd: suggested_cwd ?? null,
    run_command_template: suggestRunCommand(text, filePath),
    run_shell_example: buildRunShellExample(script_rel, filePath, env_vars),
    skill_ref: "script-porting",
    source_lines: text ? text.split("\n").length : 0,
    ...(filePath ? { path: filePath } : {}),
  };
}

export async function pythonToNodeTool(
  { python, path: relPath }: { python?: string; path?: string } = {},
  ctx: { cwd?: string } | null = null
) {
  const filePath = typeof relPath === "string" ? relPath.trim() : "";
  async function analyzeWithCache(source: string, path?: string) {
    const fresh = analyzePythonSource(source, path);
    const cache = await loadPortingCache().catch(() => ({}));
    const cached = cache[fresh.cache_key] as Record<string, unknown> | undefined;
    if (cached && typeof cached === "object") {
      return { ...cached, cache_hit: true };
    }
    cache[fresh.cache_key] = fresh;
    await savePortingCache(cache).catch(() => {});
    return fresh;
  }
  if (filePath) {
    const abs = resolveWorkspacePath(ctx, filePath);
    const source = await fs.readFile(abs, "utf8");
    return analyzeWithCache(source, filePath);
  }
  const inline = typeof python === "string" ? python : "";
  if (!inline.trim()) {
    return {
      ...analyzePythonSource(""),
      note: "Provide `path` (workspace .py file) or `python` (source string) for snippet-specific hints.",
    };
  }
  return analyzeWithCache(inline);
}
