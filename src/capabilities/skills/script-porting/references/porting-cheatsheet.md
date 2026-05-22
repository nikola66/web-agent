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
