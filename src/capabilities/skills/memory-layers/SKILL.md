---
name: Memory Layers
description: Use when the user says remember this, save a preference or API key, or you must pick memory_save vs session notes vs skill (action=manage) vs wiki_* tools.
version: 1.2.0
category: bundled
primary-tools: [memory_save, session_search, skill, wiki_search]
tags: [memory, session, skills, facts, context, remember, preference]
triggers: [remember this, save preference, session note, store fact, recall later, what do we remember, persistent note, knowledge vault, wiki sync, sync facts to wiki, wiki search, api key, token, password in chat]
---

## Tool contract (read first)

Canonical picker for **what to persist** and **which memory tool**. Maintainer evolution: **`web-agent-skill`**.

| Layer | Tools | Use for |
|-------|--------|---------|
| **Facts** | `memory_save`, `memory_forget`, `memory_recall`, `memory_search` | Stable key=value facts: preferences, URLs, API tokens, env details. Stored only in this browser (IndexedDB); nothing is sent to a server. |
| **Session** | `session_memory_append`, `session_memory_list`, `session_search` | Rolling notes, temporary decisions, artifact pointers this session. |
| **Skills** | `skill` (action=list / view / manage / bulk) | Repeatable procedures with a clear trigger. |
| **Wiki vault** | `wiki_setup`, `wiki_sync`, `wiki_search` | PARA markdown mirror (default `.webagent/knowledge-vault/`). Also `/wiki_setup`, `/wiki_sync`, `/wiki_search`. |
| **OAuth SaaS** | `composio_connect`, `composio_status`, `composio_action` | Connected apps (Gmail, Sheets, HubSpot, …) — not raw `web_post` without OAuth setup. |
| **MCP extensions** | Dynamic MCP tools (from `.webagent/mcp-servers.json`) | User-configured servers — see **`imported-skill-compat`**. |

**Non-negotiable:** One-off facts → `memory_save`. Debugging trail → `session_memory_append`. Repeatable recipe → `skill` (action=manage, manage_action=create) after `skill` (action=view).

## When to Use

- User asks "remember this" vs "save a reusable workflow" or "for next session".
- User gives credentials, URLs, or tokens to store — use `memory_save` with clear snake_case keys.
- Deciding between `memory_save`, `session_memory_append`, and `skill` (action=manage).
- Reducing duplicate or contradictory stored context; wiki_sync vs facts.

## Relation to other skills

- Redact secrets in delivered artifacts/email: **`artifact-delivery`**.
- Maintainer evolution: **`web-agent-skill`**.

## Procedure

### Layer choice

1. **One-off fact** ("I use pnpm", API URL, token) → `memory_save` (or update existing key; add `scope` when obvious).
2. **Debugging trail** ("tried X, failed Y") → session memory until resolved.
3. **Wrong/stale durable fact** → `memory_forget` by exact key; use `memory_search` first if unsure.
4. **Repeatable recipe** ("how we deploy previews") → `skill` (action=manage, manage_action=create) when the user wants it reusable; call `skill` (action=view) first.

### Wiki vault

1. **Scaffold once** — `wiki_setup` or `/wiki_setup`.
2. **Project runtime** — `wiki_sync` or `/wiki_sync [facts|session|all]`.
3. **Browse/search** — `wiki_search` or `/wiki_search <query>`.

## Pitfalls

- Duplicating the same content in facts and a skill — pick one layer.
- Mirroring long content in both `memory_save` and synced wiki pages — prefer facts/skills as source of truth.
- Huge dumps into `memory_save` — summarize; long prose belongs in skills or session.

## Anti-patterns

- Maintainer-only workflows here — use **`web-agent-skill`** for self-evolution of Web Agent itself.
