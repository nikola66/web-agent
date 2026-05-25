import fs from "node:fs/promises";
import {
  resolveWorkspacePath,
  shellCwd,
} from "../workspace-paths.js";
import { WS } from "../constants.js";
import { ipcPythonRequest } from "../ipc.js";
import { preflightPython } from "./python-preflight.js";

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizePythonEnv(env: unknown): Record<string, string> | undefined {
  if (!env || typeof env !== "object" || Array.isArray(env)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const k = String(key || "").trim();
    if (!k || value == null) continue;
    out[k] = String(value);
  }
  return Object.keys(out).length ? out : undefined;
}

export async function runPythonTool(args: Record<string, unknown>, ctx: any) {
  const sourceCode = typeof args?.code === "string" ? args.code : "";
  const scriptRel = typeof args?.path === "string" ? args.path.trim() : "";
  if (!sourceCode.trim() && !scriptRel) {
    throw new Error("run_python requires `code` or `path`.");
  }

  const ctxCwd = ctx?.cwd ?? WS;
  const cwd = shellCwd(typeof args?.cwd === "string" ? args.cwd : ctxCwd);
  let code = sourceCode;
  let scriptPath: string | null = null;

  if (scriptRel) {
    const abs = resolveWorkspacePath({ ...ctx, cwd }, scriptRel);
    scriptPath = abs;
    code = await fs.readFile(abs, "utf8");
  }

  const timeoutMs = Number(args?.timeout_ms);
  const normalizedEnv = normalizePythonEnv(args?.env);
  const declaredPackages = normalizeStringArray(args?.packages);

  // Static preflight: block known-incompatible scripts before launching the
  // Pyodide worker (saves a crashed worker + opaque traceback), and auto-load
  // Pyodide-bundled wheels for common office/PDF/image imports the caller
  // forgot to declare.
  const pre = preflightPython(code, declaredPackages);
  if (pre.block) {
    throw new Error(pre.block);
  }
  const usesWebagentHttp = /\b(?:import\s+webagent|from\s+webagent\b)/.test(code);
  const packages = [...declaredPackages];
  for (const pkg of pre.autoPackages) {
    if (!packages.some((p) => p.toLowerCase() === pkg.toLowerCase())) packages.push(pkg);
  }
  const micropipPackages = [...pre.micropipPackages];

  const payload = {
    code,
    cwd,
    ...(scriptPath ? { path: scriptPath } : {}),
    args: normalizeStringArray(args?.args),
    packages,
    micropip_packages: micropipPackages,
    ...(normalizedEnv ? { env: normalizedEnv } : {}),
    timeout_ms: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
  };

  const rawUnknown = await ipcPythonRequest(payload);
  if (!rawUnknown || typeof rawUnknown !== "object") {
    throw new Error("run_python: invalid IPC response");
  }
  const raw = rawUnknown as {
    ok?: boolean;
    error?: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    files_written?: string[];
    pyodide_version?: string;
  };
  if (!raw.ok) {
    throw new Error(String(raw.error || "run_python failed"));
  }
  return {
    stdout: String(raw.stdout ?? ""),
    stderr: String(raw.stderr ?? ""),
    exit_code: Number(raw.exit_code ?? 0),
    files_written: Array.isArray(raw.files_written) ? raw.files_written : [],
    ...(raw.pyodide_version ? { pyodide_version: raw.pyodide_version } : {}),
    ...(pre.autoPackages.length ? { auto_packages: pre.autoPackages } : {}),
    ...(pre.micropipPackages.length ? { micropip_packages: pre.micropipPackages } : {}),
    ...(pre.warnings.length ? { preflight_warnings: pre.warnings } : {}),
    ...(usesWebagentHttp ? { webagent_http: "available (import webagent.http as http; upload_file/post_multipart for files)" } : {}),
  };
}
