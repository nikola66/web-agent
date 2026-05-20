---
name: Task Execution
description: Use when an approved multi-step plan must be executed end to end—gate, advance todos one-at-a-time, recover from failures, and deliver a high-quality final report.
version: 1.0.0
category: bundled
tags: [execution, multi-step, todo, report, agentic, delivery]
triggers: [execute the plan, run the plan, go ahead, proceed with execution, start executing, kick off, run all steps, do it now, ship it, work the list]
---

## When to Use

- A plan already exists in `todo_write` (built via **`task-planning`**) and the user has approved scope.
- Goal has **≥3 ordered steps**, multiple tools, or any irreversible action.
- Not for one-shot fetches or single edits — direct action is cheaper.
- Not for diagnosis loops — use **`systematic-debugging`** instead.

## Relation to other skills (canonical handoffs)

- Comes **after** **`task-planning`** (decomposition) and **`clarify`** (intent).
- Defers **final delivery** of the report to **`artifact-delivery`**.
- Defers **destructive-step safety** to **`workspace-safety`** (checkpoint before irreversible work).
- Defers **per-step recovery** to **`systematic-debugging`**.
- Defers **secret handling** in the report to **`credential-hygiene`**.
- Defers **durable lesson storage** to **`memory-layers`** (facts vs session vs skills).

## Pre-flight gate (run once at start)

1. **Plan present?** If not, call `skill_view` **`task-planning`**, build the list, then stop and re-enter this skill.
2. **Echo the plan.** One line back to the user: `Executing N steps. Stop anytime with /stop.`
3. **Insert safety step.** If any todo is irreversible (delete, mass overwrite, external send), prepend a checkpoint todo via **`workspace-safety`** as step 0.
4. **Snapshot start.** `session_memory_append` with `kind: "decision"`, `ref: "task-execution:start"`, and the goal in `text`. The timestamp anchors the duration column in the final report.

## Execution loop (per todo)

1. **Lock** — mark exactly **one** todo `in_progress` via `todo_write`. Never run with zero or two in-flight.
2. **Execute** — call the tool(s) the todo requires. Prefer the canonical tool from **`browser-runtime-map`** (e.g. `web_fetch` over `run_shell curl`).
3. **Verify** — confirm the verifiable exit named in the todo (file present, test green, HTTP 200, expected JSON shape).
4. **Record** — append a one-line session-memory entry: `{ kind: "note", text: "<step n> <tool> -> <outcome>", ref: "task-execution:step-<n>", artifact_path?: "<path>" }`.
5. **Advance** — mark completed and unlock the next todo. **Do not batch completions.**
6. **On failure** — call `skill_view` **`systematic-debugging`**, run one falsification cycle, then either resume the same todo, re-plan via **`task-planning`**, or abort cleanly with a partial-run report.

## Final report (mandatory deliverable)

Write `work/task-execution/<run-slug>/report.md` (see **`project-scaffold`** for path discipline) and present it through **`artifact-delivery`** (`artifact_present`). Open the report with a **Mermaid status flowchart** via **`chart`** (step nodes with status icons) — readers see shape before scanning the table.

```markdown
# Task Execution Report — <goal in one sentence>

**Status:** ✅ Completed · ⚠️ Partial · ❌ Aborted
**Duration:** <hh:mm:ss>  ·  **Steps:** <done>/<total>  ·  **Tools used:** <count>  ·  **Artifacts:** <count>

## Step breakdown

| # | Step                | Tool(s)                  | Status | Duration | Artifact / Output                 | Notes               |
|---|---------------------|--------------------------|--------|----------|-----------------------------------|---------------------|
| 1 | <todo content>      | `web_fetch`              | ✅     | 0:04     | `work/.../page.html`              | 200 OK              |
| 2 | <todo content>      | `apply_patch`            | ✅     | 0:11     | `src/foo.ts`                      | 3 lines added       |
| 3 | <todo content>      | `run_shell` (`npx tsc`)  | ❌     | 0:32     | —                                 | TS2304 — see below  |
| 4 | <todo content>      | —                        | ⏭️     | —        | —                                 | skipped (blocked)   |

## Artifacts produced

- `work/<slug>/report.md` — this report (presented via `artifact_present`)
- `<other paths>` — one bullet per file / email / message

## Failures & recovery

- **Step 3** — `TS2304: Cannot find name 'Foo'`. Hypothesis cycle via **`systematic-debugging`** pointed to a missing import; fix landed in step 5.

## Memory promotion

- **Fact** (`memory_save`): `<key>` → `<value>` — only if durable.
- **Learning candidate**: `<one-liner>` — only if procedural and reusable.

## Next steps

- <user-facing follow-up the agent did not run>
```

### Report rules

- **Status icons:** ✅ done · ❌ failed · ⚠️ partial · ⏭️ skipped · ⏳ in_progress (only when aborted).
- **Durations** come from the per-step session-memory timestamps; total from the `task-execution:start` snapshot.
- **Artifact column** uses workspace-relative paths so the user can `read_file` them directly.
- **Tool column** shows the **actual** tool name(s) used, not the originally planned tool.
- **Redact secrets** via **`credential-hygiene`** before writing the report file.

## Stop rules

- User issues `/stop` → produce a **partial** report immediately; do not silently halt.
- Two consecutive failed retries on the same todo → abort with partial report.
- Tool budget exceeded (>50 tool calls or >30 min wall-time) → checkpoint and ask the user before continuing.

## Pitfalls

- Marking multiple todos `in_progress` at once — defeats the audit trail.
- Skipping the report on short runs ("only 3 steps, no need") — every multi-step run gets one.
- Inlining the report body in chat instead of `artifact_present` — duplicates content; route through **`artifact-delivery`**.
- Dropping a failed step from the table to "look clean" — failures stay; that is the value of the report.
- Re-planning silently mid-run without telling the user.

## Anti-patterns

- Storing the running plan only in chat — `todo_write` is the source of truth.
- Embedding raw tool-output blobs in the report — link to the artifact instead.
- Promoting every step into `memory_save` — only durable, reusable lessons; see **`memory-layers`**.
