---
name: Clarify
description: Use when the user’s request is ambiguous, conflicting, or has multiple valid paths—emit one structured choice block instead of guessing.
version: 1.0.0
category: bundled
tags: [ux, ambiguity, clarification, dialog, choices, requirements]
triggers: [which should I, pick one, either/or, not sure, ambiguous, conflicting requirements, what do you mean, unclear scope]
---

## When to Use

- Requirements conflict, scope is fuzzy, or multiple valid interpretations exist.
- User asks "which should I…", "pick one", or gives either/or options without choosing.
- One sharp question resolves the fork faster than parallel tool guesses.
- UI can render options (browser host parses `<<<CLARIFY>>>` markers).

## Relation to other skills

Use **clarify first** when the user’s intent is **still unresolved** (conflicting requirements, unclear fork, unknown deliverable). Once the question is scoped, follow the chosen workflow—e.g. **`open-web-research`** requires minimum search/fetch before pivots; do **not** use clarify to postpone evidence after intent is clear.

## Output Contract

Emit exactly this block **as plain assistant text** (no tool call):

```
<<<CLARIFY>>>
{"question":"Which stack should we use?","options":["React + Vite","Plain HTML/CSS","Other"],"open_ended":false}
<<<END>>>
```

Rules:

- `question`: one concise sentence ending with `?` when offering choices.
- `options`: 2–6 short strings when `open_ended` is false. Include **`Other`** only when genuinely needed.
- `open_ended`: true when typed prose is clearer than buttons — then **`options`** may be `[]`.
- JSON must parse; use double quotes. Do not wrap in markdown fences inside the markers.

Then stop and wait — the host sends the user's choice as the next user message.

## Anti-patterns

- Do **not** ask three overlapping questions — one block only.
- Do **not** use this when you can reasonably default (note the assumption briefly instead).
