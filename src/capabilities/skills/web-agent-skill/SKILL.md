---
name: Web Agent Skill
description: Use when fixing or extending Web Agent itself—runtime, bundled skills, capabilities, adapter, or self-evolution of this repo.
version: 1.1.0
category: bundled
primary-tools: [skill, capability_list, read_file]
tags: [web-agent, self-evolution, maintenance, skills, memory, cron, capability]
triggers: [web agent, this agent, bundled skill, capability folder, fix runtime, self-evolution, improve skill, web-agent repo, skill tool, capability_list]
---

## Tool contract (read first)

Maintainer scope only — not everyday user tasks. Do **not** embed the full tool catalog here; use hub skills.

| Need | Tool / skill |
|------|----------------|
| Runtime environment | `system_info` |
| Installed capability folders | `capability_list` |
| Read bundled skill bodies | `skill` (action=list, action=view) |
| Patch / install skills | `skill` (action=manage, action=bulk) |
| Inspect repo files | `read_file`, `grep`, `list_dir` — see **`browser-runtime-map`** |
| Facts / session / wiki | **`memory-layers`** |
| Deliverables / artifacts | **`artifact-delivery`**, **`chart`** |
| Cron / heartbeat jobs | `cron_list`, `cron_register` — **`heartbeat-cron`** |
| Tool picker (everything else) | **`browser-runtime-map`** |

**Non-negotiable:** Remote skill installs via HTTPS URLs + `skill` action=bulk / action=manage — never `run_shell`, `npx`, or `git clone`. Confirm with `skill` action=list + action=view after install.

## When to Use

- Work is about **Web Agent itself**: capabilities, runtime tools, bundled skills, adapter, UI, or this repository.
- Debugging runtime behavior, improving procedural knowledge, or adapting external agent packs into Web Agent.
- User asks for self-maintenance, skill improvement, or installing remote `SKILL.md` URLs correctly.
- Not for everyday user tasks—use sibling skills unless maintainer scope applies. For multi-step plan+execute use **`task-execution`**; for diagnosis loops use **`systematic-debugging`**.

## Relation to other skills

- Tool picker: **`browser-runtime-map`**. Persistence: **`memory-layers`**. Delivery: **`artifact-delivery`**. Cron authoring: **`heartbeat-cron`**.

This skill is for self-maintenance. It is not a static tool catalog and it does not grant new permissions.

## Live Runtime First

1. Start from current runtime truth, not memory. Use `system_info` for environment assumptions and `capability_list` for installed capability folders.
2. Use `skill` (action=list) to find relevant skills and `skill` (action=view) to read the full `SKILL.md` before following or editing a procedure.
3. Inspect the current repository and nearby tests before changing behavior. Prefer present source files, registry manifests, and focused tests over remembered inventories.
4. Treat facts, session notes, reflections, and learnings as hints that need confirmation against current runtime outputs or files.

### Runtime and tools

Follow the **canonical** tool-choice map: call `skill` (action=view) **`browser-runtime-map`** before reasoning about `run_shell`, HTTP, filesystem, or cron. Recurring jobs: **`heartbeat-cron`** (not host crontab or shell-heavy steps on Nodebox). Skill installs use `skill` (action=bulk) / `skill` (action=manage) with URLs—never shell clone/fetch.

## Persistence Ladder

Call `skill` (action=view) **`memory-layers`** for facts vs session vs skills. Reference tools: `memory_save`, `memory_recall`, `memory_search`, `session_memory_append`, `session_memory_list`, `session_search` (when to use each is defined there—not duplicated here). For maintainer work on Web Agent itself, keep this in addition:

- Use `cron_list` / `cron_register` for recurring checks while the app is open (authoring detail: **`heartbeat-cron`**).
- Treat reflections and promotable learnings as signal—confirm against code/runtime before promoting; do not create parallel manual stores.
- Promote only durable procedural knowledge into skills (repeatable trigger + step sequence).

## Self-Evolution Loop

1. Reproduce the problem or identify the missing capability with the smallest concrete example.
2. Inspect the live layer that owns the behavior: runtime tool, capability folder, bundled skill, memory surface, UI, or nearby test.
3. Fix the narrowest correct layer. Prefer patching an existing skill or implementation over adding overlapping instructions or duplicate systems.
4. Verify with the smallest relevant test or command first, then broader validation only if the change touches shared behavior.
5. Capture the reusable lesson in the correct persistence layer.
6. Patch this skill or a sibling skill only when the lesson is procedural, repeatable, and worth reusing in future sessions.

### Hermes-style background self-improvement

After enough tool iterations (default **8** without a foreground skill write), the runtime may spawn a **post-turn background review** that replays the conversation snapshot with a restricted tool set (`skill_*`, `memory_*`) and the full Hermes-style skill review prompt. This runs **after** the user-visible response and does not block the main turn.

