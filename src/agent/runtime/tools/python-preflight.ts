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
  /** Pyodide packages to auto-add to the `packages` arg (loadPackage). */
  autoPackages: string[];
  /** Pure-Python PyPI packages to install via micropip in the worker. */
  micropipPackages: string[];
  /** Soft warnings to surface to the model alongside output. */
  warnings: string[];
};

/** Pure-Python PyPI wheels verified for micropip.install in the browser worker. */
export const MICOPIP_ALLOWLIST: Record<string, string> = {
  feedparser: "feedparser",
  wikipedia: "wikipedia",
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
  scipy: "scipy",
  sklearn: "scikit-learn",
  imageio: "imageio",
  // Office formats
  docx: "python-docx",
  pptx: "python-pptx",
  openpyxl: "openpyxl",
  xlsxwriter: "xlsxwriter",
  xlrd: "xlrd",
  pypdf: "pypdf",
  pypdf2: "PyPDF2",
  reportlab: "reportlab",
  pdfplumber: "pdfplumber",
  pdfminer: "pdfminer.six",
  defusedxml: "defusedxml",
  lxml: "lxml",
  markitdown: "markitdown",
  // Networking / parsing
  bs4: "beautifulsoup4",
  yaml: "pyyaml",
  toml: "toml",
  requests: "requests",
  httpx: "httpx",
  aiohttp: "aiohttp",
  // Data / ML (wheels available in Pyodide)
  matplotlib: "matplotlib",
  seaborn: "seaborn",
  statsmodels: "statsmodels",
  joblib: "joblib",
  // Bio / science (some in Pyodide)
  biopython: "biopython",
  // Utilities
  sympy: "sympy",
  cryptography: "cryptography",
  pydantic: "pydantic",
  attrs: "attrs",
  dateutil: "python-dateutil",
  arrow: "arrow",
  click: "click",
  rich: "rich",
  tqdm: "tqdm",
  jinja2: "Jinja2",
  markdown: "markdown",
  pygments: "Pygments",
  chardet: "chardet",
  charset_normalizer: "charset-normalizer",
};

/**
 * Imports that *look* installable but are guaranteed to fail at runtime in
 * Pyodide because they shell out to a native binary or open a real socket.
 * Maps import name → reason + suggested fallback.
 */
