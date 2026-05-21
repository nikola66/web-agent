---
name: Systematic Debugging
description: Use when the user reports a bug, error, flaky test, crash, regression, or "it doesn't work"—hypothesis-first debugging before random edits.
version: 1.0.0
category: bundled
tags: [debugging, bug, error, flaky, crash, regression, test-failure, investigation]
triggers: [bug, error, fails, flaky, crash, regression, test failure, doesn't work, debug this, broken, not working, read_file, grep, file_diff]
---

## Tool contract (read first)

| Step | Tool |
|------|------|
| Read suspect code | `read_file` |
| Find call sites / symbols | `grep`, `find_files` |
| Compare versions | `file_diff` |
| External API semantics | `web_fetch` |
| Isolated repro / verify | `run_shell` (narrow) — **`browser-runtime-map`** |
| Record hypothesis trail | `session_memory_append` |
| Hypothesis tree visual | Mermaid via **`chart`** |

**Non-negotiable:** Read before edit. One hypothesis, one falsifying experiment per cycle — no parallel mystery fixes.

## When to Use

- User says something is broken, failing, flaky, or regressed.
- Error messages, stack traces, or "it used to work" reports.
- Before stacking fixes—anchor repro and falsify one hypothesis at a time.
- Test failures, CI red, or intermittent behavior you need to isolate.

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

## Inside a multi-step run

Inside a plan being run by **`task-execution`**, this loop is invoked **per failing step**: one falsification cycle, then resume, re-plan, or abort with a partial report.

## Visualizing the hypothesis tree

When more than two hypotheses are alive at once, draw the fault tree as a Mermaid `flowchart` via **`chart`** — keeps "what is falsified vs open" legible.
