---
name: Browser Runtime Map
description: Use when shell commands fail, npx/curl/git won't run, or you must choose run_shell vs web_fetch vs file tools in Nodebox vs host.
version: 1.1.0
category: bundled
primary-tools: [read_file, browse_workspace, grep, web_fetch, web_post, run_python, run_shell]
tags: [nodebox, shell, runtime, tools, webcontainer, run_shell, command-failed]
triggers: [shell failed, command failed, npx, curl, git clone, nodebox, no such file, not found in path, webcontainer, run this command]
---

## Tool contract (read first)

Canonical built-in tool picker. Other skills defer here for filesystem vs HTTP vs shell vs cron.

| Need | Use first |
|------|-----------|
| Read a file | `read_file` |
| Search file contents | `grep` |
| Find files by name (cross-tree) | `browse_workspace` `{ "action": "find", "pattern": "…" }` |
| List one directory | `browse_workspace` `{ "action": "list", "path": "…" }` |
| Directory tree view | `browse_workspace` `{ "action": "tree", "path": "…" }` |
| Create or overwrite | `write_file` |
| Single find/replace hunk | `edit_file` |
| Multiple find/replace hunks | `multi_edit` |
| Unified patch blocks | `apply_patch` |
| Patch or multi-edit (summary) | `apply_patch`, `edit_file`, `multi_edit` |
| Move / delete | `move_file`, `delete_file` |
| Compare files | `file_diff` |
| HTTP(S) GET (public or Bearer) | `web_fetch` (+ optional `headers`, `params`, `save_to`) — see **`http-api`** |
| CMS / single file upload (`/files`) | `web_upload` with `source_url` or `file_path` — never base64 in tool args |
| Binary download to workspace | `web_fetch` with `save_to` (metadata-only; then `web_upload.file_path`) |
| Mixed multipart (fields + file) | `web_post` with `multipart` array — see **`http-api`** |
| HTTP(S) POST/PATCH/PUT/DELETE/GraphQL | `web_post` (+ `json`, `form`, `params`, `timeout_ms`) — not for CMS file bytes |
| OAuth-connected SaaS (Gmail, LinkedIn, Slack, …) | `skill_view` **`composio-oauth`**, then `composio_status` → `composio_action`; never claim no access without status |
| DOM click/type automation | MCP browser tools (if configured via `/mcp add`) — see **`imported-skill-compat`** |
| JS-heavy page as markdown text | `web_fetch` (optional rendered-fetch provider when unauthenticated) |
| Web search | `web_search` |
| Environment facts | `system_info` |
| Recurring jobs | `cron_register`, `cron_list` — **`heartbeat-cron`** |
| Show file to user | `artifact_present` — **`artifact-delivery`** |
| **Create ZIP** (no `create_archive` tool) | **`run_python`** + stdlib **`zipfile`** → `work/<slug>/bundle.zip`, then **`artifact_present`** |
| **Extract / inspect ZIP** | **`extract_archive`** / **`archive_list`** (read-only) |
| Image / audio / video | `vision_analyze`, `audio_analyze`, `youtube_transcribe` — **`multimodal-ingest`** |
| Memory / skills / wiki | see **`memory-layers`** (`memory_*`, `session_*`, `skill_list`, `skill_view`, `skill_manage`, `skill_bulk_save`, `wiki_*`) |
| Skill has Python scripts | `run_python` first for stdlib/Pyodide-compatible scripts |
| Skill has bash scripts | Dedicated tools, or a small `node …`/`python3 …` script when a tool does not exist |
| One-off shell (last resort) | `run_shell` — Nodebox: **`node …`**, `python3 …` via Pyodide, plus simple read-only probes (`date`, `pwd`, `echo`, `wc -l`) |

**Non-negotiable:** No `curl`/`npx`/`git clone` when a row above fits. Nodebox has **no** POSIX shell. Skill installs: `skill_bulk_save` / `skill_manage`, never shell.

## When to Use

- Shell or command errors in the browser agent (`npx`, `curl`, `git`, pipes).
- Choosing between `run_shell`, `web_fetch`, file tools, or `cron_register`.
- Any "run this command" request — check surface before defaulting to shell.

