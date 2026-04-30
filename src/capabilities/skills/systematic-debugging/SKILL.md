---
name: Systematic Debugging
description: Lightweight hypothesis–experiment loop for bugs and flakey behavior using existing read/grep/web tools (no language-specific harness assumed).
version: 1.0.0
category: bundled
tags: [debugging, reliability, investigation, science]
---

## Loop

1. **Reproduce** — smallest steps or command that shows the failure every time (or document intermittency rate).
2. **Hypothesis** — one concrete mechanistic guess (e.g. “path resolves wrong under sandbox”, “async race before write completes”).
3. **Smallest experiment** — one change or one observation that can **falsify** the hypothesis (`read_file` around suspect lines, `grep` for call sites, `web_fetch` for API error semantics, tiny isolated repro file).
4. **Evidence** — record exact output, file:line, or HTTP status; never “probably fixed” without a check.
5. **Iterate** — if falsified, discard that mental model and form a new hypothesis (do not stack fixes blindly).

## Heuristics

- Prefer **read before edit**; avoid editing until the failure location is anchored.
- When logs are missing, add **one** targeted log or return value in the narrowest function — not broad refactors.
- Separate **symptom** (what user sees) from **cause** (what code/data does wrong).

## Stop Conditions

- Repro disappears with a falsifiable explanation and verification.
- Hypothesis survives two independent checks (observation + small experiment).

## Anti-patterns

- Random refactor without a falsified hypothesis.
- Parallel changes that hide which one fixed the issue.
