---
name: Pyodide Runtime
description: Use when writing or fixing Python for run_python — browser WASM Pyodide contract, forbidden APIs, package substitutes, and webagent.http.
version: 1.0.0
category: bundled
primary-tools: [run_python, web_fetch, web_post, web_upload, skill_view]
tags: [pyodide, python, wasm, browser, run_python, micropip, webagent.http]
triggers: [run_python, pyodide, python script, micropip, browser python, wasm python, python in browser, incompatible python]
---

## Tool contract (read first)

| Need | Use |
|------|-----|
| Run Python in workspace | `run_python` (`code` or `path`, optional `cwd`, `env`, `packages`, `timeout_ms`) |
| One-off REST from agent | `web_fetch` / `web_post` / `web_upload` — not `requests` in chat args |
| HTTP inside a reusable `.py` | `import webagent.http as http` (proxy-backed) |
| File bytes to API | `http.upload_file` in script, or agent `web_upload` |
| Shell / git / curl / npx | **`browser-runtime-map`** — not available in Nodebox |
| Import map & blocks | Static preflight before worker; see **`browser-runtime-map`** Pyodide table |

**Non-negotiable:** Read this skill (or `skill_view` **`browser-runtime-map`**) before generating Python. Capability manifest: `src/runtimes/webcontainer/pyodide-capabilities.json`. Substitution patterns: `src/runtimes/webcontainer/pyodide-substitution-matrix.json`.

## When to Use

- Any `run_python` call or skill script that will execute in the browser.
- User asks for Python that assumes Linux, pip, subprocess, localhost, or native wheels.
- Preflight blocked the script or returned `pyodide_*` errors.

**Not for:** simple PDF/DOCX text extraction — try `pdf_extract` / `docx_extract` first.

## Runtime contract (Pyodide)

Your execution environment is **not** native Python.

| Fact | Implication |
|------|-------------|
| Pyodide + WASM in a browser tab | No OS, no Docker, no real `/home/user` |
| Virtual Emscripten FS | Write under `run_python` `cwd`; host mirrors workspace |
| No subprocess / native binaries | No `soffice`, `git`, `ffmpeg`, `pdftoppm`, `tesseract`, … |
| No raw TCP | No `psycopg2`, `pymongo`, `redis`, `socket.create_connection` |
| Networking = browser fetch | CORS + `/api/proxy`; use `webagent.http` or agent HTTP tools |
| Threads limited | Prefer async + `await asyncio.sleep(0)` for long work |
| Packages | Stdlib, Pyodide wheels (auto-loaded), micropip allowlist only |

### Forbidden (never generate)

`subprocess`, `multiprocessing`, `os.system`, `pty`, `pexpect`, `signal`, `resource`, `pwd`, `grp`, `fcntl`, `asyncio.create_subprocess_exec`, `playwright`, `selenium`, `torch`, `tensorflow`, `cv2`, `pdf2image`, host DB drivers opening TCP.

### Avoid (prefer alternatives)

`threading` for parallelism, raw `socket` clients, `requests`/`httpx` for new code (use `webagent.http`), `sys.stdout.reconfigure`, `LD_PRELOAD` / `ctypes.CDLL("*.so")`, unbounded sync loops.

### Preferred stack (priority order)

1. Browser-native: agent `web_fetch` / `web_post` / `web_upload`
2. In-script: `import webagent.http as http`
3. Stdlib: `json`, `csv`, `pathlib`, `zipfile`, `re`, `hashlib`, …
4. Pyodide wheels: `pypdf`, `python-docx`, `openpyxl`, `Pillow`, `numpy`, … (often auto-loaded)
5. `pyodide.http.pyfetch` only when same-origin/CORS allows direct fetch

### Decision checklist (before codegen)

1. Will this run in browser WASM?  
2. Does it need OS access, binaries, or real TCP?  
3. Does it block the UI thread?  
4. Is every import stdlib, Pyodide-bundled, or micropip-allowlisted?

If any answer is wrong → redesign (see substitution matrix).

### Good vs bad HTTP

```python
# Good — inside run_python
import webagent.http as http
resp = http.get("https://api.example.com/data")
data = resp.json()

# Bad — host assumptions
import requests
requests.get("http://localhost:3000")
```

## Relation to other skills

- Tool picker & CLI redirects: **`browser-runtime-map`**
- HTTP field shapes: **`http-api`**
- Imported skills.sh scripts: **`imported-skill-compat`** (`script_warnings` from preflight)
- ZIP create: stdlib `zipfile` here; extract: `extract_archive`

## Pitfalls

- Treating `run_shell python3` as full CPython — use `run_python` with Pyodide rules.
- `pip install` in script — use `packages` arg or preflight auto-load / micropip allowlist.
- Assuming `~/.config`, `/var/tmp`, or persistent paths outside workspace cwd.
- Large base64 bodies in HTTP tool args — use `web_upload` / `http.upload_file`.

## Anti-patterns

- `subprocess.run(["git", …])` or `os.system("curl …")` in browser Python.
- `import playwright` / `from pdf2image import convert_from_path` after preflight already warned.
- `while True: pass` without `timeout_ms` on the tool call.
