---
name: Imported Skill Compat
description: Use when the user or agent installs a skill from skills.sh or GitHub — map WebFetch, Bash, Python, Playwright, and MCP references to Web Agent built-ins.
version: 1.0.0
category: bundled
tags: [skills, import, compatibility, skills.sh, webfetch, bash, python, playwright, mcp]
triggers: [imported skill, skills.sh install, skill compat, WebFetch, agent-browser, playwright skill, remote skill mapping, after skill install]
---

## Tool contract (read first)

| External (other hosts) | Web Agent |
|------------------------|-----------|
| WebFetch / fetch URL | `web_fetch` `{ url, headers? }` |
| POST / GraphQL | `web_post` — **`http-api`** |
| Read / Glob / Grep | `read_file` / `list_dir` / `find_files` / `grep` |
| Skill / Read skill | `skill_view` `{ name }` |
| Bash / curl / npx | **`browser-runtime-map`** — Nodebox: `run_shell` **`node …` only** |
| Python / pip / `.py` | **`script-porting`** + `python_to_node` |
| agent-browser / Playwright | **Not available** — `web_fetch` + file tools |
| MCP / CallMcpTool | **Not built-in** — add capability or use HTTP tools |

**Non-negotiable:** After any remote install (`skill_manage import_url`, `skill_bulk_save`, `/skills install`), call `skill_view` on the installed slug and follow its **Web Agent execution (auto-appended)** section before tool fan-out.

## When to Use

- User or agent just installed a skill from skills.sh, SkillsMP, or a raw GitHub `SKILL.md` URL.
- Imported skill prose mentions `WebFetch`, `Bash`, `npx`, Python, Playwright, agent-browser, or MCP.
- Agent loops on unavailable tools after following a third-party skill.

**Not for:** bundled workspace skills (already native) or listing registries (**`find-skills`**).

## Procedure

1. `skill_view` this skill (**`imported-skill-compat`**) — refresh the mapping table.
2. `skill_view` `{ installed-slug }` — read the auto-appended **Web Agent execution** block and `compatibility_notes` in the tool result.
3. `skill_view` **`browser-runtime-map`** before the first filesystem/HTTP/shell choice.
4. If tier is **limited** (Python/Bash/MCP): also `skill_view` **`script-porting`** and **`http-api`** as needed.
5. If tier is **unsupported** (Playwright/agent-browser): do not retry `npx` or browser automation — substitute `web_fetch`, `read_file`, and source inspection.

## Compatibility tiers

| Tier | Meaning | Examples |
|------|---------|----------|
| **native** | No external-host tools | frontend-design, skill-creator |
| **mapped** | Direct built-in swap | web-design-guidelines (`WebFetch` → `web_fetch`) |
| **limited** | Needs porting or host-only shell | pdf (Python), mcp-builder, tdd (shell) |
| **unsupported** | No browser automation in Nodebox | agent-browser, webapp-testing (Playwright) |

Remote imports auto-append a **Web Agent execution (auto-appended)** section to saved `SKILL.md` files under `.webagent/skills/`. Bundled skills under `src/capabilities/skills/` are not patched.

## Relation to other skills

- Install discovery: **`find-skills`**. Remote install rules: **`web-agent-skill`**. Runtime picker: **`browser-runtime-map`**. HTTP: **`http-api`**. Python ports: **`script-porting`**.

## Pitfalls

- Retrying `npx`, Playwright, or MCP tools after the compat appendix says they are unavailable.
- Skipping `skill_view` on the installed slug and missing the auto-appended execution section.

## Anti-patterns

- Patching bundled skills instead of following the imported skill's Web Agent execution table.
- Installing Azure CLI or cloud MCP bundles without acknowledging unsupported tooling.
