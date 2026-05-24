/**
 * Static preflight for `run_python`.
 *
 * Pyodide ships stdlib + a fixed set of pure-Python packages, no native
 * binaries, no real subprocess, no real sockets. Most failure modes in
 * user-imported skills are detectable from the source alone:
 *
 *  1. Imports of PyPI packages that don't exist in Pyodide (e.g. invented
 *     SDKs, `pdf2image` which depends on poppler at *runtime*, etc.).
 *  2. `subprocess` / `os.system` invocations of host binaries the browser
 *     cannot provide (`soffice`, `libreoffice`, `pdftoppm`, `pdftotext`,
 *     `qpdf`, `pdftk`, `pandoc`, `tesseract`, `ffmpeg`, `gcc`, …).
 *  3. Imports of Pyodide-bundled packages that the caller forgot to load
 *     via the `packages` arg (e.g. `python-docx`, `openpyxl`, `Pillow`,
 *     `pypdf`, `defusedxml`).
 *
 * Catching these *before* dispatching to the Pyodide worker turns a noisy
 * traceback + crashed worker into a single actionable error or a silent
 * auto-load of the needed wheels.
 */

export type PythonPreflight = {
  /** If set, refuse to dispatch — message is the user-facing reason. */
  block?: string;
  /** Pyodide packages to auto-add to the `packages` arg. */
  autoPackages: string[];
  /** Soft warnings to surface to the model alongside output. */
  warnings: string[];
};

/**
 * Python import name (top-level package) → Pyodide package name resolvable
 * via `pyodide.loadPackage`. Only entries here will be auto-loaded; we err
 * on the side of well-known, stable, pure-Python packages.
 */
export const PYODIDE_PACKAGE_MAP: Record<string, string> = {
  // Imaging / numerics
  PIL: "Pillow",
  pillow: "Pillow",
  numpy: "numpy",
  pandas: "pandas",
  // Office formats
  docx: "python-docx",
  pptx: "python-pptx",
  openpyxl: "openpyxl",
  xlsxwriter: "xlsxwriter",
  pypdf: "pypdf",
  pypdf2: "PyPDF2",
  reportlab: "reportlab",
  pdfplumber: "pdfplumber",
  pdfminer: "pdfminer.six",
  defusedxml: "defusedxml",
  lxml: "lxml",
  // Networking / parsing
  bs4: "beautifulsoup4",
  yaml: "pyyaml",
  requests: "requests",
  // Plotting
  matplotlib: "matplotlib",
  // Other
  sympy: "sympy",
  cryptography: "cryptography",
};

/**
 * Imports that *look* installable but are guaranteed to fail at runtime in
 * Pyodide because they shell out to a native binary or open a real socket.
 * Maps import name → reason + suggested fallback.
 */
const KNOWN_BROKEN_IMPORTS: Record<string, string> = {
  pdf2image:
    "pdf2image shells out to poppler's `pdftoppm` at runtime; poppler is not available in Pyodide. Use `pypdf` for text extraction, or rasterize PDFs server-side.",
  pytesseract:
    "pytesseract calls the `tesseract` binary; no OCR runtime in Pyodide. Use a hosted OCR API via `web_post`.",
  playwright:
    "Playwright drives a real browser process — not available in Pyodide. Use `web_fetch` + parsing instead.",
  selenium:
    "Selenium needs a real browser driver — not available in Pyodide. Use `web_fetch`.",
  psycopg2:
    "psycopg2 needs libpq + raw sockets — Pyodide has neither. Use the database's HTTP/REST endpoint via `web_fetch`/`web_post`.",
  mysqlclient:
    "mysqlclient needs libmysql + raw sockets. Use an HTTP database proxy via `web_fetch`/`web_post`.",
  pymongo:
    "pymongo opens raw TCP sockets — unavailable in Pyodide. Use MongoDB Data API via `web_post`.",
  redis:
    "redis-py opens raw TCP — unavailable in Pyodide. Use Upstash/REST endpoint via `web_post`.",
  paramiko: "paramiko requires raw sockets — unavailable in Pyodide.",
  fabric: "fabric requires SSH/raw sockets — unavailable in Pyodide.",
  // Common hallucinated SDKs that we want to fail fast on.
  directus:
    "There is no PyPI `directus` package. Use the Directus REST API directly via `web_fetch`/`web_post`.",
  directus_sdk:
    "There is no Pyodide-compatible Directus SDK. Use the REST API directly via `web_fetch`/`web_post`.",
};