## Relation to other skills

- **Full tool inventory:** each turn’s system prompt includes the **Tool capability index** (all built-ins + MCP, one line each). Deferred/MCP tools still need `tool_search` → `tool_activate` before calling; the index only lists what exists.
- Scheduled jobs: **`heartbeat-cron`**. Deliverables: **`artifact-delivery`**. Persistence: **`memory-layers`**.

## Surfaces

Three layers:

| Layer | Capability |
|-------|------------|
| **Nodebox API** | `shell.runCommand(binary, args, { cwd, env })` — bootstrap also uses `npm` |
| **Agent `run_shell`** | **`node …`, `python3 …` via Pyodide, plus simple read-only probes** — optional `cwd`, `env`; no POSIX `sh -c`, pipes, `curl`, `npx`, git, or package managers |
| **Python layer** | `run_python` lazy-loads Pyodide after Nodebox boot — no subprocess, system pip, native sockets, or arbitrary compiled wheels |

- Unsupported Nodebox commands return recovery metadata (`suggested_tool`, `suggested_next_step`) instead of acting like a real host shell.

## Procedure

1. Match the need to the table above before calling `run_shell`.
2. **HTTP decision:** GET/binary download → `web_fetch` (+ `save_to` for files); JSON/GraphQL writes → `web_post`; CMS `/files` → `web_upload`; mixed form+file → `web_post.multipart`. Call `skill_view` **`http-api`** before first API call. Never `run_shell` + axios for one-off HTTP. Never base64 bytes in tool args.
3. On Nodebox, use `web_fetch`/`web_post` instead of curl; dedicated file tools instead of shell file ops.
3. For cron, use `cron_register` — not host crontab or shell wrappers.

## Python in Pyodide — what works vs. what doesn't

| Python pattern | Status | Alternative |
|---|---|---|
| stdlib (`json`, `re`, `pathlib`, `csv`, …) | **Works** | — |
| `urllib.request` / `webagent.http` | **Works** (proxy-backed via `/api/proxy`) | Prefer `web_fetch`/`web_post`/`web_upload` for REST/CMS at agent level; `http.upload_file` in scripts |
| `zipfile` (create `.zip` bundles) | **Works** | No `create_archive` tool — use `run_python` + `zipfile`, output under `work/` or `projects/` |
| `Pillow`, `numpy`, `pandas`, `scipy`, `scikit-learn` | **Works** (auto-loaded) | — |
| `python-docx`, `python-pptx`, `openpyxl`, `pypdf`, `pdfplumber`, `reportlab` | **Works** (auto-loaded) | — |
| `requests`, `httpx`, `beautifulsoup4`, `pyyaml`, `pydantic`, `rich`, `click`, `tqdm` | **Mixed** — parsing/utils often work; HTTP via `requests`/`httpx` may hit JsProxy | Use `webagent.http` in-script or `web_fetch`/`web_post` for HTTP |
| `feedparser`, `wikipedia` (micropip allowlist) | **Works** (slower first run) | Auto-installed via micropip; prefer `web_fetch` for Wikipedia REST |
| `matplotlib`, `seaborn`, `imageio`, `Jinja2`, `markitdown` | **Works** (auto-loaded) | — |
| `subprocess` spawning `soffice`/`libreoffice` | **Blocked** — binary absent | `python-docx`/`python-pptx`/`openpyxl` |
| `subprocess` spawning `ffmpeg`/`ffprobe` | **Blocked** — binary absent | Call a hosted transcoding API |
| `subprocess` spawning `pdftoppm`/`pdftotext`/`ghostscript` | **Blocked** — binary absent | `pypdf` for text; rasterize server-side |
| `subprocess` spawning `tesseract`/`pytesseract`/`whisper` | **Blocked** — binary absent | Hosted OCR/transcription API |
| `subprocess` spawning `pandoc`/`wkhtmltopdf` | **Blocked** — binary absent | `markitdown`, `python-docx`, `reportlab` |
| `subprocess` spawning `git`/`gh`/`curl`/`wget` | **Blocked** — binary absent | `web_fetch`/`web_post` + GitHub REST API |
| `subprocess` spawning `vercel`/`netlify`/`fly`/`railway` | **Blocked** — binary absent | That service's REST API via `web_post` |
| `subprocess` spawning `xcodebuild`/`xcrun`/`simctl` | **Blocked** — macOS only | Not available in browser |
| `import pdf2image` | **Blocked** — needs poppler at runtime | `pypdf` |
| `import pytesseract` | **Blocked** — needs tesseract | Hosted OCR API |
| `import playwright` / `selenium` / `pyppeteer` | **Blocked** — needs Chromium | `web_fetch` + parsing |
| `import torch` / `tensorflow` / `jax` | **Blocked** — compiled GPU extensions | Hosted model inference API |
| `import cv2` (OpenCV) | **Blocked** — compiled C++ | `Pillow` for basic ops |
| `import whisper` (openai-whisper) | **Blocked** — needs ffmpeg + GPU | Hosted transcription API |
| `import rdkit` | **Blocked** — compiled C++ | Cheminformatics API or RDKit JS port |
| `import psycopg2`/`pymysql`/`pymongo`/`redis` | **Blocked** — raw TCP sockets | Database REST/HTTP API |
| raw `socket.socket(…)` | **Warn** — proxy may fail | `web_fetch`/`web_post` |

