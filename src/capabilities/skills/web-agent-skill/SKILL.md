---
name: Web Agent Skill
description: Evolve Web Agent safely using its live runtime, memory layers, cron, bundled skills, and current repository truth.
version: 1.1.0
category: bundled
tags: [web-agent, self-evolution, maintenance, skills, memory, cron]
---

## When to Use

Use this skill when the work is about Web Agent itself: understanding current capabilities, debugging runtime behavior, fixing bugs, improving procedural knowledge, adapting outside agent systems into Web Agent-native workflows, or turning a repeated lesson into a better bundled or local skill.

This skill is for self-maintenance. It is not a static tool catalog and it does not grant new permissions.

## Live Runtime First

1. Start from current runtime truth, not memory. Use `system_info` for environment assumptions and `capability_list` for installed capability folders.
2. Use `skill_list` to find relevant skills and `skill_view` to read the full `SKILL.md` before following or editing a procedure.
3. Inspect the current repository and nearby tests before changing behavior. Prefer present source files, registry manifests, and focused tests over remembered inventories.
4. Treat facts, session notes, reflections, and learnings as hints that need confirmation against current runtime outputs or files.

## Persistence Ladder

Store information at the smallest durable layer that matches the need:

- Use `memory_save`, `memory_recall`, and `memory_search` for durable facts such as user preferences, stable environment constraints, or confirmed runtime rules.
- Use `session_memory_append`, `session_memory_list`, and `session_search` for rolling session context, temporary decisions, investigation notes, and artifact references.
- Treat reflections and promotable learnings as system-generated signal. Inspect and promote them when useful; do not create parallel manual learning stores.
- Use `cron_list` and `cron_register` for recurring maintenance or recurring checks that should run while the app is open.
- Promote only durable procedural knowledge into skills. Use a skill when the lesson has a repeatable trigger and a reusable step sequence.

## Self-Evolution Loop

1. Reproduce the problem or identify the missing capability with the smallest concrete example.
2. Inspect the live layer that owns the behavior: runtime tool, capability folder, bundled skill, memory surface, UI, or nearby test.
3. Fix the narrowest correct layer. Prefer patching an existing skill or implementation over adding overlapping instructions or duplicate systems.
4. Verify with the smallest relevant test or command first, then broader validation only if the change touches shared behavior.
5. Capture the reusable lesson in the correct persistence layer.
6. Patch this skill or a sibling skill only when the lesson is procedural, repeatable, and worth reusing in future sessions.

## Skill Write Autonomy

When the user explicitly asks for self-evolution, self-maintenance, or skill improvement, Web Agent may patch or create skills directly without asking for a second approval step for the skill file itself.

Use:

- `skill_manage` for targeted skill updates, especially `action: "patch"` for local changes.
- `skill_bulk_save` when adding or updating many skills in one operation.
- support files only under the allowed skill folders such as `references/`, `templates/`, `scripts/`, or `assets/`.

This autonomy applies to skill files. Repository code changes still follow the user request and normal implementation workflow.

## Promotion Rules

Promote into a skill only when the learning is procedural and durable:

- repeated bug pattern with a stable fix path,
- reliable verification sequence,
- reusable adaptation workflow,
- non-obvious runtime constraint that changes how work should be done.

Keep one-off facts, temporary failures, and project-local details out of skills when they belong in facts, session notes, or current code/tests instead.

## Adapting External Systems

When the user points to another agent, skill pack, prompt library, or tool repository, inspect it first and adapt its useful behavior into Web Agent primitives instead of copying it unchanged.

Map source behavior into current Web Agent layers:

- procedural instructions into `SKILL.md`,
- reusable support material into `references/`, `templates/`, `scripts/`, or `assets/`,
- runtime behavior into existing built-in tools or capability folders only when a skill is not enough,
- long-lived facts or preferences into memory tools instead of hidden agent-specific files.

Do not import stale tool catalogs, foreign hook systems, or platform-specific assumptions that Web Agent does not use.

## Guardrails

- Do not maintain static copies of the full runtime tool list inside a skill.
- Do not create parallel learning folders, shadow memory systems, or copied capability inventories.
- Do not add a new skill when patching an existing relevant skill is enough.
- Do not claim a self-evolution fix is complete until the changed behavior or skill has been verified.

## Verification

After skill maintenance:

1. Confirm the skill is discoverable with `skill_list`.
2. Confirm the full document or support file loads with `skill_view`.
3. Confirm the compact skills context still contains metadata only, not the full procedural body.
4. If Web Agent runtime behavior changed, run the smallest relevant tests first, then broader validation if needed.
