---
name: Browser Runtime Map
description: Use when shell commands fail, npx/curl/git won't run, or you must choose run_shell vs web_fetch vs file tools in Nodebox vs host.
version: 1.1.0
category: bundled
tags: [nodebox, shell, runtime, tools, webcontainer, run_shell, command-failed]
triggers: [shell failed, command failed, npx, curl, git clone, nodebox, no such file, not found in path, webcontainer, run this command]
---

## Tool contract (read first)

Canonical built-in tool picker. Other skills defer here for filesystem vs HTTP vs shell vs cron.

| Need | Use first |
|------|-----------|
| Read a file | `read_file` |
| Search file contents | `grep` |
| Find files by name (cross-tree) | `find_files` |
| List one directory | `list_dir` |
| Directory tree view | `tree` |
| Create or overwrite | `write_file` |
| Patch or multi-edit | `apply_patch`, `edit_file`, `multi_edit` |
| Move / delete | `move_file`, `delete_file` |
| Compare files | `file_diff` |
| HTTP(S) GET / API | `web_fetch` |
| Web search | `web_search` |
| Environment facts | `system_info` |
| Recurring jobs | `cron_register`, `cron_list` — **`heartbeat-cron`** |
| Show file to user | `artifact_present` — **`artifact-delivery`** |
| Image / audio / video | `vision_analyze`, `audio_analyze`, `youtube_transcribe` — **`multimodal-ingest`** |
| Memory / skills / wiki | see **`memory-layers`** (`memory_*`, `session_*`, `skill_list`, `skill_view`, `skill_manage`, `skill_bulk_save`, `wiki_*`) |
| One-off shell (last resort) | `run_shell` — host only; Nodebox: **`node …`** only |

**Non-negotiable:** No `curl`/`npx`/`git clone` when a row above fits. Nodebox has **no** POSIX shell. Skill installs: `skill_bulk_save` / `skill_manage`, never shell.

## When to Use

- Shell or command errors in the browser agent (`npx`, `curl`, `git`, pipes).
- Choosing between `run_shell`, `web_fetch`, file tools, or `cron_register`.
- Any "run this command" request — check surface before defaulting to shell.

## Relation to other skills

- Scheduled jobs: **`heartbeat-cron`**. Deliverables: **`artifact-delivery`**. Persistence: **`memory-layers`**.

## Surfaces

- **Nodebox / WebContainer**: no POSIX `sh -c`. `run_shell` only runs **`node …`**. No pipes, `npx`, `npm`, `curl`.
- **Host runtime**: real `run_shell` via `sh -c` when available — still prefer dedicated tools first.

## Procedure

1. Match the need to the table above before calling `run_shell`.
2. On Nodebox, use `web_fetch` instead of curl, dedicated file tools instead of shell file ops.
3. For cron, use `cron_register` — not host crontab or shell wrappers.

## Pitfalls

- Treating POSIX tutorials as literal in Nodebox.
- Using `run_shell` for skill installs — use HTTPS URL + `skill_manage` / `skill_bulk_save`.

## Anti-patterns

- Piping curl to bash when `web_fetch` exists.
- Putting `crontab`/`at` in shell — use `cron_register`.
