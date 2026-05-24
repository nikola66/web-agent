---
name: Task Execution
description: Use when a multi-step goal needs decomposition and end-to-end delivery—todo_write plan, one-at-a-time execution, failure recovery, and a final report.
version: 1.1.0
category: bundled
primary-tools: [todo_write, artifact_present]
tags: [planning, execution, multi-step, todo, report, agentic, delivery]
triggers: [plan this, multi-step, break down, decompose, ordered steps, several things, do all of, then do, execute the plan, run the plan, go ahead, proceed with execution, start executing, kick off, run all steps, do it now, ship it, work the list]
---

## Tool contract (read first)

| Phase | Tool |
|-------|------|
| Decompose goal | `todo_write` — ordered, verifiable todos |
| Visualize plan | Mermaid via **`chart`** when ≥4 steps or branching |
| Gate / advance plan | `todo_write` — one `in_progress` at a time |
| Session audit trail | `session_memory_append` |
| Per-step work | canonical tools from **`browser-runtime-map`** |
| Final report file | `write_file` at `work/task-execution/<slug>/report.md` |
| Present report | `artifact_present` — **`artifact-delivery`** |
| Failure recovery | **`systematic-debugging`** one cycle, then resume or abort |
| Irreversible steps | checkpoint via **`workspace-safety`** as step 0 |

**Non-negotiable:** No tool fan-out before `todo_write`. Every multi-step run gets a report via `artifact_present` — never inline the full body. `/stop` → partial report immediately.

## When to Use

- Goal has **≥3 sub-goals**, branching outcomes, step dependencies, or stacked deliverables.
- User asks "do A, then B, then C" or says go ahead / execute / ship it.
- Not for one-shot fetches, single edits, or pure Q&A — direct action is cheaper.
- Not for diagnosis-only loops — use **`systematic-debugging`** instead.
- Not for **spec-first** planning — use **`/plan [goal]`** (read-only research, markdown under `plans/`, stop before execution).

## Relation to other skills

- When intent is unclear, **`clarify`** comes first.
- Companion to **`systematic-debugging`**: this skill plans and delivers multi-step work; that skill falsifies one hypothesis at a time.
- Defers **final delivery** to **`artifact-delivery`**; **destructive safety** to **`workspace-safety`**; **durable storage** to **`memory-layers`**.

## Procedure

### Phase A — Plan

1. **State goal** in one sentence — what "done" looks like and for whom.
2. **`todo_write`** an ordered list. Each todo names a verifiable exit (file written, test green, URL fetched, message sent). Avoid "look into X".
3. **Visualize** — Mermaid flowchart via **`chart`** when the plan has branching, dependencies, or ≥4 todos.

### Phase B — Execute

4. **Pre-flight** — If todos already exist and the user said go ahead, skip re-planning. Echo: `Executing N steps. Stop anytime with /stop.` Prepend a checkpoint todo via **`workspace-safety`** when any step is irreversible. `session_memory_append` with `ref: "task-execution:start"`.
5. **Per todo** — mark exactly one `in_progress`; execute with tools from **`browser-runtime-map`**; verify exit; append session note; mark completed before the next. **Do not batch completions.**
6. **On failure** — one **`systematic-debugging`** cycle, then resume, re-plan todos, or abort with partial report.
7. **Final report** — write `work/task-execution/<run-slug>/report.md` and present via **`artifact-delivery`**. Open with Mermaid status diagram via **`chart`**.

```markdown
# Task Execution Report — <goal in one sentence>

**Status:** ✅ Completed · ⚠️ Partial · ❌ Aborted
**Duration:** <hh:mm:ss>  ·  **Steps:** <done>/<total>  ·  **Tools used:** <count>  ·  **Artifacts:** <count>

## Step breakdown

| # | Step | Tool(s) | Status | Duration | Artifact / Output | Notes |
|---|------|---------|--------|----------|-------------------|-------|

## Artifacts produced

## Failures & recovery

## Memory promotion

## Next steps
```

## Pitfalls

- Fan-out before `todo_write` — many tool calls with no anchor.
- Multiple todos `in_progress` at once — defeats the audit trail.
- Skipping the report on short runs — every multi-step run gets one.
- Re-planning every turn without telling the user.
- Promoting every step into `memory_save` — see **`memory-layers`**.

## Anti-patterns

- One giant todo covering the whole goal.
- Storing the plan only in chat or `session_memory_append` instead of `todo_write`.
- Inlining the report body in chat instead of `artifact_present`.
- Embedding raw tool-output blobs in the report — link to artifacts instead.
