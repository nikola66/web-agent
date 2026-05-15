---
name: Workspace Safety
description: Export, checkpoints, and isolation before risky edits—pair with project-scaffold for new scratch trees.
version: 1.0.0
category: bundled
tags: [backup, export, checkpoint, safety, destructive]
---

## Canonical scope

This skill owns **backup, checkpoint, export, and risk isolation** before destructive or high-value work. For **where** to put new isolated trees (`projects/` vs `work/`), see **`project-scaffold`**—use **both** when starting a new subtree that could still go wrong (scaffold the path, then checkpoint/export if it matters).

## When to Use

- Before bulk deletes, wide `run_shell` refactors, or experiments that could break the tree.
- User wants portability across machines or browser profiles.
- Recovering from a bad turn without losing everything.

## Checklist

1. **Named history checkpoint** — If the UI exposes slash commands (`/checkpoint [name]` per README), save conversation state before big moves; `/rollback` lists or restores.
2. **Profile / workspace export** — Workspaces tab: **Export** profile snapshot to JSON; **Import** later. Do this before risky migration or "let's wipe and retry."
3. **Isolate experiments** — New disposable trees under **`work/<purpose-slug>/`**; durable demos under **`projects/<slug>/`**. Call `skill_view` **`project-scaffold`** when layout is unclear.
4. **Secrets** — Never checkpoint or export and share without redacting; see **`credential-hygiene`**.
5. **Destructive tools** — Confirm scope before `delete_file`, wide patches, or shell that removes files.

## Pitfalls

- Assuming browser storage is backed up — it is local; export if the work matters.
- Running irreversible shell on the main repo root when a `work/` subtree would suffice.

## Anti-patterns

- "Let's delete half the workspace" without checkpoint or export.
- Putting irreplaceable state only in session memory — export facts/skills separately if needed for portability.
