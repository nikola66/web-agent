---
name: Find Skills
description: Use when the user wants to discover, search, or install agent skills from online registries—top results by installs, stars, or votes. Or user sends /find_skills.
version: 1.0.0
category: bundled
primary-tools: [web_search, web_fetch, skill]
tags: [skills, discovery, registry, marketplace, install, search, skills.sh, skillsmp, cursor]
triggers: [find skill, find skills, search skills, skill marketplace, skill registry, install skill, discover skill, skills.sh, skillsmp, cursor marketplace, /find_skills, skill library, agent skill pack]
---

## Tool contract (read first)

| Step | Tool |
|------|------|
| Ambiguous query | Follow **`clarify`** — one `<<<CLARIFY>>>` block (no search yet) |
| Registry discovery | `web_search` — **3** site-scoped queries (one per registry below) |
| Verify rankings | `web_fetch` — **2** registry result or skill detail pages before answering |
| Install chosen skill | `skill` (action=manage/bulk) / `/skills install` — defer to **`web-agent-skill`** |
| Present ranked table | plain assistant markdown (pipe table) |

**Non-negotiable:** Search **only** the three registries below (no GitHub trawling, no cursor.directory), rank by **install count, stars, or votes**, return **exactly 5** deduped skills. Never answer from memory alone — fetch live registry pages first.

## When to Use

- User asks to **find**, **search**, **discover**, or **recommend** agent skills for a topic.
- User sends **`/find_skills [query]`** or names a registry (`skills.sh`, SkillsMP, Cursor Marketplace).
- User wants the **most popular** skill for PDF, React, debugging, etc. — not installed workspace skills (use `/skills` for those).

**Not for:** listing installed workspace skills (`/skills`), editing bundled skills (**`web-agent-skill`**), or open-web entity discovery (**`open-web-research`**).

## Relation to other skills

- Ambiguous intent: **`clarify`**. Remote install rules: **`web-agent-skill`**. Open-web lists (creators, companies): **`open-web-research`**.

## Registries (exactly these three — no others)

| Registry | `web_search` query | Popularity metric | Notes |
|----------|-------------------|-------------------|-------|
| [skills.sh](https://skills.sh/) | `site:skills.sh {query}` | **Installs** | Primary source; install via HTTPS `SKILL.md` URL + `skill` (action=bulk) |
| [SkillsMP](https://skillsmp.com/) | `site:skillsmp.com {query}` | **Stars** | Prefer pages showing star counts |
| [Cursor Marketplace](https://cursor.com/marketplace) | `site:cursor.com/marketplace {query}` | Featured / plugin listing | Plugins bundling skills; link plugin page |

Do **not** search cursor.directory, GitHub, or the open web — they are slow and noisy. If a registry returns no hits, note it and continue with the other two.

## Minimum effort (before any final answer)

1. **3** `web_search` calls — one `site:` query per registry (same `{query}`; add `agent skill` only if results are thin).
2. **2** `web_fetch` calls — the two best registry pages (search results or skill detail) with clear popularity numbers.
3. Extract for each candidate: **name**, **registry**, **popularity number** (installs / stars / votes), **one-line description**, **install command or HTTPS URL**.
4. **Dedupe** by name or repo; when duplicates appear, keep the higher popularity score.
5. Sort descending by popularity; take **top 5**.

## Output template

```markdown
## Top 5 skills for "{query}"

| # | Skill | Registry | Popularity | Summary | Install / link |
|---|-------|----------|------------|---------|----------------|
| 1 | … | skills.sh | 12.4k installs | … | `https://…/SKILL.md` or `/skills install <url>` |
| … | … | … | … | … | … |

**Sources checked:** skills.sh, SkillsMP, Cursor Marketplace
```

Rules:

- Popularity column must show the **numeric metric** used for ranking (e.g. `4.3M installs`, `892 stars`).
- Install column: prefer direct HTTPS link to `SKILL.md` or documented install command.
- After the table, one short paragraph: offer to install a row via `/skills install <url>` or `skill` (action=manage) — do not install without user confirmation.

## Install handoff

When the user picks a skill:

1. `skill` (action=view) **`web-agent-skill`** — remote install rules (HTTPS + `skill` action=manage/bulk, never shell `git clone`).
2. Install with `/skills install <https-url-to-SKILL.md>` or `skill` (action=manage, manage_action=import_url). If the skill ships **Python/shell scripts** under `scripts/` or package dirs, prefer `skill` (action=manage, manage_action=import_dir) on a cloned folder so support files are saved.
3. `skill` (action=view) **`imported-skill-compat`**, then `skill` (action=view) the installed slug — follow the Web Agent execution section, `compatibility_notes`, and `script_warnings`.
4. Confirm with `skill` (action=list).

## Pitfalls

- Ranking from training memory instead of live registry pages.
- Returning fewer than 5 without exhausting registries.

## Anti-patterns

- Do **not** return fewer than 5 without stating you exhausted registries.
- Do **not** rank from training memory — live search + fetch required.
- Do **not** conflate workspace `/skills` (installed) with online discovery.
- Do **not** install silently — present choices first unless the user already named one row to install.
