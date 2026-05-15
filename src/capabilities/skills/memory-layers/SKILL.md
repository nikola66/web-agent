---
name: Memory Layers
description: When to use durable facts, rolling session notes, and skills—without duplicating the web-agent maintainer skill.
version: 1.0.0
category: bundled
tags: [memory, session, skills, facts, context]
---

## Canonical scope

This skill is the **single guide** for choosing among durable facts, rolling session notes, and procedural skills. Maintainer-only evolution of Web Agent is covered in **`web-agent-skill`**—invoke that for self-maintenance; use this document for everyday layer choice.

## When to Use

- User asks "remember this" vs "save a reusable workflow."
- Deciding between `memory_save`, `session_memory_append`, and `skill_save`.
- Reducing duplicate or contradictory stored context.

## Layers (user-facing)

| Layer | Tools | Use for |
|-------|--------|---------|
| **Facts** | `memory_save`, `memory_recall`, `memory_search` | Stable preferences (timezone, stack choices, env constraints that stay true). |
| **Session** | `session_memory_append`, `session_memory_list`, `session_search` | Rolling investigation notes, temporary decisions, pointers to artifacts this session. |
| **Skills** | `skill_view`, `skill_list`, `skill_save`, `skill_manage`, `skill_bulk_save`, `skill_delete`, `skill_recall` | Repeatable **procedures** with a clear trigger — not one-off facts. |

## Heuristics

1. **One-off fact** ("I use pnpm") → `memory_save` (or update existing key).
2. **Debugging trail** ("tried X, failed Y") → session memory until resolved.
3. **Repeatable recipe** ("how we deploy previews") → draft a skill when the user wants it reusable; call `skill_view` before relying on skill bodies.

## Reflections / learnings

- System may surface reflections or learnings — treat as **hints**; confirm against current code/runtime before promoting into facts or skills.

## Pitfalls

- Storing secrets in memory — see **`credential-hygiene`**.
- Duplicating the same content in facts and a skill — pick one layer.

## Anti-patterns

- Huge dumps into `memory_save` — summarize; long prose belongs in skills or session.
- Maintainer-only workflows — for self-evolution of Web Agent itself, follow **`web-agent-skill`**; everyday tasks use this document only.
