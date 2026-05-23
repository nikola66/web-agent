---
name: Script Porting
description: Use when a skill or task references python, pip install, python3 tools/, bash scripts, or run_shell with non-node commands — port to node scripts/*.js for Nodebox.
version: 1.0.0
category: bundled
tags: [python, node, porting, scripts, nodebox, run_shell, pip]
triggers: [python script, pip install, port to node, run_shell python, python3 tools, python -m, bash script, .py file, cannot run python]
---

## Tool contract (read first)

Canonical procedure for porting Python/bash skill scripts to JavaScript runnable in Nodebox.

| Need | Use first |
|------|-----------|
| Full porting procedure | This skill (`skill_view` **`script-porting`**) |
| REST / GraphQL call shapes | `skill_view` **`http-api`** |
| Construct compatibility report for a `.py` snippet | `python_to_node` |
| Read Python source | `read_file`, `skill_view` (support paths), or `web_fetch` (raw GitHub) |
| Write ported script | `skill_manage` `write_file` → `scripts/<name>.js` under the skill folder |
| Patch skill docs | `skill_manage` `patch` / `edit` — replace Python CLI with `node scripts/…` |
| Run ported script (local logic) | `run_shell` — **`node scripts/foo.js …`**, **`cwd`**, optional **`env`** |
| HTTP GET (API read) | `web_fetch` + `headers` (Bearer) — not run_shell axios |
| HTTP POST / GraphQL | `web_post` + `headers` + `body` |
| HTTP inside long script only | global `fetch` in ESM (last resort) |
| Secrets / API tokens | Settings vault / env vars — never hardcode in scripts |

**Non-negotiable:** Nodebox has **no Python/pip binary** in its runtime. Agent `run_shell` runs **`node …` only** (not arbitrary `shell.runCommand` binaries). Port Python skill steps first.

## When to Use

- Imported skill documents `pip install`, `python -m`, `python3 tools/*.py`, or shell steps with `.py` paths.
- User asks to run a Python script or API helper from a skill in the browser agent.
- Skill import returned a warning about Python content.
- Cron or task steps reference bash/Python — rewrite as `node` scripts or dedicated tools.

## Relation to other skills

- Shell vs HTTP vs files: **`browser-runtime-map`**. Skill installs: **`web-agent-skill`**. Cron steps: **`heartbeat-cron`**.

## Procedure

1. **Detect** — After `skill_view`, scan for `python`, `pip install`, `.py`, `python -m`. Call `python_to_node` with source or path for compatibility tier, library recipes, templates, and cache-backed hints.
2. **Load sources** — `read_file` or `skill_view` with `file_path`, or `web_fetch` raw GitHub URLs for repo scripts not yet in workspace.
3. **Port** — Write ESM to `scripts/<basename>.js` (same basename as the `.py` file when possible). Use `import`/`export`, top-level `await` or async IIFE for `main`.
4. **Patch docs** — Update the skill's `SKILL.md` CLI section: replace `python …` / `pip install` with `node scripts/….js` and note env vars.
5. **Verify** — `run_shell` with `command`, `cwd` (skill root, e.g. `.webagent/skills/imported/<slug>`), and `env` when the Python script used `os.getenv`. Use `python_to_node` → `run_shell_example` as a template.
6. **Persist** — Save via `skill_manage` `write_file`; keep Python sources only as reference if needed under `references/`.

## Procedural skill bundles (e.g. [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator))

Skills that ship `scripts/`, `eval-viewer/`, `references/`, and `agents/` need the **full tree**, not just `SKILL.md`.

| Step | Web Agent |
|------|-----------|
| Install full tree | `skill_manage` **`import_dir`** on an extracted folder, **or** `skill_bulk_save` with `content` + `files[]` from `web_fetch` raw GitHub URLs |
| URL-only import | `import_url` saves `SKILL.md` only — then `web_fetch` + `skill_manage` `write_file` for support files |
| Port each script | `python_to_node` per `.py` → `scripts/<name>.js` |
| Patch SKILL.md | Replace `python -m scripts.*` with `node scripts/*.js`; use **`--static`** for eval viewer HTML |
| Eval viewer | Port `generate_review.py` static mode → `artifact_present`; skip `webbrowser.open` / `HTTPServer` |
| Benchmark aggregate | `aggregate_benchmark.py` ports cleanly (json/pathlib/math) |
| Package .skill zip | `package_skill.py` / `zipfile` — optional skip or manual port |
| Description optimization | `run_loop.py` / `run_eval.py` use **`claude -p`** — **skip in Web Agent** |
| Parallel eval runs | `ProcessPoolExecutor` → sequential runs or **Task** subagents |

**Non-negotiable:** Do not run `python`, `pip`, `nohup python`, or `claude -p` in Nodebox. The skill-creator **workflow** works; Claude Code CLI automation scripts do not run verbatim.

## Nodebox: API vs agent policy vs runtime

Three layers — do not conflate them:

| Layer | What it is | Implication |
|-------|------------|-------------|
| **Nodebox API** | [`shell.runCommand(binary, args, { cwd, env })`](https://github.com/Sandpack/nodebox-runtime/blob/main/packages/nodebox/api.md) — programmatic shell | Can spawn `node`, and bootstrap uses `npm`; supports `cwd` + `env` |
| **Agent `run_shell`** | Web Agent policy on top of Nodebox | **`node …` plus simple read-only probes** for the model — no `python`, `curl`, pipes, git, package managers, or arbitrary binaries |
| **Nodebox runtime** | In-browser Node.js VM | **No Python/pip binary** — port to JS even if the API allowed other binaries |

`npm install` may run during app bootstrap; the agent must not rely on pip/npm in skill steps — port logic inline.

## Python → Node mapping

See **`references/porting-cheatsheet.md`** for the full table. Common cases:

| Python | Node (ESM) |
|--------|------------|
| `requests.get/post` | `fetch(url, { method, headers, body })` |
| `argparse` / `sys.argv` | `process.argv` or `node:util` `parseArgs` |
| `os.environ` / `os.getenv` | `process.env` |
| `json.loads` / `dumps` | `JSON.parse` / `JSON.stringify` |
| `pathlib.Path` | `node:path` (`join`, `dirname`, `basename`) |
| `open(path).read()` | `node:fs/promises` `readFile` |
| `if __name__ == "__main__"` | top-level async IIFE or `main().catch(...)` |
| `print(x)` | `console.log(x)` |
| `None` | `null` |

## Famous Python tools: preferred alternatives

| Python tool | Web Agent / Nodebox alternative |
|-------------|----------------------------------|
| `requests`, `httpx`, `aiohttp`, `urllib` | Prefer `web_fetch` / `web_post`; use global `fetch` only inside reusable ESM scripts. |
| `BeautifulSoup` / `bs4` | `web_fetch` + simple title/text/link extraction helpers from `python_to_node.templates`; full selector logic needs manual redesign. |
| `argparse`, `sys.argv` | `node:util parseArgs` or `process.argv.slice(2)`. |
| `dotenv`, `os.getenv`, `os.environ` | `process.env`; pass secrets through `run_shell.env` or Settings/vault. |
| `json`, `csv`, `pathlib`, `glob`, `shutil`, `logging`, `time`, `datetime` | Node built-ins plus small helpers from `python_to_node.templates`. |
| `pandas`, `numpy`, `matplotlib` | Manual redesign: port only the needed transform or emit markdown/Mermaid/SVG artifacts. |
| `selenium`, `playwright` | Manual redesign around Web Agent web tools; do not assume browser automation packages in Nodebox. |
| `subprocess`, `pip`, `python -m` | Unsupported directly; replace with Web Agent tools or `node scripts/<name>.js`. |

## Nodebox constraints

- **ESM only** — `import` / `export`; avoid `require` unless the runtime explicitly supports it.
- **HTTP** — use global `fetch`; no `curl` from scripts.
- **No** `child_process`, **no pip** in agent steps (bootstrap may use `npm` internally — not for skill procedures).
- **Secrets** — read from `process.env` in scripts; pass per-run values via `run_shell` **`env`**, or configure in Settings/vault.

## Verification

Example (skill-local script with env):

```json
{
  "command": "node scripts/sync.js --dry-run",
  "cwd": ".webagent/skills/imported/my-skill",
  "env": { "API_TOKEN": "<from Settings/vault>" }
}
```

- Compare stdout, stderr, and exit code to what the Python script was meant to produce.
- Prefer `cwd` at the **skill folder** so `scripts/foo.js` resolves without absolute paths.

## Pitfalls

- Leaving `python …` commands in `SKILL.md` after porting.
- Using `require` or assuming native npm packages without vendoring.
- Calling `run_shell` with `pip install` or `python3` on Nodebox.
- Hardcoding API tokens in ported scripts.

## Anti-patterns

- Skipping `skill_view` **`script-porting`** when import warnings mention Python.
- Porting only the skill text but not the executable scripts under `scripts/`.
- Using `web_fetch` for logic that belongs in a reusable `node` script the user can re-run.