/**
 * Native binaries the script is trying to spawn via subprocess/os.system —
 * none of which exist in Pyodide. Map binary → suggestion.
 */
export const UNSUPPORTED_BINARIES: Record<string, string> = {
  soffice: "LibreOffice (`soffice`) is not available. Use `python-docx`/`python-pptx`/`openpyxl` to edit office files in-place, or hand the file to a server-side converter.",
  libreoffice: "LibreOffice is not available. Use pure-Python office libs (python-docx, python-pptx, openpyxl).",
  pdftoppm: "Poppler (`pdftoppm`) is not available. Rasterize PDFs server-side or extract text with `pypdf`.",
  pdftotext: "Poppler (`pdftotext`) is not available. Use `pypdf`'s `extract_text()` instead.",
  pdfimages: "Poppler (`pdfimages`) is not available. Use `pypdf` to walk image XObjects.",
  qpdf: "`qpdf` is not available. Use `pypdf` for re-encryption/merge/split.",
  pdftk: "`pdftk` is not available. Use `pypdf` for merge/split/form fill.",
  pandoc: "`pandoc` is not available. Use `markitdown` or per-format Python libs.",
  tesseract: "`tesseract` is not available. Use a hosted OCR API.",
  ffmpeg: "`ffmpeg` is not available in Pyodide. For GIFs use `imageio` (no ffmpeg backend); for video, hand off to a server.",
  gcc: "`gcc` is not available — Pyodide cannot compile C at runtime.",
  cc: "C compilers are not available in Pyodide.",
  curl: "`curl` is not a Pyodide binary. Use `web_fetch`/`web_post`.",
  wget: "`wget` is not a Pyodide binary. Use `web_fetch`.",
  git: "`git` is not available in Pyodide.",
};

const STDLIB_TOP_LEVEL = new Set([
  "abc","argparse","array","ast","asyncio","base64","binascii","bisect","builtins","bz2",
  "calendar","cgi","cmath","cmd","collections","colorsys","concurrent","configparser",
  "contextlib","copy","copyreg","csv","ctypes","dataclasses","datetime","decimal","difflib",
  "dis","email","encodings","enum","errno","faulthandler","fcntl","filecmp","fileinput",
  "fnmatch","fractions","ftplib","functools","gc","getopt","getpass","gettext","glob",
  "graphlib","gzip","hashlib","heapq","hmac","html","http","imaplib","importlib","inspect",
  "io","ipaddress","itertools","json","keyword","linecache","locale","logging","lzma",
  "marshal","math","mimetypes","mmap","multiprocessing","numbers","operator","optparse",
  "os","pathlib","pickle","pickletools","pkgutil","platform","plistlib","poplib","posixpath",
  "pprint","profile","pstats","pty","pwd","py_compile","pyclbr","pydoc","queue","quopri",
  "random","re","reprlib","resource","rlcompleter","runpy","sched","secrets","select","selectors",
  "shelve","shlex","shutil","signal","site","smtplib","sndhdr","socket","socketserver","sqlite3",
  "ssl","stat","statistics","string","stringprep","struct","subprocess","sunau","symtable",
  "sys","sysconfig","syslog","tabnanny","tarfile","telnetlib","tempfile","termios","textwrap",
  "threading","time","timeit","token","tokenize","trace","traceback","tracemalloc","tty",
  "turtle","types","typing","unicodedata","unittest","urllib","uu","uuid","venv","warnings",
  "wave","weakref","webbrowser","wsgiref","xdrlib","xml","xmlrpc","zipapp","zipfile","zipimport",
  "zlib","zoneinfo","__future__","_typeshed","_thread",
]);