- Skill review trigger is **interval-only** (`WEBAGENT_SKILL_REVIEW_INTERVAL`) — not tied to todo/plan gates.
- Memory review interval defaults to every **8 user turns** (`WEBAGENT_MEMORY_REVIEW_INTERVAL`).
- Background review agent loop caps at **12** rounds (`WEBAGENT_BACKGROUND_REVIEW_MAX_ROUNDS`).
- Skills created in background review are marked `created_by: agent` in `.webagent/skills/.usage.json` and are eligible for curator consolidation.
- Foreground `skill` (action=manage) / `skill` (action=bulk) resets the skill counter (same as Hermes).
- User-visible summary lines look like: `Self-improvement review: Skill 'x' updated · Memory updated`.

### Curator (skill library maintenance)

On heartbeat ticks (tab open), a curator pass may run about weekly (`WEBAGENT_CURATOR_INTERVAL_MS`, default 7 days):

- Auto-marks stale/archived agent-created skills by idle age.
- Spawns a consolidation review to merge overlapping session skills into class-level umbrellas.
- Never hard-deletes; archives move to `.webagent/skills/.archive/`.
- Pinned skills (`.usage.json`) skip auto transitions.

## Skill Write Autonomy

When the user explicitly asks for self-evolution, self-maintenance, or skill improvement, Web Agent may patch or create skills directly without asking for a second approval step for the skill file itself.

Use:

- `skill` (action=manage) for targeted skill updates, especially `action: "patch"` for local changes.
- `skill` (action=bulk) when adding or updating many skills in one operation.
- support files only under the allowed skill folders such as `references/`, `templates/`, `scripts/`, or `assets/`.

### Remote SKILL.md installs (from the internet)

- Collect **per-file** HTTPS `SKILL.md` URLs (a GitHub repo home URL is not a skill document; use `web_fetch` on the GitHub tree API or equivalent to list paths, then build raw or blob URLs per file).
- Call `skill` (action=bulk) with `urls` (or top-level `url` for one file, or `items: [{ url }, ...]`). At most **75** URLs per call; repeat for larger packs.
- One remote file without the batch approval flow: `skill` (action=manage) with `action: install_url` or `import_url` plus `url`.
- Never use `run_shell`, `npx`, or `git clone` to install skills; the runtime fetches and validates URL imports itself.
- Afterward, confirm with `skill` (action=list) and `skill` (action=view).

#### Curated awesome-list repos

Some GitHub repos are **indexes** (README + outbound links only) — they do not host `SKILL.md` files.

1. `web_fetch` the README and inspect what you actually got (HTML list vs file tree).
2. Collect **officialskills.sh / skills.sh / skillsmp** or **source-repo** links from entries — do not guess `raw.githubusercontent.com/{list-repo}/...` paths from labels alone.
3. Pass resolved registry or raw/tree URLs to `skill` (action=bulk).
4. If a batch fails: pivot — `web_fetch` registry pages, `web_search` for the skill on skills.sh or GitHub, try alternate repo layouts.
5. Only declare a blocker after **≥2 pivot strategies** are exhausted.

This autonomy applies to skill files. Repository code changes still follow the user request and normal implementation workflow.

## Promotion Rules

Promote into a skill only when the learning is procedural and durable:

- repeated bug pattern with a stable fix path,
- reliable verification sequence,
- reusable adaptation workflow,
- non-obvious runtime constraint that changes how work should be done.

Keep one-off facts, temporary failures, and project-local details out of skills when they belong in facts, session notes, or current code/tests instead.

## Adapting External Systems

When the user points to another agent, skill pack, prompt library, or tool repository, inspect it first and adapt its useful behavior into Web Agent primitives instead of copying it unchanged.

Map source behavior into current Web Agent layers:

- procedural instructions into `SKILL.md`,
- reusable support material into `references/`, `templates/`, `scripts/`, or `assets/`,
- runtime behavior into existing built-in tools or capability folders only when a skill is not enough,
- long-lived facts or preferences into memory tools instead of hidden agent-specific files.

Do not import stale tool catalogs, foreign hook systems, or platform-specific assumptions that Web Agent does not use.

## Guardrails

- Do not maintain static copies of the full runtime tool list inside a skill.
- Do not create parallel learning folders, shadow memory systems, or copied capability inventories.
- Do not add a new skill when patching an existing relevant skill is enough.
- Do not claim a self-evolution fix is complete until the changed behavior or skill has been verified.

## Verification

After skill maintenance:

1. Confirm the skill is discoverable with `skill` (action=list).
2. Confirm the full document or support file loads with `skill` (action=view).
3. Confirm the compact skills context still contains metadata only, not the full procedural body.
4. If Web Agent runtime behavior changed, run the smallest relevant tests first, then broader validation if needed.

## Pitfalls

- Patching bundled skills instead of user skills in `.webagent/skills/`.
- Installing skills via shell instead of HTTPS URL imports.

## Anti-patterns

- Maintaining a static copy of the full tool catalog inside this skill.
- Creating parallel memory or capability inventory systems.
