type PythonFilePayload = {
  path: string;
  contentBase64: string;
};

type PythonExecuteRequest = {
  id: string;
  code: string;
  cwd: string;
  path?: string;
  args?: string[];
  env?: Record<string, string>;
  packages?: string[];
  timeoutMs?: number;
  files?: PythonFilePayload[];
};

type PyodideRuntime = {
  FS: any;
  globals: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => unknown;
  };
  loadPackage: (packages: string | string[]) => Promise<void>;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (options: { batched?: (text: string) => void; raw?: (byte: number) => void }) => void;
  setStderr: (options: { batched?: (text: string) => void; raw?: (byte: number) => void }) => void;
  version?: string;
};

let pyodidePromise: Promise<PyodideRuntime> | null = null;

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

async function loadRuntime(): Promise<PyodideRuntime> {
  if (!pyodidePromise) {
    const importPyodide = new Function(
      "return import('https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.mjs')"
    ) as () => Promise<{ loadPyodide: (options: Record<string, unknown>) => Promise<unknown> }>;
    pyodidePromise = importPyodide().then(async ({ loadPyodide }) => {
      const pyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/",
        fullStdLib: true,
      });
      // One-time stdlib shims. Applied to the persistent interpreter so every
      // user script inherits them without knowing about Pyodide's JS bridge.
      await (pyodide as PyodideRuntime).runPythonAsync(`
import urllib.request as _ur, ssl as _ssl

# ssl.create_default_context() — the browser enforces TLS; the Python ssl
# module in Pyodide is a stub. Returning a dummy context object silences
# scripts that pass ctx= to urlopen.
class _FakeSSLCtx:
    check_hostname = False
    verify_mode = 0
    def load_verify_locations(self, *a, **kw): pass
    def load_cert_chain(self, *a, **kw): pass
_ssl.create_default_context = lambda *a, **kw: _FakeSSLCtx()

# urllib.request.urlopen — Pyodide returns the XHR body as a JsProxy
# (JavaScript Uint8Array / ArrayBuffer).  Wrap .read() / .readall() to
# convert JsProxy → Python bytes transparently so scripts that do
# r.read().decode('utf-8') just work.
_orig_urlopen = _ur.urlopen

def _js_to_bytes(val):
    if val is None:
        return b""
    if isinstance(val, (bytes, bytearray)):
        return bytes(val)
    # JsProxy exposes .to_bytes() (Pyodide ≥0.21) or is directly iterable.
    to_bytes = getattr(val, "to_bytes", None)
    if callable(to_bytes):
        return to_bytes()
    to_memoryview = getattr(val, "to_memoryview", None)
    if callable(to_memoryview):
        return bytes(to_memoryview())
    try:
        return bytes(val)
    except Exception:
        return str(val).encode()

class _WrappedResponse:
    def __init__(self, resp):
        self._r = resp
        # Read raw body immediately so the JS response is consumed; subsequent
        # .read() calls return from the buffer.
        try:
            raw = self._r.read()
        except Exception:
            raw = b""
        self._body = _js_to_bytes(raw)
        self._pos = 0
    def read(self, amt=-1):
        if amt < 0:
            chunk, self._pos = self._body[self._pos:], len(self._body)
        else:
            chunk, self._pos = self._body[self._pos:self._pos + amt], self._pos + amt
        return chunk
    def readall(self):
        return self.read()
    def __getattr__(self, name):
        return getattr(self._r, name)
    def __enter__(self):
        return self
    def __exit__(self, *a):
        pass

def _patched_urlopen(url, data=None, timeout=None, **kwargs):
    # Drop context= kwarg — Pyodide's urlopen doesn't accept it.
    kwargs.pop("context", None)
    kw = {}
    if timeout is not None:
        kw["timeout"] = timeout
    resp = _orig_urlopen(url, data, **kw)
    return _WrappedResponse(resp)

_ur.urlopen = _patched_urlopen
`);
      return pyodide as PyodideRuntime;
    });
  }
  return pyodidePromise;
}

function ensureDir(pyodide: PyodideRuntime, dir: string): void {
  const clean = String(dir || "/").replace(/\/+$/, "") || "/";
  if (clean === "/") return;
  const parts = clean.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += `/${part}`;
    try {
      pyodide.FS.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx);
}

