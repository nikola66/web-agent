---
name: Memory Layers
description: Use when the user says remember this, save a preference, or you must pick memory_save vs session notes vs skill_save vs wiki_* tools.
version: 1.0.0
category: bundled
tags: [memory, session, skills, facts, context, remember, preference]
triggers: [remember this, save preference, memory_save, session note, store fact, recall later, what do we remember, persistent note, knowledge vault, wiki sync, sync facts to wiki, wiki search, skill_save, wiki_setup]
---

## Tool contract (read first)

Canonical picker for **what to persist** and **which memory tool**. Maintainer evolution: **`web-agent-skill`**.

| Layer | Tools | Use for |
|-------|--------|---------|
| **Facts** | `memory_save`, `memory_recall`, `memory_search` | Stable preferences (timezone, stack, env constraints). |
| **Session** | `session_memory_append`, `session_memory_list`, `session_search` | Rolling notes, temporary decisions, artifact pointers this session. |
| **Skills** | `skill_view`, `skill_list`, `skill_save`, `skill_manage`, `skill_bulk_save`, `skill_delete`, `skill_recall` | Repeatable procedures with a clear trigger. |
| **Wiki vault** | `wiki_setup`, `wiki_sync`, `wiki_search` | PARA markdown mirror (default `.webagent/knowledge-vault/`). Also `/wiki_setup`, `/wiki_sync`, `/wiki_search`. |

**Non-negotiable:** One-off facts → `memory_save`. Debugging trail → `session_memory_append`. Repeatable recipe → `skill_save` after `skill_view`. No secrets in memory — **`credential-hygiene`**.

## Canonical scope

This skill is the **single guide** for choosing among durable facts, rolling session notes, and procedural skills. Maintainer-only evolution of Web Agent is covered in **`web-agent-skill`**—invoke that for self-maintenance; use this document for everyday layer choice.

## When to Use

- User asks "remember this" vs "save a reusable workflow" or "for next session."
- Deciding between `memory_save`, `session_memory_append`, and `skill_save`.
- Reducing duplicate or contradictory stored context; wiki_sync vs facts.

## Layers (user-facing)

| Layer | Tools | Use for |
|-------|--------|---------|
| **Facts** | `memory_save`, `memory_recall`, `memory_search` | Stable preferences (timezone, stack choices, env constraints that stay true). |
| **Session** | `session_memory_append`, `session_memory_list`, `session_search` | Rolling investigation notes, temporary decisions, pointers to artifacts this session. |
| **Skills** | `skill_view`, `skill_list`, `skill_save`, `skill_manage`, `skill_bulk_save`, `skill_delete`, `skill_recall` | Repeatable **procedures** with a clear trigger — not one-off facts. |
| **Wiki vault** | `wiki_setup`, `wiki_sync`, `wiki_search` | PARA markdown mirror (Obsidian-friendly; default `.webagent/knowledge-vault/`). Use **`/wiki_setup`**, **`/wiki_sync`**, **`/wiki_search`** or the matching tools. `wiki_sync` **projects** facts/session/learnings — canonical structured facts stay in memory tools unless you intentionally archive prose there. |

## Wiki vault

1. **Scaffold once** — `wiki_setup` or `/wiki_setup` (legacy `knowledge-vault/` migrates when `root_path` is omitted).
2. **Project runtime** — `wiki_sync` or `/wiki_sync [facts|session|all]` after facts/session exist.
3. **Browse/search** — `wiki_search` or `/wiki_search <query>` when memory tools are not enough.

Optional PARA or topic-map diagrams: pair with **`chart`** when vault pages benefit from structure visuals.

## Heuristics

1. **One-off fact** ("I use pnpm") → `memory_save` (or update existing key).
2. **Debugging trail** ("tried X, failed Y") → session memory until resolved.
3. **Repeatable recipe** ("how we deploy previews") → draft a skill when the user wants it reusable; call `skill_view` before relying on skill bodies.

## Reflections / learnings

- System may surface reflections or learnings — treat as **hints**; confirm against current code/runtime before promoting into facts or skills.

## Pitfalls

- Storing secrets in memory — see **`credential-hygiene`**.
- Duplicating the same content in facts and a skill — pick one layer.
- Mirroring the same long content in both `memory_save` and synced wiki pages — prefer facts/skills as source of truth and keep vault entries as summaries or links unless you need an archival copy.

## Anti-patterns

- Huge dumps into `memory_save` — summarize; long prose belongs in skills or session.
- Maintainer-only workflows — for self-evolution of Web Agent itself, follow **`web-agent-skill`**; everyday tasks use this document only.
