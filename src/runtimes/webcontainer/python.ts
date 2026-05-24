import { getNodebox } from "./boot";

type PythonFilePayload = {
  path: string;
  contentBase64: string;
};

type PythonRequest = {
  code?: string;
  cwd?: string;
  path?: string;
  args?: string[];
  env?: Record<string, string>;
  packages?: string[];
  micropip_packages?: string[];
  timeout_ms?: number;
};

type PythonWorkerResponse = {
  id: string;
  ok?: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  files?: PythonFilePayload[];
  pyodide_version?: string;
};

const MAX_SYNC_FILES = 800;
const MAX_SYNC_FILE_BYTES = 1024 * 1024;
const MAX_SYNC_TOTAL_BYTES = 8 * 1024 * 1024;

let worker: Worker | null = null;
let nextId = 0;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./python-worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

function resetWorker(): void {
  worker?.terminate();
  worker = null;
}

function normalizeNodeboxPath(path: string, workspaceRoot: string): string {
  const raw = String(path || workspaceRoot).trim() || workspaceRoot;
  const absolute = raw.startsWith("/") ? raw : `${workspaceRoot}/${raw.replace(/^\.\//, "")}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  return normalized === workspaceRoot || normalized.startsWith(`${workspaceRoot}/`)
    ? normalized
    : workspaceRoot;
}

function shouldSkipPath(rel: string, isDir: boolean): boolean {
  const first = rel.split("/")[0] || "";
  if ([".git", "node_modules", "dist", "build", ".vite"].includes(first)) return true;
  if (rel === "memory/snapshots" || rel.startsWith("memory/snapshots/")) return true;
  if (rel === ".webagent/memory" || rel.startsWith(".webagent/memory/")) return true;
  if (rel === ".webagent/vendor" || rel.startsWith(".webagent/vendor/")) return true;
  if (isDir && rel === ".webagent/tmp") return true;
  return false;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toBytes(data: unknown): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array();
}

async function collectFiles(cwd: string): Promise<{
  files: PythonFilePayload[];
  inputByPath: Map<string, string>;
}> {
  const emulator = await getNodebox();
  const files: PythonFilePayload[] = [];
  const inputByPath = new Map<string, string>();
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    if (files.length >= MAX_SYNC_FILES || totalBytes >= MAX_SYNC_TOTAL_BYTES) return;
    let names: string[] = [];
    try {
      names = await emulator.fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (files.length >= MAX_SYNC_FILES || totalBytes >= MAX_SYNC_TOTAL_BYTES) return;
      const abs = `${dir.replace(/\/+$/, "")}/${name}`;
      const rel = abs.startsWith(`${cwd}/`) ? abs.slice(cwd.length + 1) : name;
      let stat: { type?: string; size?: number };
      try {
        stat = await emulator.fs.stat(abs);
      } catch {
        continue;
      }
      const isDir = stat.type === "dir";
      if (shouldSkipPath(rel, isDir)) continue;
      if (isDir) {
        await walk(abs);
        continue;
      }
      const size = Number(stat.size ?? 0);
      if (size > MAX_SYNC_FILE_BYTES || totalBytes + size > MAX_SYNC_TOTAL_BYTES) continue;
      try {
        const contentBase64 = bytesToBase64(toBytes(await emulator.fs.readFile(abs)));
        files.push({ path: abs, contentBase64 });
        inputByPath.set(abs, contentBase64);
        totalBytes += size;
      } catch {
        /* skip unreadable file */
      }
    }
  }

  await walk(cwd);
  return { files, inputByPath };
}

async function writeBackFiles(
  cwd: string,
  inputByPath: Map<string, string>,
  files: PythonFilePayload[] = []
): Promise<string[]> {
  const emulator = await getNodebox();
  const written: string[] = [];
  for (const file of files) {
    const abs = String(file.path || "");
    if (!(abs === cwd || abs.startsWith(`${cwd}/`))) continue;
    if (inputByPath.get(abs) === file.contentBase64) continue;
    const parent = abs.split("/").slice(0, -1).join("/") || "/";
    try {
      await emulator.fs.mkdir(parent, { recursive: true });
      await emulator.fs.writeFile(abs, base64ToBytes(file.contentBase64));
      written.push(abs.slice(cwd.length + 1));
    } catch {
      /* best effort writeback */
    }
  }
  return written;
}

function postWorker(req: Record<string, unknown>, timeoutMs: number): Promise<PythonWorkerResponse> {
  return new Promise((resolve, reject) => {
    const id = `py_${++nextId}`;
    const w = getWorker();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent<PythonWorkerResponse>) => {
      if (event.data?.id !== id) return;
      cleanup();
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "Pyodide worker failed"));
    };
    timer = setTimeout(() => {
      cleanup();
      resetWorker();
      reject(new Error(`run_python timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, ...req });
  });
}

async function executePythonNow(req: PythonRequest, workspaceRoot: string) {
  const cwd = normalizeNodeboxPath(String(req.cwd || workspaceRoot), workspaceRoot);
  const timeoutMs =
    typeof req.timeout_ms === "number" && Number.isFinite(req.timeout_ms) && req.timeout_ms > 0
      ? req.timeout_ms
      : 120_000;
  const { files, inputByPath } = await collectFiles(cwd);
  const response = await postWorker({
    code: String(req.code || ""),
    cwd,
    ...(req.path ? { path: normalizeNodeboxPath(String(req.path), workspaceRoot) } : {}),
    args: Array.isArray(req.args) ? req.args.map(String) : [],
    env: req.env && typeof req.env === "object" ? req.env : {},
    packages: Array.isArray(req.packages) ? req.packages.map(String) : [],
    micropipPackages: Array.isArray(req.micropip_packages)
      ? req.micropip_packages.map(String)
      : [],
    timeoutMs,
    files,
  }, timeoutMs + 30_000);
  if (!response.ok) {
    // Worker-level failure (Pyodide init error, cwd EBUSY before our guard,
    // postMessage crash). Recycle the worker so the next run starts clean
    // instead of inheriting the broken FS / module state.
    resetWorker();
    return response;
  }
  const files_written = await writeBackFiles(cwd, inputByPath, response.files || []);
  return {
    ok: true,
    stdout: response.stdout || "",
    stderr: response.stderr || "",
    exit_code: Number(response.exit_code ?? 0),
    files_written,
    pyodide_version: response.pyodide_version || "",
  };
}

export function executePythonInNodebox(req: PythonRequest, workspaceRoot: string) {
  const task = queue.then(() => executePythonNow(req, workspaceRoot));
  queue = task.catch(() => undefined);
  return task;
}