function clearCwd(pyodide: PyodideRuntime, cwd: string): void {
  pyodide.globals.set("__webagent_cwd", cwd);
  // Pyodide's Emscripten FS keeps an open handle on the previous cwd between
  // worker runs. rmtree(cwd) raises EBUSY on that root, so we clear contents
  // and tolerate per-entry busy/permission errors instead of failing the run.
  pyodide.runPython(`
import os, shutil, sys
cwd = __webagent_cwd
try:
    os.chdir("/")
except Exception:
    pass
# Drop cached importlib state for the previous cwd so reimported modules
# don't keep file descriptors alive across runs.
for mod_name in list(sys.modules):
    mod = sys.modules.get(mod_name)
    mod_file = getattr(mod, "__file__", None) or ""
    if cwd and isinstance(mod_file, str) and mod_file.startswith(cwd + "/"):
        sys.modules.pop(mod_name, None)
if cwd and cwd not in ("", "/") and os.path.exists(cwd):
    for name in os.listdir(cwd):
        path = os.path.join(cwd, name)
        try:
            if os.path.islink(path) or not os.path.isdir(path):
                os.remove(path)
            else:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass
os.makedirs(cwd, exist_ok=True)
`);
}

function writeInputFiles(pyodide: PyodideRuntime, files: PythonFilePayload[] = []): void {
  for (const file of files) {
    ensureDir(pyodide, dirname(file.path));
    pyodide.FS.writeFile(file.path, base64ToBytes(file.contentBase64));
  }
}

function collectOutputFiles(pyodide: PyodideRuntime, cwd: string): PythonFilePayload[] {
  const out: PythonFilePayload[] = [];
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = pyodide.FS.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const abs = `${dir.replace(/\/+$/, "")}/${name}`;
      let stat: { mode: number };
      try {
        stat = pyodide.FS.stat(abs);
      } catch {
        continue;
      }
      if (pyodide.FS.isDir(stat.mode)) {
        walk(abs);
        continue;
      }
      try {
        out.push({ path: abs, contentBase64: bytesToBase64(pyodide.FS.readFile(abs)) });
      } catch {
        /* skip unreadable file */
      }
    }
  };
  walk(cwd);
  return out;
}

async function executePython(req: PythonExecuteRequest) {
  const pyodide = await loadRuntime();
  let stdout = "";
  let stderr = "";
  pyodide.setStdout({ batched: (text) => { stdout += `${text}\n`; } });
  pyodide.setStderr({ batched: (text) => { stderr += `${text}\n`; } });

  clearCwd(pyodide, req.cwd);
  writeInputFiles(pyodide, req.files || []);

  if (req.packages?.length) {
    await pyodide.loadPackage(req.packages);
  }

  pyodide.globals.set("__webagent_code", req.code || "");
  pyodide.globals.set("__webagent_cwd", req.cwd);
  pyodide.globals.set("__webagent_path", req.path || "<run_python>");
  pyodide.globals.set("__webagent_args", Array.isArray(req.args) ? req.args : []);
  pyodide.globals.set("__webagent_env", req.env || {});
  await pyodide.runPythonAsync(`
import os, sys, traceback
__webagent_exit_code = 0
try:
    os.makedirs(__webagent_cwd, exist_ok=True)
    os.chdir(__webagent_cwd)
    os.environ.update(dict(__webagent_env))
    sys.argv = [__webagent_path] + list(__webagent_args)
    __webagent_globals = {"__name__": "__main__", "__file__": __webagent_path}
    exec(compile(__webagent_code, __webagent_path, "exec"), __webagent_globals)
except SystemExit as e:
    code = e.code
    __webagent_exit_code = code if isinstance(code, int) else (0 if code is None else 1)
except BaseException:
    traceback.print_exc()
    __webagent_exit_code = 1
`);
  const exitCode = Number(pyodide.globals.get("__webagent_exit_code") ?? 0);
  const files = collectOutputFiles(pyodide, req.cwd);
  return {
    ok: true,
    stdout,
    stderr,
    exit_code: Number.isFinite(exitCode) ? exitCode : 1,
    files,
    pyodide_version: String(pyodide.version || ""),
  };
}

self.onmessage = (event: MessageEvent<PythonExecuteRequest>) => {
  const req = event.data;
  void executePython(req)
    .then((payload) => {
      self.postMessage({ id: req.id, ...payload });
    })
    .catch((error) => {
      self.postMessage({
        id: req.id,
        ok: false,
        error: String((error as Error)?.message ?? error),
      });
    });
};
