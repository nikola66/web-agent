---
name: Project Scaffold
description: Use when starting a new app, demo, spike, starter, or multi-file project—make_dir under projects/ or work/ before any writes.
version: 1.0.0
category: bundled
tags: [project, scaffold, verification, demo, starter, spike, greenfield]
triggers: [new app, create project, demo, starter, spike, sandbox, test harness, greenfield, bootstrap project, mini-project]
---

## When to Use

- User asks for a **new** app, package, script bundle, starter, or demo.
- Work will create **multiple new files** or a tree that should live together.
- **Scratch or disposable** experiment: try an API, spike a parser, sandbox a pattern.
- User wants something **runnable or verifiable** in isolation (smoke test, start command).
- **Risky or high-value** new trees: pair with **`workspace-safety`**—checkpoint or export before big writes.

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

## Show the structure

When the new tree has ≥3 files or non-trivial layering, embed a Mermaid `flowchart` of the folder shape via **`chart`** in the project README — new readers grasp the layout instantly.
