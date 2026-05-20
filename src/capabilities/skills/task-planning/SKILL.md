---
name: Task Planning
description: Use when the user gives a multi-step goal—decompose into ordered todos with todo_write before tool fan-out.
version: 1.0.0
category: bundled
tags: [planning, todo, decomposition, agentic, hermes]
triggers: [plan this, multi-step, break down, todo, todo_write, ordered steps, decompose, several things, do all of, then do]
---

## When to Use

- Goal has **≥3 sub-goals**, branching outcomes, or step dependencies.
- User asks "do A, then B, then C" or stacks deliverables in one message.
- Before fan-out: when you would otherwise call many tools without a written plan.
- Not for one-shot fetches, single edits, or pure Q&A — direct action is cheaper.

## Relation to other skills

Companion to **`systematic-debugging`** (which falsifies one hypothesis at a time): use **this** to plan multi-step *delivery* work; use that for multi-step *diagnosis*. When intent itself is unclear, **`clarify`** comes first.

## Procedure

1. **State goal** in one sentence — what "done" looks like and for whom.
2. **`todo_write`** an ordered list. Each todo names a verifiable exit (file written, test green, URL fetched, message sent). Avoid "look into X".
3. **Execute sequentially.** Mark a todo done before starting the next; do not batch completions.
4. **Re-plan only on falsification** — evidence shows a step is wrong or blocked. Otherwise, follow the plan.
5. **Cross-link delivery**: if the final todo produces a file or message, route through **`artifact-delivery`**.

## Pitfalls

- Fan-out before plan — many tool calls with no anchor; results pile up unreviewed.
- Vague todos ("investigate", "improve") with no exit criterion.
- Replanning every turn — destroys the audit trail and signals drift.
- Putting ordered work in `session_memory_append` instead of `todo_write` (see **`memory-layers`**).

## Anti-patterns

- One giant todo covering the whole goal — defeats the decomposition.
- Padding the list with already-completed work to look busy.
- Hiding the plan from the user — the todo list is visible scaffolding, not internal state.
