---
name: Browser Runtime Map
description: Pick the right tool in Web Agent—Nodebox vs host shell, filesystem vs HTTP, no fake shell pipelines in the browser runtime.
version: 1.0.0
category: bundled
tags: [nodebox, shell, runtime, tools, webcontainer]
---

## When to Use

- User hits "shell" or command errors in the browser agent.
- Choosing between `run_shell`, `web_fetch`, built-in file tools, or `cron_register`.
- Explaining why `npx`, `curl`, or `git` fail in chat.

## Surfaces

- **Nodebox / WebContainer** (`WEBAGENT_RUNTIME=nodebox`): there is **no** POSIX `sh -c`. `run_shell` only runs **`node …`** (single-node invocation). No pipes, no `npx`, `npm`, `curl`, arbitrary binaries.
- **Host / full runtime**: real `run_shell` via `sh -c` when available — still prefer dedicated tools first.

## Decision table

| Need | Use first |
|------|-----------|
| Read/search workspace files | `read_file`, `grep`, `find_files`, `list_dir`, `tree` |
| HTTP(S) page or API GET | `web_fetch` |
| Web search | `web_search` |
| Recurring work | `cron_register` (not host crontab) |
| Package installs, git, one-off shell you truly need | `run_shell` only when host shell exists and no dedicated tool fits |

## Rules

1. **`run_shell` is not a catch-all** — runtime text already lists preferred tools; follow that order.
2. **Nodebox**: use small `node -e` snippets if you must run JS; otherwise avoid shell entirely.
3. **Cron / heartbeat**: avoid `run_shell` in scheduled steps in Nodebox; `cron_register` examples use search/write/memory tools for a reason (see **`heartbeat-cron`**).

## Pitfalls

- Treating OpenClaw-style terminal tutorials as literal — they assume a full Linux shell.
- Using `run_shell` for skill installs — use `skill_bulk_save` / `skill_manage` with HTTPS URLs.

## Anti-patterns

- Piping curl to bash when `web_fetch` or search tools exist.
- Putting `crontab`/`at` in shell — use `cron_register`.
