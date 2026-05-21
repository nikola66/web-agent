---
name: Workspace Safety
description: Use when the user wants backup, export, checkpoint, or before bulk deletes, rm -rf, or wide refactors.
version: 1.0.0
category: bundled
tags: [backup, export, checkpoint, safety, destructive, rollback, isolate]
triggers: [backup, export profile, checkpoint, rollback, before delete, rm -rf, wipe workspace, risky refactor, save state, delete_file, move_file]
---

## Tool contract (read first)

| Need | Action |
|------|--------|
| Conversation checkpoint | UI slash `/checkpoint [name]` — not a built-in tool |
| Restore checkpoint | `/rollback` — UI |
| Profile portability | Workspaces tab Export/Import JSON — UI |
| Isolate experiment | `make_dir` under `work/<slug>/` — **`project-scaffold`** |
| Inventory before delete | `list_dir`, `tree` |
| Destructive file ops | `delete_file`, `move_file` — confirm scope first |
| Risky shell | `run_shell` — prefer `work/` subtree — **`browser-runtime-map`** |
| Multi-step irreversible plan | **`task-execution`** inserts checkpoint todo as step 0 |

**Non-negotiable:** No wide delete/refactor without checkpoint or export. Redact secrets before export — **`credential-hygiene`**.

## Canonical scope

This skill owns **backup, checkpoint, export, and risk isolation** before destructive or high-value work. For **where** to put new isolated trees (`projects/` vs `work/`), see **`project-scaffold`**—use **both** when starting a new subtree that could still go wrong (scaffold the path, then checkpoint/export if it matters).

## When to Use

- Before bulk deletes, wide `run_shell` refactors, or experiments that could break the tree.
- User wants portability across machines or browser profiles (export/import).
- Recovering from a bad turn without losing everything (`/checkpoint`, `/rollback`).
- "Delete everything", mass file removal, or irreversible migration.

## Checklist

1. **Named history checkpoint** — If the UI exposes slash commands (`/checkpoint [name]` per README), save conversation state before big moves; `/rollback` lists or restores.
2. **Profile / workspace export** — Workspaces tab: **Export** profile snapshot to JSON; **Import** later. Do this before risky migration or "let's wipe and retry."
3. **Isolate experiments** — New disposable trees under **`work/<purpose-slug>/`**; durable demos under **`projects/<slug>/`**. Call `skill_view` **`project-scaffold`** when layout is unclear.
4. **Secrets** — Never checkpoint or export and share without redacting; see **`credential-hygiene`**.
5. **Destructive tools** — Confirm scope before `delete_file`, wide patches, or shell that removes files.
6. **Inside multi-step runs** — **`task-execution`** inserts a checkpoint todo as step 0 when the approved plan contains an irreversible step; do not skip it.

## Pitfalls

- Assuming browser storage is backed up — it is local; export if the work matters.
- Running irreversible shell on the main repo root when a `work/` subtree would suffice.

## Anti-patterns

- "Let's delete half the workspace" without checkpoint or export.
- Putting irreplaceable state only in session memory — export facts/skills separately if needed for portability.
