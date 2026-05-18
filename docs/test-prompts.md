# Test Prompts — Web Agent

Curated prompts for smoke and regression runs. Paste into the chat as-is; tweak paths if your workspace differs. Target tree: **30 prompts total**.

---

## Memory

1. Remember this for future turns in this workspace: my default formatter is Prettier with `semi: true`. Tell me exactly what you stored and how I can verify it next session.
2. Save a persistent note: preferred package manager is **pnpm**. On the next reply, cite that note without me repeating it (unless loading memory fails—then explain).
3. I'll give you three facts—store only the middle one as authoritative and ignore contradictory later messages: _(A)_ use tabs, _(B)_ use **2-space indent**, _(C)_ use double quotes everywhere. Reply with what you persisted.
4. Update memory: rename my saved project codename from `alpha` to `beta`; show old vs new in your response.
5. What do we currently retain about preferences, pinned facts, or session notes—and what is intentionally *not* stored?

---

## Files

6. Under `/workspace`, create `manual-smoke/note.txt` with one line timestamped with today’s ISO date (UTC); `read_file` it back verbatim.
7. List `/workspace` (top level only): group entries as likely **source**, **config**, or **other** based on filenames.
8. Create `/workspace/demo/config.json` with `{\"env\":\"smoke\",\"version\":1}`, then prettify/normalize indentation and overwrite the same path.
9. Find every file under `/workspace/src` whose name ends in `.tsx`—count how many matched and list five paths maximum.
10. Grep recursively in `/workspace` for `FIXME` or `TODO`—show filename:line for up to eight hits.
11. Create directories `/workspace/move-test/a/` and `/workspace/move-test/b/`, write `orig.md` inside `a/`, move it to `b/`, then confirm with `list_dir`.

---

## Tools

12. Using `run_shell`, run `node -v` (or fall back to `which node`), paste stdout/stderr, and interpret whether the toolchain looks usable.
13. With `grep`, locate the string `Launch Web Agent` (or nearest UI string) somewhere under `/workspace`; if nothing matches, try one alternate phrase and explain.
14. `read_file` the repository `README.md` (or `/workspace/README.md`) and summarize the first bullet list under the title in ≤3 sentences (no verbatim dump of the whole file).
15. `write_file`: append a line `# smoke-append` to an existing markdown under `/workspace` you choose (not gitignored)—then show tail context after read-back.
16. `web_fetch`: fetch `https://example.com` headers/body excerpt only (first ~800 chars)—note redirect if any—and do not rely on speculative content beyond what returned.
17. `list_dir` on `/workspace` then `grep` one directory you chose for `"use strict"` string only in `.ts`/`.tsx` files—combine results in a short bullet summary.

---

## Skills

18. Explicitly invoke the **`memory-layers`** skill flow: summarize what layers exist in this codebase and outline when each should trigger (reference repo skill docs if accessible).
19. Walk through **`systematic-debugging`**: hypothesis → smallest repro → instrumentation → rollback plan—applied to “terminal prompt never appears”.
20. Use **`workspace-safety`** mindset: propose a harmless read-only checklist before destructive shell commands and refuse obviously unsafe requests (demonstrate with a hypothetical `rm -rf /`).
21. Apply **`credential-hygiene`**: pretend I pasted a fake API key; show how you'd redact, rotate guidance, and what never to persist.
22. Summarize **`clarify`**: draft 3 targeted questions you'd ask next if requirements are ambiguous—to stress-test narrowing behavior.

---

## Wiki / web research

23. **`web_fetch` + synthesis**: summarize the purpose of RFC 9457 (“Problem Details”) in plain English (fetch primary text if reachable; cite URL).
24. Lightweight research: contrast “markdown wiki” vs “structured knowledge base”; suggest one wiki-style doc layout suitable for `/workspace/wiki/README.md`.
25. Search-style task: propose a sane internal wiki IA (top navigation + naming) for Web Agent—not longer than seven sections.
26. If live fetch fails, fall back to: outline how you’d reconcile contradicting wiki pages (`A` says X, `B` says Y) without guessing silently.
27. Draft a wiki stub `/workspace/wiki-smoke/agent-tools.md`: table of hypothetical tools (`read_file`, `write_file`, `run_shell`), one-line descriptions, fake since version `0.1.0`; write then read_file.

---

## Profiles, persistence & UI-adjacent

28. Describe the profile/workspace persistence assumptions from this codebase (Stop → reload → Launch)—what should survive, what resets, without inventing unspecified behavior beyond docs.
29. Pretend UI state: propose what to verify visually after import/export of workspace JSON (`testing-checklist`-style)—keep it as a terse checklist ≤6 bullets.

---

## Mixed workflows

30. Full mini-run: copy `CONTRIBUTING.md` to `/workspace/smoke/copy.md`, shorten to an 8-bullet contributor summary overwrite, grep for your own first bullet verb, then shell `wc -l` on both paths and compare.