## CLI tools → REST API redirects

| CLI | REST alternative |
|---|---|
| `gh pr create` / `gh issue` | GitHub REST API `POST /repos/{owner}/{repo}/pulls` via `web_post` |
| `vercel --prod` | `POST https://api.vercel.com/v13/deployments` via `web_post` |
| `netlify deploy` | Netlify API `POST https://api.netlify.com/api/v1/sites/{id}/deploys` |
| `fly deploy` | Fly GraphQL `https://api.fly.io/graphql` via `web_post` |
| `railway up` | Railway GraphQL `https://backboard.railway.app/graphql/v2` via `web_post` |
| `heroku releases` | Heroku Platform API `https://api.heroku.com/apps/{app}/releases` |
| `stripe payments list` | Stripe API `GET https://api.stripe.com/v1/payment_intents` via `web_fetch` |
| `firecrawl scrape` | `POST https://api.firecrawl.dev/v1/scrape` via `web_post` |
| `git clone` | Upload zip → `extract_archive`, or use GitHub API to fetch files |
| Create a zip bundle | **`run_python`** + `zipfile.ZipFile` — there is **no** `create_archive` tool |

## Create ZIP archives (no `create_archive` tool)

**Read:** `extract_archive` / `archive_list`. **Write:** only via **`run_python`** and stdlib `zipfile` (Pyodide-safe).

1. Stage files under `work/<slug>/` or `projects/<slug>/` with `write_file` / `make_dir`.
2. Run a short `run_python` script that writes `work/<slug>/bundle.zip` (never workspace root).
3. Verify with `archive_list`, deliver with `artifact_present` (`path` to the `.zip`).

```python
import zipfile
from pathlib import Path

root = Path("work/my-bundle")
out = root / "bundle.zip"
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for f in root.rglob("*"):
        if f.is_file() and f != out:
            zf.write(f, f.relative_to(root))
print(out.as_posix())
```

Do **not** use `run_shell` + `zip`/`tar` CLI, invent `create_archive`, or fall back to a `.txt` concat unless the user explicitly accepts that format.

## Pitfalls

- Treating POSIX tutorials as literal in Nodebox.
- Treating Pyodide as full host CPython — use `run_python` for compatible scripts; rewrite subprocess, system pip, native sockets, or unsupported wheel steps.
- Using `run_shell` for skill installs — use HTTPS URL + `skill_manage` / `skill_bulk_save`.
- Invoking deploy CLIs (`vercel`, `gh`, `netlify`) when the service has a documented REST API.

## Anti-patterns

- Piping curl to bash when `web_fetch` exists.
- Putting `crontab`/`at` in shell — use `cron_register`.
- Calling `npm install -g <cli>` then using the CLI — use the REST API directly.
