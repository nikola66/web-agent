---
name: Task Planning
description: Use when the user gives a multi-step goal—decompose into ordered todos with todo_write before tool fan-out.
version: 1.0.0
category: bundled
tags: [planning, todo, decomposition, agentic, hermes]
triggers: [plan this, multi-step, break down, todo, todo_write, ordered steps, decompose, several things, do all of, then do, skill_view]
---

## Tool contract (read first)

| Step | Tool |
|------|------|
| Decompose goal | `todo_write` — ordered, verifiable todos |
| Read procedure skills | `skill_view` (`task-execution`, `chart`, `artifact-delivery`) |
| Visualize plan | Mermaid via **`chart`** when ≥4 steps or branching |
| Execute after approval | hand off to **`task-execution`** |

**Non-negotiable:** No tool fan-out before `todo_write`. Do not store the plan only in `session_memory_append` — use `todo_write`.

## When to Use

- Goal has **≥3 sub-goals**, branching outcomes, or step dependencies.
- User asks "do A, then B, then C" or stacks deliverables in one message.
- Before fan-out: when you would otherwise call many tools without a written plan.
- Not for one-shot fetches, single edits, or pure Q&A — direct action is cheaper.
- Not for **spec-first** planning — use **`/plan [goal]`** (read-only research, markdown under `plans/`, stop before execution).

## Relation to other skills

Companion to **`systematic-debugging`** (which falsifies one hypothesis at a time): use **this** to plan multi-step *delivery* work; use that for multi-step *diagnosis*. When intent itself is unclear, **`clarify`** comes first. For file-based specs before implementation, **`/plan`** owns the workflow; this skill owns in-session `todo_write` decomposition.

## Procedure

1. **State goal** in one sentence — what "done" looks like and for whom.
2. **`todo_write`** an ordered list. Each todo names a verifiable exit (file written, test green, URL fetched, message sent). Avoid "look into X".
3. **Execute sequentially.** Mark a todo done before starting the next; do not batch completions.
4. **Re-plan only on falsification** — evidence shows a step is wrong or blocked. Otherwise, follow the plan.
5. **Cross-link delivery**: if the final todo produces a file or message, route through **`artifact-delivery`**.
6. **Hand off to execution**: once the user approves scope, switch to **`task-execution`** — it owns gating, status transitions, failure recovery, and the final report.
7. **Visualize the plan**: include a Mermaid flowchart of the ordered steps via **`chart`** when the plan has branching, dependencies, or ≥4 todos — humans grasp the shape faster from a diagram.

## Pitfalls

- Fan-out before plan — many tool calls with no anchor; results pile up unreviewed.
- Vague todos ("investigate", "improve") with no exit criterion.
- Replanning every turn — destroys the audit trail and signals drift.
- Putting ordered work in `session_memory_append` instead of `todo_write` (see **`memory-layers`**).

## Anti-patterns

- One giant todo covering the whole goal — defeats the decomposition.
- Padding the list with already-completed work to look busy.
- Hiding the plan from the user — the todo list is visible scaffolding, not internal state.