const KNOWN_BROKEN_IMPORTS: Record<string, string> = {
  // PDF / OCR native deps
  pdf2image:
    "pdf2image shells out to poppler's `pdftoppm` at runtime; poppler is not available in Pyodide. Use `pypdf` for text extraction, or rasterize PDFs server-side.",
  pytesseract:
    "pytesseract calls the `tesseract` binary; no OCR runtime in Pyodide. Use a hosted OCR API via `web_post`.",
  ocrmypdf:
    "ocrmypdf requires `tesseract` + `ghostscript` binaries — not available in Pyodide. Use a hosted OCR API.",
  // Browser automation
  playwright:
    "Playwright drives a real browser process — not available in Pyodide. Use `web_fetch` + parsing instead.",
  pyppeteer:
    "pyppeteer drives Chromium — not available in Pyodide. Use `web_fetch` + parsing instead.",
  selenium:
    "Selenium needs a real browser driver — not available in Pyodide. Use `web_fetch`.",
  helium:
    "helium wraps Selenium — not available in Pyodide. Use `web_fetch`.",
  // Raw DB sockets
  psycopg2:
    "psycopg2 needs libpq + raw sockets — Pyodide has neither. Use the database's HTTP/REST endpoint via `web_fetch`/`web_post`.",
  psycopg:
    "psycopg3 needs libpq + raw sockets. Use the database HTTP/REST endpoint.",
  mysqlclient:
    "mysqlclient needs libmysql + raw sockets. Use an HTTP database proxy via `web_fetch`/`web_post`.",
  pymysql:
    "PyMySQL opens raw TCP to MySQL — unavailable in Pyodide. Use a database HTTP proxy.",
  pymongo:
    "pymongo opens raw TCP sockets — unavailable in Pyodide. Use MongoDB Data API via `web_post`.",
  motor:
    "motor is async pymongo — same TCP socket limitation. Use MongoDB Data API via `web_post`.",
  redis:
    "redis-py opens raw TCP — unavailable in Pyodide. Use Upstash/Redis REST endpoint via `web_post`.",
  aioredis:
    "aioredis opens raw TCP — unavailable in Pyodide. Use Upstash/Redis REST endpoint via `web_post`.",
  // SSH / shell
  paramiko: "paramiko requires raw sockets — unavailable in Pyodide.",
  fabric: "fabric requires SSH/raw sockets — unavailable in Pyodide.",
  invoke: "invoke spawns subprocess shells — unavailable in Pyodide.",
  // ML / AI — compiled C extensions not in Pyodide wheels
  torch:
    "PyTorch is not available in Pyodide (compiled CUDA/C++ extensions). For inference, call an API endpoint via `web_post`.",
  tensorflow:
    "TensorFlow is not available in Pyodide. For inference, call a hosted model API via `web_post`.",
  tf: "TensorFlow alias `tf` is not available in Pyodide.",
  keras:
    "Keras (TF-based) is not available in Pyodide. Use a hosted model API.",
  jax:
    "JAX requires compiled XLA extensions — not available in Pyodide.",
  transformers:
    "Hugging Face `transformers` requires PyTorch/TF and is not in Pyodide. Call the Inference API via `web_post`.",
  diffusers:
    "`diffusers` requires PyTorch — not in Pyodide. Use a hosted image-generation API.",
  xgboost:
    "XGBoost has no Pyodide wheel. Use scikit-learn alternatives (GradientBoostingClassifier) or a hosted API.",
  lightgbm:
    "LightGBM has no Pyodide wheel. Use scikit-learn or a hosted API.",
  catboost:
    "CatBoost has no Pyodide wheel. Use scikit-learn or a hosted API.",
  // Bioinformatics compiled deps
  rdkit:
    "RDKit requires compiled C++ extensions — not in Pyodide. Use a cheminformatics API or the RDKit JS port.",
  // Media/video processing
  cv2:
    "OpenCV (`cv2`) is not in Pyodide. Use `Pillow` for basic image ops, or process images server-side.",
  moviepy:
    "MoviePy requires ffmpeg binary at runtime — not available in Pyodide. Process video server-side.",
  whisper:
    "openai-whisper calls `ffmpeg` and loads large CUDA models — not available in Pyodide. Use a hosted transcription API (e.g. OpenAI Whisper API) via `web_post`.",
  // Audio
  librosa:
    "librosa requires compiled audio codecs (soundfile, audioread) that are not in Pyodide. Use a hosted audio API.",
  soundfile:
    "soundfile requires libsndfile native library — not in Pyodide.",
  pyaudio:
    "PyAudio requires PortAudio native library — not in Pyodide.",
  // Hallucinated / non-existent SDKs
  directus:
    "There is no PyPI `directus` package. Use the Directus REST API directly via `web_fetch`/`web_post`.",
  directus_sdk:
    "There is no Pyodide-compatible Directus SDK. Use the REST API directly via `web_fetch`/`web_post`.",
  firecrawl:
    "Use the Firecrawl REST API directly via `web_post` instead of the Python SDK.",
  vercel:
    "There is no `vercel` Python package. Use the Vercel REST API via `web_fetch`/`web_post`.",
  peft: "PEFT requires PyTorch/transformers — not available in Pyodide.",
  datasets: "Hugging Face `datasets` requires compiled deps — not available in Pyodide.",
  accelerate: "Hugging Face `accelerate` requires PyTorch — not available in Pyodide.",
  ultralytics: "Ultralytics YOLO requires PyTorch/CUDA — not available in Pyodide.",
  discord: "discord.py requires raw WebSocket/TCP — not available in Pyodide.",
  wikipedia:
    "The `wikipedia` module is not in Pyodide. Use Wikipedia REST API via `web_fetch` (`https://en.wikipedia.org/api/rest_v1/`).",
};

