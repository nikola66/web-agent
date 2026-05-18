/**
 * Workspace management — OPFS snapshots keyed by profile id.
 */

import {
  exists,
  clearAll,
  clearAllOriginStorage,
  exportSnapshot,
  importSnapshot,
  mkdir,
  getStorageEstimate,
  listDir,
  readFile,
  readFileBuffer,
  type FileEntry,
} from "./persistence";
import { clearCredentials } from "./credential-vault";
import { isAllowedUploadFile } from "@embed-runtime/tools/upload-allowlist.js";
import { getActiveNodebox, getNodebox } from "@/runtimes/webcontainer/boot";
import { WORKSPACE_WEBAGENT_USER_SUBDIRS } from "./workspace-layout";

export * from "./workspace-layout";

export function snapshotPrefix(profileId: string): string {
  return `profiles/${profileId}/snapshot`;
}

export interface WorkspaceFileEntry {
  path: string;
  size: number;
  lastModified?: number;
}

interface WorkspaceReadOptions {
  preferLive?: boolean;
}

export interface WorkspaceCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface WorkspaceTerminalSession {
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type WorkspaceCleanMode = "always" | "once";

const WORKSPACE_TERMINAL_SCRIPT = String.raw`#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
let cwd = ROOT;
let line = "";
let child = null;

const out = (s = "") => process.stdout.write(String(s).replace(/\n/g, "\r\n"));
const rel = () => {
  const r = path.relative(ROOT, cwd).replace(/\\/g, "/");
  return r ? "~/" + r : "~";
};
const prompt = () => out("\r\n\x1b[35m" + rel() + "\x1b[0m $ ");
const insideRoot = (p) => {
  const resolved = path.resolve(cwd, p || ".");
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep);
};
const resolvePath = (p = ".") => {
  const resolved = path.resolve(cwd, p);
  if (!(resolved === ROOT || resolved.startsWith(ROOT + path.sep))) {
    throw new Error("Path escapes workspace root.");
  }
  return resolved;
};

function parseArgs(input) {
  const args = [];
  let cur = "";
  let quote = null;
  let esc = false;
  for (const ch of input) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        args.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

async function listDir(target) {
  const dir = resolvePath(target || ".");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  out(entries.map((entry) => entry.name + (entry.isDirectory() ? "/" : "")).join("  ") + "\n");
}

async function runExternal(command, args) {
  return new Promise((resolve) => {
    try {
      child = spawn(command, args, { cwd, env: process.env });
    } catch (err) {
      out((err?.message || String(err)) + "\n");
      child = null;
      resolve(127);
      return;
    }
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", (err) => {
      out((err?.message || String(err)) + "\n");
    });
    child.on("close", (code) => {
      child = null;
      resolve(Number.isFinite(code) ? code : 0);
    });
  });
}

async function execute(input) {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const [cmd, ...args] = parseArgs(trimmed);
  if (!cmd) return 0;

  switch (cmd) {
    case "help":
      out("Built-ins: help, pwd, ls, cd, cat, mkdir, touch, rm, rmdir, cp, mv, echo, clear, exit\n");
      out('node: node -v | node -e "code" | node file.js\n');
      return 0;
    case "pwd":
      out(rel() + "\n");
      return 0;
    case "ls":
      await listDir(args.find((arg) => !arg.startsWith("-")) || ".");
      return 0;
    case "cd": {
      const next = resolvePath(args[0] || ".");
      const stat = await fs.stat(next);
      if (!stat.isDirectory()) throw new Error("Not a directory.");
      if (!insideRoot(next)) throw new Error("Path escapes workspace root.");
      cwd = next;
      return 0;
    }
    case "cat":
      for (const file of args) out(await fs.readFile(resolvePath(file), "utf8"));
      if (args.length) out("\n");
      return 0;
    case "mkdir":
      for (const dir of args.filter((arg) => !arg.startsWith("-"))) await fs.mkdir(resolvePath(dir), { recursive: args.includes("-p") });
      return 0;
    case "touch":
      for (const file of args) {
        const p = resolvePath(file);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, await fs.readFile(p).catch(() => ""));
      }
      return 0;
    case "rm":
      for (const p of args.filter((arg) => !arg.startsWith("-"))) {
        await fs.rm(resolvePath(p), { recursive: args.includes("-r") || args.includes("-rf"), force: args.includes("-f") || args.includes("-rf") });
      }
      return 0;
    case "rmdir":
      for (const dir of args) await fs.rmdir(resolvePath(dir));
      return 0;
    case "cp":
      if (args.length < 2) throw new Error("cp requires source and destination.");
      await fs.cp(resolvePath(args[0]), resolvePath(args[1]), { recursive: true });
      return 0;
    case "mv":
      if (args.length < 2) throw new Error("mv requires source and destination.");
      await fs.rename(resolvePath(args[0]), resolvePath(args[1]));
      return 0;
    case "echo":
      out(args.join(" ") + "\n");
      return 0;
    case "clear":
      out("\x1b[2J\x1b[H");
      return 0;
    case "exit":
      process.exit(0);
      return 0;
    case "node": {
      const exe =
        typeof process.execPath === "string" && process.execPath.length > 0 ? process.execPath : "node";
      if (args.length === 0) {
        out('Interactive Node REPL is not available. Try: node -v   node -e "console.log(1)"   node ./file.js\n');
        return 1;
      }
      if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
        const v = process.version || "";
        out((v.startsWith("v") ? v : "v" + v) + "\n");
        return 0;
      }
      const ie = args.indexOf("-e");
      const iv = args.indexOf("--eval");
      const ei = ie >= 0 ? ie : iv;
      if (ei >= 0) {
        if (ei + 1 >= args.length) {
          out('node -e requires a script string, e.g. node -e "console.log(1)"\n');
          return 1;
        }
        const body = args[ei + 1];
        const tmp = path.join(ROOT, ".webagent", "tmp", "ws-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10) + ".js");
        await fs.mkdir(path.dirname(tmp), { recursive: true });
        await fs.writeFile(tmp, body, "utf8");
        try {
          const spawnedArgs = [...args.slice(0, ei), tmp, ...args.slice(ei + 2)];
          return await runExternal(exe, spawnedArgs);
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
      }
      return await runExternal(exe, args);
    }
    default:
      return runExternal(cmd, args);
  }
}

async function runOnce() {
  const idx = process.argv.indexOf("--run");
  if (idx < 0) return false;
  const code = await execute(process.argv.slice(idx + 1).join(" "));
  process.exit(Number.isFinite(code) ? code : 0);
}

if (!(await runOnce())) {
  out("\x1b[90mNodebox workspace shell. Type help for built-ins.\x1b[0m");
  prompt();
  process.stdin.on("data", async (chunk) => {
    const data = String(chunk);
    if (child) {
      if (data === "\u0003") child.kill("SIGINT");
      else child.stdin?.write(data);
      return;
    }
    for (const ch of data) {
      if (ch === "\u0003") {
        line = "";
        out("^C");
        prompt();
      } else if (ch === "\r" || ch === "\n") {
        const current = line;
        line = "";
        out("\r\n");
        try {
          await execute(current);
        } catch (err) {
          out("\x1b[31m" + (err?.message || String(err)) + "\x1b[0m\n");
        }
        prompt();
      } else if (ch === "\u007f" || ch === "\b") {
        if (line.length) {
          line = line.slice(0, -1);
          out("\b \b");
        }
      } else if (ch >= " " && ch !== "\u001b") {
        line += ch;
        out(ch);
      }
    }
  });
}
`;

function normalizeSnapshotRelativePath(path: string): string {
  return path.replace(/^\/+/, "");
}

/** Parse workspace clean mode from URL query params. */
export function getWorkspaceCleanModeFromUrl(
  href: string = typeof window !== "undefined" ? window.location.href : ""
): WorkspaceCleanMode | null {
  if (!href) return null;
  let value = "";
  try {
    const params = new URL(href).searchParams;
    if (!params.has("clean")) return null;
    value = params.get("clean") ?? "";
  } catch {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "1" || normalized === "true") return "always";
  if (normalized === "once") return "once";
  return null;
}

/** Remove clean=once from URL after it has been consumed. */
export function consumeWorkspaceCleanOnceInUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const value = (url.searchParams.get("clean") || "").trim().toLowerCase();
  if (value !== "once") return;
  url.searchParams.delete("clean");
  const next =
    `${url.pathname}${url.search}${url.hash}` ||
    `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, "", next);
}

/** Set clean=once and reload so next launch starts from a clean workspace. */
export function requestWorkspaceCleanOnceReload(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("clean", "once");
  window.location.assign(url.toString());
}

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

/** Encode a Uint8Array to base64 without spreading into String.fromCharCode
 *  (the spread approach throws RangeError for buffers > ~65 KB). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Trigger a file download safely in all browsers by briefly attaching the
 *  anchor to the document before clicking it. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Normalize UI/snapshot-relative paths onto the agent cwd (`/workspace/{profileId}/...`).
 */
function workspacePathRelativeToProfile(profileId: string, relativePath: string): string {
  let rel = normalizeSnapshotRelativePath(relativePath);
  const prefixed = `${profileId}/`;
  if (rel === profileId) return "";
  if (rel.startsWith(prefixed)) rel = rel.slice(prefixed.length);
  return rel;
}

function normalizeWorkspaceUploadPath(relativePathUnderUploads: string): string {
  const raw = String(relativePathUnderUploads || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/")) {
    throw new Error("Uploads must use a relative path under uploads/.");
  }
  const prefixed = raw.startsWith("uploads/") ? raw : `uploads/${raw.replace(/^\.\/+/, "")}`;
  const parts = prefixed.split("/").filter(Boolean);
  if (parts[0] !== "uploads" || parts.length !== 2 || parts[1] === "." || parts[1] === "..") {
    throw new Error("Uploads must stay under uploads/ using a single filename.");
  }
  const safeName = basename(parts[1]).trim();
  if (!safeName || safeName === "." || safeName === ".." || !isAllowedUploadFile(safeName)) {
    throw new Error(`Unsupported upload file: ${parts[1] || relativePathUnderUploads}`);
  }
  return `uploads/${safeName}`;
}

function splitUploadName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

async function listLiveWorkspaceFiles(profileId: string): Promise<WorkspaceFileEntry[]> {
  const emulatorOrNull = getActiveNodebox();
  if (!emulatorOrNull) return [];
  const emulator = emulatorOrNull;
  const workspaceDir = `/workspace/${profileId}`;
  const results: WorkspaceFileEntry[] = [];

  try {
    for (const sub of WORKSPACE_WEBAGENT_USER_SUBDIRS) {
      await emulator.fs.mkdir(`${workspaceDir}/.webagent/${sub}`, { recursive: true });
    }
  } catch {
    /* best effort */
  }

  async function walk(dirPath: string): Promise<void> {
    let names: string[];
    try {
      names = await emulator.fs.readdir(dirPath);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = `${dirPath}/${name}`;
      let isDir = false;
      try {
        const stat = await emulator.fs.stat(abs);
        isDir = stat.type === "dir";
      } catch {
        continue;
      }
      if (isDir) {
        await walk(abs);
        continue;
      }
      const prefix = `${workspaceDir}/`;
      const rel =
        abs.startsWith(prefix)
          ? abs.slice(prefix.length)
          : normalizeSnapshotRelativePath(abs.replace(/^\/+/, ""));
      let size = 0;
      try {
        const raw = await emulator.fs.readFile(abs);
        size = raw.byteLength;
      } catch {
        /* best effort */
      }
      results.push({ path: rel, size });
    }
  }

  try {
    await walk(workspaceDir);
  } catch {
    return [];
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

export async function writeWorkspaceUpload(
  profileId: string,
  relativePathUnderUploads: string,
  data: Uint8Array
): Promise<string> {
  const emulator = getActiveNodebox();
  if (!emulator) throw new Error("Uploads require a running agent.");
  const workspaceDir = `/workspace/${profileId}`;
  const normalized = normalizeWorkspaceUploadPath(relativePathUnderUploads);
  const uploadDir = `${workspaceDir}/uploads`;
  const initialName = normalized.slice("uploads/".length);
  const { stem, ext } = splitUploadName(initialName);
  let nextName = initialName;
  let index = 1;

  await emulator.fs.mkdir(workspaceDir, { recursive: true });
  await emulator.fs.mkdir(uploadDir, { recursive: true });

  while (true) {
    try {
      await emulator.fs.stat(`${uploadDir}/${nextName}`);
      nextName = `${stem} (${index++})${ext}`;
    } catch {
      break;
    }
  }

  await emulator.fs.writeFile(`${uploadDir}/${nextName}`, data);
  return `uploads/${nextName}`;
}

type WorkspaceNodebox = Awaited<ReturnType<typeof getNodebox>>;

async function ensureWorkspaceTerminalScript(
  emulator: WorkspaceNodebox,
  workspaceDir: string
): Promise<string> {
  const webagentDir = `${workspaceDir}/.webagent`;
  const scriptPath = `${webagentDir}/workspace-terminal.mjs`;
  await emulator.fs.mkdir(webagentDir, { recursive: true });
  await emulator.fs.writeFile(scriptPath, WORKSPACE_TERMINAL_SCRIPT);
  return ".webagent/workspace-terminal.mjs";
}

/** List all files in a profile workspace snapshot (recursive) */
export async function listWorkspaceFiles(
  profileId: string,
  options: WorkspaceReadOptions = {}
): Promise<WorkspaceFileEntry[]> {
  if (options.preferLive) {
    const emulatorOrNull = getActiveNodebox();
    if (emulatorOrNull) return listLiveWorkspaceFiles(profileId);
  }
  const root = snapshotPrefix(profileId);
  const results: WorkspaceFileEntry[] = [];

  async function walk(dirPath: string): Promise<void> {
    let entries: FileEntry[] = [];
    try {
      entries = await listDir(dirPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.kind === "directory") {
        await walk(entry.path);
        continue;
      }
      const relativePath = entry.path.startsWith(`${root}/`)
        ? entry.path.slice(root.length + 1)
        : basename(entry.path);
      const normalizedPath = normalizeSnapshotRelativePath(relativePath);
      results.push({
        path: normalizedPath,
        size: entry.size ?? 0,
        lastModified: entry.lastModified,
      });
    }
  }

  await walk(root);
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

/** Read a workspace file as UTF-8 text (for preview) */
export async function readWorkspaceFileText(
  profileId: string,
  relativePath: string,
  options: WorkspaceReadOptions = {}
): Promise<string> {
  if (options.preferLive) {
    const emulator = getActiveNodebox();
    if (emulator) {
      try {
        const rel = workspacePathRelativeToProfile(profileId, relativePath);
        const data = await emulator.fs.readFile(`/workspace/${profileId}/${rel}`);
        return new TextDecoder().decode(data);
      } catch {
        /* fallback to snapshot */
      }
    }
  }
  const root = snapshotPrefix(profileId);
  const normalizedPath = workspacePathRelativeToProfile(profileId, relativePath);
  return readFile(`${root}/${normalizedPath}`);
}

/** Read a workspace file as raw bytes (for binary previews such as SQLite). */
export async function readWorkspaceFileBuffer(
  profileId: string,
  relativePath: string,
  options: WorkspaceReadOptions = {}
): Promise<ArrayBuffer> {
  if (options.preferLive) {
    const emulator = getActiveNodebox();
    if (emulator) {
      try {
        const rel = workspacePathRelativeToProfile(profileId, relativePath);
        const data = await emulator.fs.readFile(`/workspace/${profileId}/${rel}`);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      } catch {
        /* fallback to snapshot */
      }
    }
  }
  const root = snapshotPrefix(profileId);
  const normalizedPath = workspacePathRelativeToProfile(profileId, relativePath);
  return readFileBuffer(`${root}/${normalizedPath}`);
}

/** Download a workspace file to local machine */
export async function downloadWorkspaceFile(
  profileId: string,
  relativePath: string,
  options: WorkspaceReadOptions = {}
): Promise<void> {
  if (options.preferLive) {
    const emulator = getActiveNodebox();
    if (emulator) {
      try {
        const rel = workspacePathRelativeToProfile(profileId, relativePath);
        const data = await emulator.fs.readFile(`/workspace/${profileId}/${rel}`);
        const blob = new Blob([data.buffer as ArrayBuffer], { type: "application/octet-stream" });
        triggerDownload(blob, basename(relativePath));
        return;
      } catch {
        /* fallback to snapshot */
      }
    }
  }
  const root = snapshotPrefix(profileId);
  const normalizedPath = workspacePathRelativeToProfile(profileId, relativePath);
  const snapshotData = await readFileBuffer(`${root}/${normalizedPath}`);
  const blob = new Blob([snapshotData], { type: "application/octet-stream" });
  triggerDownload(blob, basename(relativePath));
}

/** Run a shell command in the live Nodebox workspace. */
export async function runWorkspaceCommand(
  profileId: string,
  command: string
): Promise<WorkspaceCommandResult> {
  const emulator = await getNodebox();
  const workspaceDir = `/workspace/${profileId}`;
  await emulator.fs.mkdir(workspaceDir, { recursive: true });
  const scriptPath = await ensureWorkspaceTerminalScript(emulator, workspaceDir);

  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command cannot be empty.");
  }

  const shell = emulator.shell.create();
  let output = "";
  shell.stdout.on("data", (chunk: string) => { output += chunk; });
  shell.stderr.on("data", (chunk: string) => { output += chunk; });

  let exitResolve!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => { exitResolve = resolve; });
  await shell.on("exit", (code) => exitResolve(code ?? 0));

  await shell.runCommand("node", [scriptPath, "--run", trimmed], { cwd: workspaceDir });
  const exitCode = await exitPromise;

  return {
    stdout: output,
    stderr: "",
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
  };
}

/** Start a persistent interactive shell in /workspace. */
export async function startWorkspaceTerminalSession(
  profileId: string,
  options: {
    cols?: number;
    rows?: number;
    onOutput: (chunk: string) => void;
    onExit?: (exitCode: number | null) => void;
  }
): Promise<WorkspaceTerminalSession> {
  const emulator = await getNodebox();
  const workspaceDir = `/workspace/${profileId}`;
  await emulator.fs.mkdir(workspaceDir, { recursive: true });
  const scriptPath = await ensureWorkspaceTerminalScript(emulator, workspaceDir);

  const shell = emulator.shell.create();
  shell.stdout.on("data", (chunk: string) => options.onOutput(chunk));
  shell.stderr.on("data", (chunk: string) => options.onOutput(chunk));

  await shell.on("exit", (code) => {
    const exitCode = Number.isFinite(code) ? code : null;
    options.onExit?.(exitCode);
  });

  await shell.runCommand("node", [scriptPath], { cwd: workspaceDir });

  return {
    async write(data: string): Promise<void> {
      await shell.stdin.write(data);
    },
    resize(_cols: number, _rows: number): void {
      // Nodebox does not support PTY resize
    },
    kill(): void {
      void shell.kill();
    },
  };
}

/** Check if a profile workspace has been initialized */
export async function workspaceExists(profileId: string): Promise<boolean> {
  return exists(snapshotPrefix(profileId));
}

/** Create a fresh workspace directory structure */
export async function createWorkspace(profileId: string): Promise<void> {
  await mkdir(snapshotPrefix(profileId));
}

/** Destroy a profile workspace (all OPFS data for that profile) */
export async function destroyWorkspace(profileId: string): Promise<void> {
  await clearAll(`profiles/${profileId}`);
  const emulator = getActiveNodebox();
  if (emulator) {
    await emulator.fs.rm(`/workspace/${profileId}`, { recursive: true, force: true }).catch(() => {});
  }
}

/** Destroy all app/runtime storage for this browser origin */
export async function destroyAll(): Promise<void> {
  await clearCredentials().catch(() => {});
  await clearAllOriginStorage();
}

/** Export workspace as a JSON archive */
export async function exportWorkspace(
  profileId: string
): Promise<{ name: string; blob: Blob }> {
  const prefix = snapshotPrefix(profileId);
  const entries = await exportSnapshot(prefix);

  const archive = {
    version: 2,
    profileId,
    exportedAt: new Date().toISOString(),
    files: entries.map((e) => ({
      path: e.path,
      content:
        e.content instanceof ArrayBuffer
          ? uint8ToBase64(new Uint8Array(e.content))
          : typeof e.content === "string"
          ? e.content
          : uint8ToBase64(e.content as Uint8Array),
    })),
  };

  const json = JSON.stringify(archive, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const name = `web-agent-profile-${profileId.slice(0, 8)}-${Date.now()}.json`;
  return { name, blob };
}

export async function downloadWorkspace(profileId: string): Promise<void> {
  const { name, blob } = await exportWorkspace(profileId);
  triggerDownload(blob, name);
}

export async function importWorkspace(
  profileId: string,
  file: File
): Promise<void> {
  let archive: unknown;
  try {
    archive = JSON.parse(await file.text());
  } catch {
    throw new Error("Invalid workspace archive: file is not valid JSON");
  }

  if (!archive || typeof archive !== "object" || Array.isArray(archive)) {
    throw new Error("Invalid workspace archive: expected a JSON object");
  }

  const a = archive as Record<string, unknown>;

  if (a["version"] !== 1 && a["version"] !== 2) {
    throw new Error(`Unsupported archive version: ${String(a["version"])}`);
  }

  if (!Array.isArray(a["files"])) {
    throw new Error("Invalid workspace archive: missing or malformed files array");
  }

  const prefix = snapshotPrefix(profileId);
  const entries = (a["files"] as Array<{ path: string; content: string }>).map(
    (f) => ({
      path: f.path,
      content:
        typeof f.content === "string"
          ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0)).buffer
          : f.content,
    })
  );

  await importSnapshot(prefix, entries);
}

export async function getStorageInfo(): Promise<{
  used: number;
  quota: number;
  percentage: number;
}> {
  return getStorageEstimate();
}
