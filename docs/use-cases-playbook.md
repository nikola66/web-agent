# Personal Helper Playbook

Twenty-five copy-paste scenarios for getting real work done with Web Agent. Each entry maps to bundled skills and the tools those skills expect. Prompts stay in English — paste them as-is into chat.

**Filter by category:** [Research](#playbook-research) · [Memory](#playbook-memory) · [Planning](#playbook-planning) · [Automation](#playbook-automation) · [Workspace](#playbook-workspace) · [Debug](#playbook-debug) · [Multimodal](#playbook-multimodal) · [Delivery](#playbook-delivery) · [UX](#playbook-ux) · [Safety](#playbook-safety) · [Meta](#playbook-meta)

## Quick index

| Category | Use case | Bundled skill(s) | Key tools |
| --- | --- | --- | --- |
| Research | Find niche creators / competitors | `/open-web-research` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| Research | Academic paper / citation dig | `/research-pack` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| Research | Extract a table or JSON from a page | `/structured-extraction` | `web_fetch`, `write_file`, `artifact_present` |
| Meta | Discover installable skills online | `/find_skills` | `web_search`, `web_fetch`, `skill_manage` |
| Memory | Save a durable preference | `/memory-layers` | `memory_save`, `memory_recall` |
| Memory | Capture rolling session context | `/memory-layers` | `session_memory_append`, `session_memory_list` |
| Memory | Mirror memory into Obsidian-style vault | `/memory-layers` | `wiki_setup`, `wiki_sync`, `wiki_search` |
| Memory | Find something from an old chat | `/memory-layers` | `session_search` |
| Planning | Spec-first feature plan (no execution yet) | `/plan`, `/task-planning` | `read_file`, `grep`, `write_file`, `artifact_present` |
| Planning | Break a stacked request into todos | `/task-planning` | `todo_write`, `skill_view` |
| Planning | Execute an approved multi-step plan | `/task-execution` | `todo_write`, `read_file`, `write_file`, `artifact_present` |
| Automation | Daily digest while tab is open | `/heartbeat-cron` | `cron_register`, `cron_list`, `web_search`, `web_fetch` |
| Workspace | Bootstrap a new side project folder | `/project-scaffold` | `make_dir`, `write_file`, `tree` |
| Workspace | Reorganize files safely | `/workspace-safety`, `/browser-runtime-map` | `list_dir`, `find_files`, `move_file`, `tree` |
| Debug | Hypothesis-first bug hunt | `/systematic-debugging` | `read_file`, `grep`, `file_diff`, `run_shell` |
| Debug | Shell / `npx` failed in WebContainer | `/browser-runtime-map` | `read_file`, `web_fetch`, `grep` |
| Multimodal | Read a screenshot or diagram | `/multimodal-ingest` | `vision_analyze`, `write_file` |
| Multimodal | Summarize a YouTube tutorial | `/multimodal-ingest` | `youtube_transcribe`, `write_file`, `artifact_present` |
| Delivery | Present a finished report in-app | `/artifact-delivery` | `write_file`, `artifact_present` |
| Delivery | Email a deliverable | `/artifact-delivery` | `write_file`, `email`, `artifact_present` |
| Delivery | Flowchart for a plan or report | `/chart` | `artifact_present` |
| UX | Disambiguate a vague ask | `/clarify` | *(none)* |
| Safety | Checkpoint before bulk delete | `/workspace-safety` | `list_dir`, `file_stat`, `delete_file` |
| Safety | Pasted API key / secret hygiene | `/credential-hygiene` | *(redaction; no secret persistence)* |
| Meta | Improve Web Agent itself | `/web-agent-skill` | `read_file`, `grep`, `skill_manage`, `memory_save` |

---

<a id="playbook-research"></a>

## Research & discovery

<details>
<summary><strong>Find niche creators / competitors</strong> — open-web discovery with verified fetches</summary>

When you need a shortlist of people, channels, or companies in a niche — not academic papers.

**Try this prompt:**

```
Find 8 YouTube creators in the UAE who regularly post about AI agents or coding assistants.
Verify channel pages with fetches, label each as confirmed/likely/not regional, and save a markdown table under work/research/uae-creators.md — then show it to me.
```

**Bundled skills:** `/open-web-research` (+ `/clarify` if scope unclear; `/structured-extraction` for row shaping; `/artifact-delivery` for preview)

**Tools that fire:** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Academic paper / citation dig</strong> — arXiv and Semantic Scholar paths</summary>

When you want papers, citations, or a mini literature review — not general creator discovery.

**Try this prompt:**

```
Find 5 recent arXiv papers (2024–2026) on retrieval-augmented generation for code assistants.
Summarize each in 3 bullets, include PDF links, and save work/research/rag-code-assistants.md with a references section.
```

**Bundled skills:** `/research-pack` (+ `/artifact-delivery` for preview)

**Tools that fire:** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Extract a table or JSON from a page</strong> — fetch, parse, normalize</summary>

When a webpage has rows you want as CSV or JSON — not a narrative summary.

**Try this prompt:**

```
Fetch https://example.com/pricing (or any public pricing page I paste next) and extract plan name, price, and key limits into a deduped JSON array.
Save work/extract/pricing.json and show me a preview table.
```

**Bundled skills:** `/structured-extraction` (+ `/artifact-delivery` for preview)

**Tools that fire:** `web_fetch`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-meta"></a>

## Meta

<details>
<summary><strong>Discover installable skills online</strong> — registry search and install path</summary>

When you want to find community skills from online registries before installing one.

**Try this prompt:**

```
/find_skills markdown wiki knowledge base
Search skills.sh, SkillsMP, and Cursor marketplace — return the top 5 by installs or stars with links. Do not install yet; just rank them.
```

**Bundled skills:** `/find_skills` (+ `/clarify` if query ambiguous; `/web-agent-skill` if installing)

**Tools that fire:** `web_search`, `web_fetch`, `skill_manage`

</details>

<details>
<summary><strong>Improve Web Agent itself</strong> — safe self-evolution in this repo</summary>

When you are hacking on Web Agent runtime, skills, or capabilities — not general app work in your workspace.

**Try this prompt:**

```
Read how bundled skills are indexed in src/agent/runtime/memory/skills.ts and suggest one surgical improvement to the skills context block. Do not edit bundled SKILL.md files — propose a patch plan only.
```

**Bundled skills:** `/web-agent-skill` (+ `/memory-layers` for where to store lessons)

**Tools that fire:** `read_file`, `grep`, `skill_manage`, `memory_save`

</details>

---

<a id="playbook-memory"></a>

## Memory & knowledge

<details>
<summary><strong>Save a durable preference</strong> — facts that survive reloads</summary>

When a preference should persist across sessions — not a one-off session note.

**Try this prompt:**

```
Remember this for future turns: my default formatter is Prettier with semi: true and singleQuote: false.
Tell me exactly what key you stored and how I can verify it next session.
```

**Bundled skills:** `/memory-layers`

**Tools that fire:** `memory_save`, `memory_recall`

</details>

<details>
<summary><strong>Capture rolling session context</strong> — lightweight in-session notes</summary>

When you want a decision or status captured for this conversation — not a permanent fact.

**Try this prompt:**

```
We're exploring option B for the dashboard layout. Append a short session note with that decision and what we ruled out — I don't need this as a permanent fact yet.
```

**Bundled skills:** `/memory-layers`

**Tools that fire:** `session_memory_append`, `session_memory_list`

</details>

<details>
<summary><strong>Mirror memory into Obsidian-style vault</strong> — PARA markdown for humans</summary>

When you want browseable wiki files synced from runtime memory — default vault under `.webagent/knowledge-vault/`.

**Try this prompt:**

```
/wiki_setup
/wiki_sync all
/wiki_search deployment
Show me what landed in the vault index and one snippet from search.
```

**Bundled skills:** `/memory-layers`

**Tools that fire:** `wiki_setup`, `wiki_sync`, `wiki_search`

</details>

<details>
<summary><strong>Find something from an old chat</strong> — search archived sessions</summary>

When you remember discussing something but not which session — keyword search across history.

**Try this prompt:**

```
Search my past conversations for mentions of "Prettier" or "formatter" and quote the most relevant snippet with the session date if available.
```

**Bundled skills:** `/memory-layers`

**Tools that fire:** `session_search`

</details>

---

<a id="playbook-planning"></a>

## Planning & execution

<details>
<summary><strong>Spec-first feature plan (no execution yet)</strong> — `/plan` before code</summary>

When you want a reviewable markdown spec saved under `plans/` — implementation comes on a follow-up message.

**Try this prompt:**

```
/plan Add a dark-mode toggle to the settings panel with persisted preference and a short README note
```

**Follow-up (next message):**

```
Execute the plan you just wrote.
```

**Bundled skills:** `/plan` command + `/task-planning` (+ `/task-execution` on follow-up; `/artifact-delivery` for plan preview)

**Tools that fire:** `read_file`, `grep`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Break a stacked request into todos</strong> — decompose before tool fan-out</summary>

When one message contains several deliverables — ordered todos before action.

**Try this prompt:**

```
I need you to: (1) list top-level files in the workspace, (2) grep for TODO comments, (3) write a one-page summary markdown. Break this into todos first and show me the list before doing step 1.
```

**Bundled skills:** `/task-planning` (+ `/chart` if ≥4 steps; `/task-execution` after approval)

**Tools that fire:** `todo_write`, `skill_view`

</details>

<details>
<summary><strong>Execute an approved multi-step plan</strong> — gated step-by-step run</summary>

When todos already exist and you said "go ahead" — full report at the end.

**Try this prompt:**

```
Execute the plan you just wrote. Stop if a step fails and give me a partial report.
```

**Bundled skills:** `/task-execution` (+ `/task-planning` if no plan; `/systematic-debugging` on failure; `/artifact-delivery` for report)

**Tools that fire:** `todo_write`, `read_file`, `write_file`, `grep`, `artifact_present`

</details>

---

<a id="playbook-automation"></a>

## Automation

<details>
<summary><strong>Daily digest while tab is open</strong> — heartbeat cron, not host crontab</summary>

When you want a recurring job while the app tab stays open — digests, reminders, periodic search.

**Try this prompt:**

```
Register a daily heartbeat job at 9:00 AM (my timezone) that web_searches "AI agent browser news", fetches the top 2 results, and appends a 5-bullet digest to work/digests/daily.md. List the job with cron_list when done.
```

**Bundled skills:** `/heartbeat-cron` (+ `/browser-runtime-map` for step tools; `/artifact-delivery` for delivery options)

**Tools that fire:** `cron_register`, `cron_list`, `web_search`, `web_fetch`, `write_file`

</details>

---

<a id="playbook-workspace"></a>

## Workspace & files

<details>
<summary><strong>Bootstrap a new side project folder</strong> — scaffold before writes</summary>

When starting a new app, demo, or spike — isolated folder under `projects/` or `work/`.

**Try this prompt:**

```
Create projects/expense-tracker/ with a minimal README, package.json stub, and src/ folder. Show me the tree when done.
```

**Bundled skills:** `/project-scaffold`

**Tools that fire:** `make_dir`, `write_file`, `tree`

</details>

<details>
<summary><strong>Reorganize files safely</strong> — checkpoint mindset before moves</summary>

When cleaning up uploads or old drafts — list and verify before bulk moves or deletes.

**Try this prompt:**

```
List everything under uploads/ and work/. Propose a safe reorganization (moves only, no deletes yet) and explain what you'd checkpoint first.
```

**Bundled skills:** `/workspace-safety`, `/browser-runtime-map`

**Tools that fire:** `list_dir`, `find_files`, `move_file`, `tree`

</details>

---

<a id="playbook-debug"></a>

## Debug & reliability

<details>
<summary><strong>Hypothesis-first bug hunt</strong> — reproduce before random edits</summary>

When something fails, flakes, or regresses — structured diagnosis, not guess-and-patch.

**Try this prompt:**

```
The chat input stops accepting paste after I upload an image. Form one hypothesis, name the smallest read-only checks you'd run first (grep/read_file), and only then suggest a fix.
```

**Bundled skills:** `/systematic-debugging`

**Tools that fire:** `read_file`, `grep`, `file_diff`, `run_shell`

</details>

<details>
<summary><strong>Shell / npx failed in WebContainer</strong> — pick the right tool</summary>

When `curl`, `git clone`, or `npx` fails — use file and HTTP tools instead of host shell.

**Try this prompt:**

```
run_shell failed with "command not found" when I asked you to curl an API. Fetch the same URL with web_fetch instead and explain what works in this browser runtime vs what doesn't.
```

**Bundled skills:** `/browser-runtime-map`

**Tools that fire:** `read_file`, `web_fetch`, `grep`

</details>

---

<a id="playbook-multimodal"></a>

## Multimodal

<details>
<summary><strong>Read a screenshot or diagram</strong> — vision before reasoning</summary>

When the input is an image path in the workspace or an upload — OCR, UI state, architecture diagrams.

**Try this prompt:**

```
I uploaded a screenshot to uploads/. Analyze it with vision: list every visible error message and button label verbatim, then save work/notes/screenshot-audit.md.
```

**Bundled skills:** `/multimodal-ingest`

**Tools that fire:** `vision_analyze`, `write_file`

</details>

<details>
<summary><strong>Summarize a YouTube tutorial</strong> — transcript-first</summary>

When you paste a YouTube link — full transcript with timestamps before summarizing.

**Try this prompt:**

```
Summarize this tutorial: https://www.youtube.com/watch?v=dQw4w9WgXcQ
Pull the transcript, extract 8 timestamped takeaways, and present a short markdown report.
```

**Bundled skills:** `/multimodal-ingest` (+ `/artifact-delivery` for preview)

**Tools that fire:** `youtube_transcribe`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-delivery"></a>

## Delivery & communication

<details>
<summary><strong>Present a finished report in-app</strong> — View popup, not inline dump</summary>

When the deliverable is markdown or a file — use the artifact bar for preview/download.

**Try this prompt:**

```
Write a one-page weekly status report to work/reports/week.md (Goals / Done / Blockers / Next) and present it with artifact_present — don't paste the full body in chat.
```

**Bundled skills:** `/artifact-delivery`

**Tools that fire:** `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Email a deliverable</strong> — outbound via Resend when configured</summary>

When you need the report emailed — requires Resend configured in settings.

**Try this prompt:**

```
Draft work/reports/summary.md with a 5-bullet project update, present it, and if email is configured send it to my address with subject "Weekly update".
```

**Bundled skills:** `/artifact-delivery` (+ `/credential-hygiene` if keys mentioned)

**Tools that fire:** `write_file`, `email`, `artifact_present`

</details>

<details>
<summary><strong>Flowchart for a plan or report</strong> — Mermaid via artifact preview</summary>

When a diagram clarifies steps, flows, or architecture — GitHub-style Mermaid in artifact view.

**Try this prompt:**

```
Draw a Mermaid flowchart of my morning routine automation (wake → digest → todo review → deep work) and present it so I can view the diagram in the artifact popup.
```

**Bundled skills:** `/chart` (+ `/artifact-delivery`)

**Tools that fire:** `artifact_present`

</details>

---

<a id="playbook-ux"></a>

## UX

<details>
<summary><strong>Disambiguate a vague ask</strong> — structured choices, no guessing</summary>

When intent is ambiguous — one clarification block with options in the UI.

**Try this prompt:**

```
Help me organize my stuff.
```

Or explicitly:

```
/clarify I want to improve my workflow but I'm not sure where to start
```

**Bundled skills:** `/clarify`

**Tools that fire:** *(none — emits `<<<CLARIFY>>>` block)*

</details>

---

<a id="playbook-safety"></a>

## Safety & hygiene

<details>
<summary><strong>Checkpoint before bulk delete</strong> — list and stat before destructive ops</summary>

When you want cleanup — export or list scope before `delete_file` or wide refactors.

**Try this prompt:**

```
I want to delete everything under work/scratch/. List what's there with sizes, confirm nothing outside that tree would be touched, then delete only if the list matches my intent.
```

**Bundled skills:** `/workspace-safety`

**Tools that fire:** `list_dir`, `file_stat`, `delete_file`

</details>

<details>
<summary><strong>Pasted API key / secret hygiene</strong> — redact, never persist secrets</summary>

When you accidentally paste a key or ask to store secrets — rotate guidance, no `memory_save` for raw tokens.

**Try this prompt:**

```
I pasted this by mistake: sk-test-1234567890abcdef — redact it from your reply, tell me what you will NOT store, and how to rotate safely.
```

**Bundled skills:** `/credential-hygiene`

**Tools that fire:** *(redaction guidance; avoid `memory_save` for secrets)*

</details>

---

## Related docs

- [test-prompts.md](test-prompts.md) — contributor smoke prompts
- [README.md](../README.md) — product overview and tool catalog
- [CAPABILITIES.md](../CAPABILITIES.md) — adding skills and capabilities
