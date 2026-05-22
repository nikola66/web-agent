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
| Construct hints for a `.py` snippet | `python_to_node` |
| Read Python source | `read_file`, `skill_view` (support paths), or `web_fetch` (raw GitHub) |
| Write ported script | `skill_manage` `write_file` → `scripts/<name>.js` under the skill folder |
| Patch skill docs | `skill_manage` `patch` / `edit` — replace Python CLI with `node scripts/…` |
| Run ported script | `run_shell` — **`node scripts/foo.js …`**, set **`cwd`** to the skill folder, optional **`env`** for API tokens — see **`browser-runtime-map`** |
| HTTP from script | `fetch` in ESM (Nodebox routes via browser network stack) |
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

1. **Detect** — After `skill_view`, scan for `python`, `pip install`, `.py`, `python -m`. Call `python_to_node` with source or path for hints.
2. **Load sources** — `read_file` or `skill_view` with `file_path`, or `web_fetch` raw GitHub URLs for repo scripts not yet in workspace.
3. **Port** — Write ESM to `scripts/<basename>.js` (same basename as the `.py` file when possible). Use `import`/`export`, top-level `await` or async IIFE for `main`.
4. **Patch docs** — Update the skill's `SKILL.md` CLI section: replace `python …` / `pip install` with `node scripts/….js` and note env vars.
5. **Verify** — `run_shell` with `command`, `cwd` (skill root, e.g. `.webagent/skills/imported/<slug>`), and `env` when the Python script used `os.getenv`. Use `python_to_node` → `run_shell_example` as a template.
6. **Persist** — Save via `skill_manage` `write_file`; keep Python sources only as reference if needed under `references/`.

## Nodebox: API vs agent policy vs runtime

Three layers — do not conflate them:

| Layer | What it is | Implication |
|-------|------------|-------------|
| **Nodebox API** | [`shell.runCommand(binary, args, { cwd, env })`](https://github.com/Sandpack/nodebox-runtime/blob/main/packages/nodebox/api.md) — programmatic shell | Can spawn `node`, and bootstrap uses `npm`; supports `cwd` + `env` |
| **Agent `run_shell`** | Web Agent policy on top of Nodebox | **`node …` only** for the model — no `python`, `curl`, pipes, or arbitrary binaries |
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
