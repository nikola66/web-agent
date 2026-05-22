/**
 * Read-only Python→Node porting guidance for Nodebox (not an auto-transpiler).
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { resolveWorkspacePath } from "../workspace-paths.js";

export const PORTING_CHECKLIST = [
  "Load the Python source (read_file, skill_view, or web_fetch raw URL).",
  "Call python_to_node for construct hints before writing JS.",
  "Port to ESM at scripts/<basename>.js under the skill folder.",
  "Replace SKILL.md CLI examples: python/pip → node scripts/….js.",
  "Verify with run_shell (node command, cwd at skill root, env for API tokens).",
  "Persist via skill_manage write_file; keep secrets in Settings/vault or run_shell env.",
];

export const PORTING_MAPPINGS: { python: string; node: string }[] = [
  { python: "requests.get/post", node: "fetch(url, { method, headers, body })" },
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
  { python: "pip install", node: "not available to the agent — port logic inline or use fetch" },
];

const HINT_RULES: { pattern: RegExp; hint: string }[] = [
  { pattern: /\bimport\s+requests\b|\bfrom\s+requests\b/, hint: "Uses requests → replace with fetch (JSON/text response handling)." },
  { pattern: /\bimport\s+argparse\b|\bArgumentParser\b/, hint: "Uses argparse → use process.argv or node:util parseArgs." },
  { pattern: /\bimport\s+os\b|\bos\.environ\b|\bos\.getenv\b/, hint: "Uses os.environ → process.env; pass tokens via run_shell `env` or Settings/vault." },
  { pattern: /\bimport\s+json\b/, hint: "Uses json module → JSON.parse / JSON.stringify." },
  { pattern: /\bimport\s+pathlib\b|\bfrom\s+pathlib\b|\bPath\s*\(/, hint: "Uses pathlib → node:path." },
  { pattern: /\bopen\s*\(/, hint: "Uses open() → node:fs/promises readFile/writeFile." },
  { pattern: /\bif\s+__name__\s*==\s*['\"]__main__['\"]/, hint: "Has __main__ guard → top-level async main().catch(...)." },
  { pattern: /\bimport\s+subprocess\b|\bsubprocess\./, hint: "Uses subprocess — not available in Nodebox; use fetch, file tools, or inline logic." },
  { pattern: /\bpip\s+install\b/, hint: "References pip install — port deps inline; agent cannot run pip (bootstrap may use npm internally)." },
  { pattern: /\bpython3?\s+-m\b/, hint: "CLI via python -m → node scripts/<module>.js with same args." },
  { pattern: /\burllib\b|\bhttpx\b|\baiohttp\b/, hint: "HTTP client library → use global fetch." },
  { pattern: /\bimport\s+sys\b|\bsys\.argv\b/, hint: "Uses sys.argv → process.argv (skip node + script path)." },
  { pattern: /\.env\b|load_dotenv/, hint: "Dotenv pattern → process.env or run_shell `env`; user sets keys in Settings/vault." },
  { pattern: /\bfrom\s+\.(\w+)\s+import\b|\bfrom\s+(\w+)\s+import\b/, hint: "Relative/package imports → ESM import paths under scripts/ (e.g. import { x } from './lib.js')." },
];

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
  return {
    checklist: PORTING_CHECKLIST,
    mappings: PORTING_MAPPINGS,
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
  if (filePath) {
    const abs = resolveWorkspacePath(ctx, filePath);
    const source = await fs.readFile(abs, "utf8");
    return analyzePythonSource(source, filePath);
  }
  const inline = typeof python === "string" ? python : "";
  if (!inline.trim()) {
    return {
      ...analyzePythonSource(""),
      note: "Provide `path` (workspace .py file) or `python` (source string) for snippet-specific hints.",
    };
  }
  return analyzePythonSource(inline);
}
