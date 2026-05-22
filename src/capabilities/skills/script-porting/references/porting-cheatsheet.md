# Python → Node porting cheatsheet (Nodebox)

| Python | Node (ESM) |
|--------|------------|
| `import os` | `process.env` for env; no direct equivalent for all of `os` |
| `os.environ["X"]` / `os.getenv("X")` | `process.env.X` (or `run_shell` `env: { X: "…" }`) |
| `import sys; sys.argv` | `process.argv` (index 2+ for args after `node script.js`) |
| `argparse` | `import { parseArgs } from "node:util"` or manual `process.argv` parsing |
| `import json` | `JSON.parse` / `JSON.stringify` |
| `import pathlib` / `Path` | `import path from "node:path"` |
| `open(path).read()` | `import fs from "node:fs/promises"; await fs.readFile(path, "utf8")` |
| `requests.get(url)` | `await fetch(url)` then `await res.text()` or `.json()` |
| `requests.post(url, json=data)` | `await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })` |
| `httpx` / `aiohttp` / `urllib` | `web_fetch` / `web_post` for tool calls, or global `fetch` in ESM scripts |
| `BeautifulSoup(html, "html.parser")` | Simple title/text/link helpers from `python_to_node.templates`; no full DOM parser bundled |
| `import csv` | `fs.readFile` + simple CSV helper for basic CSV; complex quoted CSV needs manual handling |
| `glob.glob("**/*.md")` | Recursive `fs.readdir(..., { withFileTypes: true })` walk helper |
| `shutil.copyfile/move/rmtree` | `fs.copyFile`, `fs.rename`, `fs.rm` or Web Agent file tools |
| `logging.info/error` | `console.log` / `console.error` |
| `time.time()` / `datetime.utcnow()` | `Date.now()` / `new Date().toISOString()` |
| `pandas` / `numpy` | Manual redesign; port only the needed transformation with arrays/CSV/JSON |
| `matplotlib` | Markdown table, Mermaid, or inline SVG artifact |
| `selenium` / `playwright` | Manual redesign around Web Agent web tools; no package assumed in Nodebox |
| `subprocess.run(...)` | Unsupported; replace with dedicated tools or inline JS |
| `if __name__ == "__main__":` | `main().catch((e) => { console.error(e); process.exit(1); })` |
| `print(x)` | `console.log(x)` |
| `None` | `null` |
| `True` / `False` | `true` / `false` |
| `dict.get(k, default)` | `obj[k] ?? default` |
| `[x for x in items if cond]` | `items.filter((x) => cond)` |
| `try/except Exception as e:` | `try/catch (e)` |
| `raise ValueError("msg")` | `throw new Error("msg")` |
| `__main__` CLI module | `node scripts/name.js arg1 arg2` |

Run template: `node scripts/<basename>.js [args…]`