export function extractTopLevelImports(source: string): string[] {
  const out = new Set<string>();
  const text = String(source || "");
  for (const m of text.matchAll(/^\s*import\s+([^\n#]+)/gm)) {
    for (const part of m[1].split(",")) {
      const head = part.trim().split(/\s+as\s+/i)[0]?.split(".")[0];
      if (head && /^[A-Za-z_]\w*$/.test(head)) out.add(head);
    }
  }
  for (const m of text.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/gm)) {
    const head = m[1].split(".")[0];
    if (head) out.add(head);
  }
  return [...out];
}

function findUnsupportedBinary(source: string): { binary: string; hint: string } | null {
  const text = String(source || "");
  // subprocess.run/call/Popen/check_output, os.system, os.popen, sh.* — pull
  // out the first token of the command (either a string arg or argv[0]).
  const patterns: RegExp[] = [
    // subprocess.something(["soffice", ...]) or (["soffice"])
    /subprocess\.(?:run|call|check_call|check_output|Popen|getoutput|getstatusoutput)\s*\(\s*\[\s*['"]([^'"\s]+)['"]/g,
    // subprocess.something("soffice --foo", shell=True)  or ("soffice")
    /subprocess\.(?:run|call|check_call|check_output|Popen|getoutput|getstatusoutput)\s*\(\s*['"]([^'"\s]+)/g,
    // os.system("soffice --foo")
    /os\.(?:system|popen)\s*\(\s*['"]([^'"\s]+)/g,
    // shutil.which("soffice")  ← strong signal even without execution
    /shutil\.which\s*\(\s*['"]([^'"\s]+)['"]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = String(m[1] || "").trim();
      if (!raw) continue;
      // Normalize: drop path, drop .exe, lowercase.
      const bin = raw.split("/").pop()!.split("\\").pop()!.replace(/\.exe$/i, "").toLowerCase();
      // Allow Pyodide-friendly invocations of `python`/`python3` itself.
      if (bin === "python" || bin === "python3" || bin === "node") continue;
      if (UNSUPPORTED_BINARIES[bin]) {
        return { binary: bin, hint: UNSUPPORTED_BINARIES[bin] };
      }
    }
  }
  return null;
}

export function preflightPython(
  source: string,
  declaredPackages: readonly string[] = []
): PythonPreflight {
  const warnings: string[] = [];
  const autoPackages: string[] = [];
  const text = String(source || "");

  // 1. Native binary spawn → hard block.
  const binary = findUnsupportedBinary(text);
  if (binary) {
    return {
      block: `run_python preflight: script invokes \`${binary.binary}\` via subprocess/os.system, which is not available in Pyodide (browser). ${binary.hint}`,
      autoPackages: [],
      warnings,
    };
  }

  // 2. Imports.
  const imports = extractTopLevelImports(text);
  const declared = new Set(declaredPackages.map((p) => p.toLowerCase()));

  for (const imp of imports) {
    if (STDLIB_TOP_LEVEL.has(imp)) continue;
    const lower = imp.toLowerCase();

    if (KNOWN_BROKEN_IMPORTS[lower]) {
      return {
        block: `run_python preflight: import of '${imp}' is not supported in Pyodide. ${KNOWN_BROKEN_IMPORTS[lower]}`,
        autoPackages: [],
        warnings,
      };
    }

    const pkg = PYODIDE_PACKAGE_MAP[imp] || PYODIDE_PACKAGE_MAP[lower];
    if (pkg && !declared.has(pkg.toLowerCase()) && !autoPackages.includes(pkg)) {
      autoPackages.push(pkg);
    }
  }

  // 3. socket usage (raw TCP) — Pyodide stubs most of it. Warn but don't
  //    block; many scripts import socket only for constants (AF_INET).
  if (/\bsocket\.(?:socket|create_connection|create_server)\s*\(/.test(text)) {
    warnings.push(
      "Script opens raw TCP sockets; Pyodide cannot proxy them. Prefer `web_fetch`/`web_post` for HTTP, or run on a host."
    );
  }

  // 4. Compiling C at runtime / LD_PRELOAD tricks (anthropics office/soffice.py).
  if (/\b(?:LD_PRELOAD|ctypes\.CDLL\([^)]*\.so)\b/.test(text)) {
    warnings.push(
      "Script uses LD_PRELOAD or loads a `.so` via ctypes — neither works in Pyodide; that code path will be a no-op or crash."
    );
  }

  return { autoPackages, warnings };
}
