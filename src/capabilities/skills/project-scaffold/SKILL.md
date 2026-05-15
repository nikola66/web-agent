---
name: Project Scaffold
description: Scaffold a new isolated workspace folder before any files—multi-file app, demo, spike, sandbox, test harness, or exploratory codegen; use projects/ for durable mini-projects and work/ for scratch; minimal entrypoint plus verification.
version: 1.0.0
category: bundled
tags: [project, scaffold, verification]
---

## When to Use

- User asks for a **new** app, package, script bundle, starter, or demo.
- Work will create **multiple new files** or a tree that should live together.
- **Scratch or disposable** experiment: try an API, spike a parser, sandbox a pattern.
- User wants something **runnable or verifiable** in isolation (smoke test, start command).
- **Risky or high-value** new trees (could destroy data or hard to redo): pair with **`workspace-safety`**—checkpoint or export before big writes, alongside picking `projects/` vs `work/`.

## Procedure

**Gate — before** the first `write_file`, `apply_patch` (**Add File**), or equivalent for this effort:

1. **`projects/<kebab-purpose>/`** — durable mini-project / deliverable the user may keep.
2. **`work/<kebab-purpose>/`** — exploratory or throwaway work.

If unsure or the user did not name a folder, call `skill_view` with name **`project-scaffold`** (this document), then proceed.

Then:

3. **`make_dir`** that full path first.
4. Add the smallest complete entrypoint and supporting files needed to run or test it.
5. Run one project-specific verification (smoke command, tests, or start) before claiming success.

## Pitfalls

- Do **not** put new project files at the workspace root. The runtime rejects most root filenames (`assertAllowedWorkspaceWritePath`; allowlist exceptions are for workspace config only).
- Do **not** report the project works until at least one verification command has succeeded.
- Do **not** force this workflow for **targeted edits** to an existing tree (e.g. `src/…`): edit in place unless the user asked for a **separate isolated** project beside the repo.

## Examples

- Durable demo: `projects/invoice-demo/`
- Scratch spike: `work/gpt-parse-spike/`
