---
name: Imported Skill Compat
description: Use when the user or agent installs a skill from skills.sh or GitHub — map WebFetch, Bash, Python, Playwright, and MCP references to Web Agent built-ins.
version: 1.0.0
category: bundled
primary-tools: [skill, run_python, web_fetch, web_post]
tags: [skills, import, compatibility, skills.sh, webfetch, bash, python, playwright, mcp]
triggers: [imported skill, skills.sh install, skill compat, WebFetch, agent-browser, playwright skill, remote skill mapping, after skill install]
---

## Tool contract (read first)

| External (other hosts) | Web Agent |
|------------------------|-----------|
| WebFetch / fetch URL | `web_fetch` `{ url, headers? }` |
| POST / GraphQL | `web_post` — **`http-api`** |
| Read / Glob / Grep | `read_file` / `browse_workspace` (action=find) / `grep` |
| Skill / Read skill | `skill` `{ "action": "view", "name": "<slug>" }` |
| Bash / curl / npx | **`browser-runtime-map`** — Nodebox has no POSIX shell |
| Python / `.py` | `run_python` for Pyodide-compatible scripts |
| Python HTTP (`urllib`, `requests`) | `webagent.http` inside `run_python`, or `web_fetch`/`web_post` for REST/CMS — **`http-api`** |
| pip / native deps | No system pip; use Pyodide packages if available or replace the native dependency step |
| agent-browser / Playwright | **Not available** — `web_fetch` + file tools |
| MCP / CallMcpTool | `.webagent/mcp-servers.json` + `.webagent/mcp-secrets.json`; `write_file` on those paths returns `mcp_reload`; call registered `mcp_*` from ## MCP — not `web_post` to the MCP URL |
| Rendered-fetch provider (JS-heavy pages) | `web_fetch` only — not DOM automation; optional backend for markdown text |

**Non-negotiable:** After any remote install (`skill` action=manage import_url, `skill` action=bulk, `/skills install`), call `skill` (action=view) on the installed slug and follow its **Web Agent execution (auto-appended)** section before tool fan-out. Check `script_warnings` in the `skill` (action=view) result for per-file Pyodide preflight notes.

## When to Use

- User or agent just installed a skill from skills.sh, SkillsMP, or a raw GitHub `SKILL.md` URL.
- Imported skill prose mentions `WebFetch`, `Bash`, `npx`, Python, Playwright, agent-browser, or MCP.
- Agent loops on unavailable tools after following a third-party skill.

**Not for:** bundled workspace skills (already native) or listing registries (**`find-skills`**).

## Procedure

1. `skill` (action=view) this skill (**`imported-skill-compat`**) — refresh the mapping table.
2. `skill` (action=view) `{ "name": "<installed-slug>" }` — read the auto-appended **Web Agent execution** block, `compatibility_notes`, and **`script_warnings`** in the tool result.
3. `skill` (action=view) **`browser-runtime-map`** before the first filesystem/HTTP/shell choice.
4. If tier is **limited** (Python/Bash/MCP): use `run_python` for compatible Python and `skill` (action=view) **`http-api`** for API calls as needed.
5. If tier is **unsupported** (Playwright/agent-browser): do not retry `npx` or browser automation — substitute `web_fetch`, `read_file`, and source inspection.

## Compatibility tiers

| Tier | Meaning | Examples |
|------|---------|----------|
| **native** | No external-host tools | frontend-design (code-only body) |
| **mapped** | Direct built-in swap | web-design-guidelines (`WebFetch` → `web_fetch`) |
| **limited** | Needs Pyodide compatibility checks or host-only shell | pdf (Python), mcp-builder, tdd (shell), **skill-creator** (Python scripts + skip `claude -p`) |
| **unsupported** | No browser automation in Nodebox | agent-browser, webapp-testing (Playwright) |

Remote imports auto-append a **Web Agent execution (auto-appended)** section to saved `SKILL.md` files under `.webagent/skills/<category>/<slug>/`. Bundled skills under `.webagent/capabilities/skills/` (sandbox seed from host `src/capabilities/skills/`) are not patched — never install user skills there; use `skill` action=manage `import_dir` instead.

## Relation to other skills

- Install discovery: **`find-skills`**. Remote install rules: **`web-agent-skill`**. Runtime picker: **`browser-runtime-map`**. HTTP: **`http-api`**. Python: **`run_python`** + **`pyodide-runtime`** for WASM-safe codegen.

## Pitfalls

- Retrying `npx`, Playwright, or MCP tools after the compat appendix says they are unavailable.
- Skipping `skill` (action=view) on the installed slug and missing the auto-appended execution section.

## Anti-patterns

- Patching bundled skills instead of following the imported skill's Web Agent execution table.
- Installing Azure CLI or cloud MCP bundles without acknowledging unsupported tooling.