/**
 * Native binaries the script is trying to spawn via subprocess/os.system —
 * none of which exist in Pyodide. Map binary → suggestion.
 */
export const UNSUPPORTED_BINARIES: Record<string, string> = {
  // Office / document
  soffice: "LibreOffice (`soffice`) is not available. Use `python-docx`/`python-pptx`/`openpyxl` to edit office files in-place, or send the file to a server-side converter.",
  libreoffice: "LibreOffice is not available. Use pure-Python office libs (python-docx, python-pptx, openpyxl).",
  // PDF / image
  pdftoppm: "Poppler (`pdftoppm`) is not available. Rasterize PDFs server-side or extract text with `pypdf`.",
  pdftotext: "Poppler (`pdftotext`) is not available. Use `pypdf`'s `extract_text()` instead.",
  pdfimages: "Poppler (`pdfimages`) is not available. Use `pypdf` to walk image XObjects.",
  pdfinfo: "Poppler (`pdfinfo`) is not available. Use `pypdf.PdfReader` metadata instead.",
  gs: "Ghostscript is not available in Pyodide. Use `pypdf` for merge/split or a hosted PDF service.",
  ghostscript: "Ghostscript is not available. Use `pypdf` or a hosted PDF service.",
  qpdf: "`qpdf` is not available. Use `pypdf` for re-encryption/merge/split.",
  pdftk: "`pdftk` is not available. Use `pypdf` for merge/split/form fill.",
  convert: "ImageMagick `convert` is not available. Use `Pillow` (PIL) for image operations.",
  magick: "ImageMagick is not available. Use `Pillow` (PIL) for image operations.",
  // Document conversion
  pandoc: "`pandoc` is not available. Use `markitdown` or per-format Python libs (python-docx, pdfplumber, etc.).",
  wkhtmltopdf: "`wkhtmltopdf` is not available. Use `reportlab` or a hosted HTML-to-PDF API.",
  // OCR / audio / video
  tesseract: "`tesseract` is not available. Use a hosted OCR API via `web_post`.",
  ffmpeg: "`ffmpeg` is not available. For GIFs use `imageio` (no ffmpeg backend); for audio/video, call a hosted transcoding API.",
  ffprobe: "`ffprobe` is not available. Use a hosted media-analysis API.",
  whisper: "openai-whisper requires `ffmpeg` + large GPU models — not available. Use the OpenAI Whisper API or AssemblyAI via `web_post`.",
  // Compilers / build
  gcc: "`gcc` is not available — Pyodide cannot compile C at runtime.",
  cc: "C compilers are not available in Pyodide.",
  make: "`make` is not available in Pyodide.",
  cmake: "`cmake` is not available in Pyodide.",
  // HTTP / deployment CLI tools
  curl: "`curl` is not a Pyodide binary. Use `web_fetch`/`web_post`.",
  wget: "`wget` is not a Pyodide binary. Use `web_fetch`.",
  // VCS
  git: "`git` is not available in Pyodide. Use GitHub REST API via `web_fetch`/`web_post`.",
  gh: "`gh` CLI is not available. Use GitHub REST API via `web_fetch`/`web_post` (e.g. `https://api.github.com/repos/…`).",
  // Deploy / infra CLI
  vercel: "Vercel CLI is not available. Use the Vercel REST API (`https://api.vercel.com`) via `web_fetch`/`web_post`.",
  netlify: "Netlify CLI is not available. Use Netlify REST API via `web_fetch`/`web_post`.",
  flyctl: "Fly.io CLI is not available. Use Fly's GraphQL/REST API via `web_fetch`/`web_post`.",
  fly: "Fly.io CLI is not available. Use Fly's GraphQL/REST API via `web_fetch`/`web_post`.",
  railway: "Railway CLI is not available. Use Railway GraphQL API via `web_post`.",
  // macOS-specific
  xcodebuild: "`xcodebuild` requires Xcode on macOS — not available in Pyodide.",
  xcrun: "`xcrun` requires Xcode on macOS — not available in Pyodide.",
  simctl: "`simctl` requires Xcode on macOS — not available.",
  // Platform tools / shell utilities
  jq: "`jq` is not available. Parse JSON with Python's `json` stdlib module instead.",
  bc: "`bc` is not available. Use Python arithmetic directly.",
  awk: "`awk` is not available. Use Python `re`/`csv`/`io` stdlib instead.",
  sed: "`sed` is not available. Use Python `str.replace` / `re.sub` instead.",
  grep: "`grep` is not available as a binary. Use Python `re` or the `grep` tool.",
  find: "`find` is not available as a binary. Use Python `pathlib.Path.glob` or the `find_files` tool.",
  // External API CLIs
  firecrawl: "Firecrawl CLI is not available. Use the Firecrawl REST API (`https://api.firecrawl.dev`) via `web_post`.",
  stripe: "Stripe CLI is not available. Use the Stripe REST API via `web_fetch`/`web_post`.",
  heroku: "Heroku CLI is not available. Use the Heroku Platform API via `web_fetch`/`web_post`.",
  aws: "AWS CLI is not available. Use AWS service REST APIs via `web_fetch`/`web_post`.",
  az: "Azure CLI (`az`) is not available. Use Azure REST APIs via `web_fetch`/`web_post`.",
  azd: "Azure Developer CLI (`azd`) is not available. Use Azure REST APIs via `web_fetch`/`web_post`.",
  openclaw: "OpenClaw CLI is not available in Nodebox. Use built-in Web Agent tools instead.",
  duckdb: "DuckDB CLI is not available. Use `run_python` with Pyodide SQL or fetch CSV and parse with pandas.",
  docker: "Docker is not available in the browser sandbox.",
  kubectl: "kubectl is not available in the browser sandbox.",
  osascript: "osascript (macOS AppleScript) is not available in Nodebox.",
  mcporter: "mcporter MCP CLI is not available — configure MCP via `/mcp add` instead.",
  terraform: "Terraform CLI is not available. Use cloud provider REST APIs via `web_fetch`/`web_post`.",
  bicep: "Bicep CLI is not available. Use Azure REST APIs via `web_fetch`/`web_post`.",
  edirect: "NCBI EDirect tools are not available. Use NCBI E-utilities REST API via `web_fetch`.",
  coder: "Coder CLI is not available in Nodebox.",
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

/** Injected at Pyodide init — not a PyPI package. */
const RUNTIME_INJECTED_IMPORTS = new Set(["webagent"]);

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

export function preflightPythonForSkillFile(
  filePath: string,
  source: string
): PythonPreflight {
  const pre = preflightPython(source);
  if (pre.block) {
    return {
      ...pre,
      block: `${filePath}: ${pre.block}`,
    };
  }
  return pre;
}

export function preflightPython(
  source: string,
  declaredPackages: readonly string[] = []
): PythonPreflight {
  const warnings: string[] = [];
  const autoPackages: string[] = [];
  const micropipPackages: string[] = [];
  const text = String(source || "");

  // 1. Native binary spawn → hard block.
  const binary = findUnsupportedBinary(text);
  if (binary) {
    return {
      block: `run_python preflight: script invokes \`${binary.binary}\` via subprocess/os.system, which is not available in Pyodide (browser). ${binary.hint}`,
      autoPackages: [],
      micropipPackages: [],
      warnings,
    };
  }

  // 2. Imports.
  const imports = extractTopLevelImports(text);
  const declared = new Set(declaredPackages.map((p) => p.toLowerCase()));
  const unknownImports: string[] = [];

  for (const imp of imports) {
    if (STDLIB_TOP_LEVEL.has(imp)) continue;
    const lower = imp.toLowerCase();
    if (RUNTIME_INJECTED_IMPORTS.has(imp) || RUNTIME_INJECTED_IMPORTS.has(lower)) continue;

    if (KNOWN_BROKEN_IMPORTS[lower]) {
      return {
        block: `run_python preflight: import of '${imp}' is not supported in Pyodide. ${KNOWN_BROKEN_IMPORTS[lower]}`,
        autoPackages: [],
        micropipPackages: [],
        warnings,
      };
    }

    const micropip = MICOPIP_ALLOWLIST[imp] || MICOPIP_ALLOWLIST[lower];
    if (micropip && !declared.has(micropip.toLowerCase()) && !micropipPackages.includes(micropip)) {
      micropipPackages.push(micropip);
      continue;
    }

    const pkg = PYODIDE_PACKAGE_MAP[imp] || PYODIDE_PACKAGE_MAP[lower];
    if (pkg && !declared.has(pkg.toLowerCase()) && !autoPackages.includes(pkg)) {
      autoPackages.push(pkg);
      continue;
    }

    if (!micropip && !pkg) unknownImports.push(imp);
  }

  if (unknownImports.length) {
    warnings.push(
      `Unknown imports (${unknownImports.slice(0, 6).join(", ")}): not in Pyodide built-ins or micropip allowlist — may fail at runtime. Prefer web_fetch/webagent.http or rewrite.`
    );
  }
  if (micropipPackages.length) {
    warnings.push(
      `Will install via micropip (slower): ${micropipPackages.join(", ")}`
    );
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

  // 5. Host-only stdout/stderr APIs (common in skills written for CPython).
  if (/\bsys\.(?:stdout|stderr)\.reconfigure\s*\(/.test(text)) {
    warnings.push(
      "sys.stdout.reconfigure / sys.stderr.reconfigure are host-Python only — remove them for Pyodide or the script may crash with JsProxy errors."
    );
  }

  // 6. HTTP clients — urllib is proxy-shimmed; requests/httpx may still hit JsProxy.
  if (/\burllib\.request\.(?:urlopen|urlretrieve)\s*\(/.test(text)) {
    warnings.push(
      "Script uses urllib.request HTTP — routed via /api/proxy in Pyodide. For REST/CMS/GraphQL workflows, prefer agent `web_fetch`/`web_post`."
    );
  }
  if (/\bimport\s+requests\b|\bfrom\s+requests\b/.test(text)) {
    warnings.push(
      "Script imports `requests` — may hit Pyodide JsProxy issues. Prefer `webagent.http` inside run_python or `web_fetch`/`web_post` at agent level."
    );
  }
  if (/\bimport\s+httpx\b|\bfrom\s+httpx\b/.test(text)) {
    warnings.push(
      "Script imports `httpx` — may hit Pyodide JsProxy issues. Prefer `webagent.http` inside run_python or `web_fetch`/`web_post` at agent level."
    );
  }
  if (/\bimport\s+aiohttp\b|\bfrom\s+aiohttp\b/.test(text)) {
    warnings.push(
      "Script imports `aiohttp` — async HTTP is fragile in Pyodide. Prefer `webagent.http` or agent `web_fetch`/`web_post`."
    );
  }
  if (/\bhttp\.client\.(?:HTTPConnection|HTTPSConnection)\s*\(/.test(text)) {
    warnings.push(
      "Script uses http.client raw sockets — unavailable in Pyodide. Use `webagent.http` or agent `web_fetch`/`web_post`."
    );
  }
  if (/body_encoding|multipart\/form-data|[A-Za-z0-9+/]{500,}={0,2}/.test(text)) {
    warnings.push(
      "Script may embed large binary/base64 HTTP payloads — prefer agent `web_upload` (source_url/file_path) or `webagent.http.upload_file` so bytes stay out of chat context."
    );
  }

  return { autoPackages, micropipPackages, warnings };
}
