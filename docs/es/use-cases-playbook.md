<!-- i18n-sync: en@73a242b 2026-05-21 -->

**Idiomas:** [English](../use-cases-playbook.md) · [简体中文](../zh-CN/use-cases-playbook.md) · [Español](use-cases-playbook.md) · [العربية](../ar/use-cases-playbook.md)

# Manual del asistente personal

Veinticinco escenarios para copiar y pegar y hacer trabajo real con Web Agent. Cada entrada mapea a skills empaquetados y las herramientas que esperan. Los prompts están en inglés — pégalos tal cual en el chat.

**Filtrar por categoría:** [Investigación](#playbook-research) · [Memoria](#playbook-memory) · [Planificación](#playbook-planning) · [Automatización](#playbook-automation) · [Workspace](#playbook-workspace) · [Depuración](#playbook-debug) · [Multimodal](#playbook-multimodal) · [Entrega](#playbook-delivery) · [UX](#playbook-ux) · [Seguridad](#playbook-safety) · [Meta](#playbook-meta)

## Índice rápido

| Categoría | Caso de uso | Bundled skill(s) | Key tools |
| --- | --- | --- | --- |
| Investigación | Encontrar creadores / competidores de nicho | `/open-web-research` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| Investigación | Búsqueda de papers / citas | `/research-pack` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| Investigación | Extraer tabla o JSON de una página | `/structured-extraction` | `web_fetch`, `write_file`, `artifact_present` |
| Meta | Descubrir skills instalables online | `/find-skills` | `web_search`, `web_fetch`, `skill_manage` |
| Memoria | Guardar preferencia durable | `/memory-layers` | `memory_save`, `memory_recall` |
| Memoria | Capturar contexto de sesión | `/memory-layers` | `session_memory_append`, `session_memory_list` |
| Memoria | Espejar memoria en vault estilo Obsidian | `/memory-layers` | `wiki_setup`, `wiki_sync`, `wiki_search` |
| Memoria | Buscar en un chat antiguo | `/memory-layers` | `session_search` |
| Planificación | Plan spec-first (sin ejecutar aún) | `/plan`, `/task-planning` | `read_file`, `grep`, `write_file`, `artifact_present` |
| Planificación | Descomponer petición en todos | `/task-planning` | `todo_write`, `skill_view` |
| Planificación | Ejecutar plan multi-paso aprobado | `/task-execution` | `todo_write`, `read_file`, `write_file`, `artifact_present` |
| Automatización | Digest diario con pestaña abierta | `/heartbeat-cron` | `cron_register`, `cron_list`, `web_search`, `web_fetch` |
| Workspace | Arrancar carpeta de side project | `/project-scaffold` | `make_dir`, `write_file`, `tree` |
| Workspace | Reorganizar archivos con seguridad | `/workspace-safety`, `/browser-runtime-map` | `list_dir`, `find_files`, `move_file`, `tree` |
| Depuración | Caza de bugs por hipótesis | `/systematic-debugging` | `read_file`, `grep`, `file_diff`, `run_shell` |
| Depuración | Shell / `npx` failed in WebContainer | `/browser-runtime-map` | `read_file`, `web_fetch`, `grep` |
| Multimodal | Leer captura o diagrama | `/multimodal-ingest` | `vision_analyze`, `write_file` |
| Multimodal | Resumir tutorial de YouTube | `/multimodal-ingest` | `youtube_transcribe`, `write_file`, `artifact_present` |
| Entrega | Presentar informe en la app | `/artifact-delivery` | `write_file`, `artifact_present` |
| Entrega | Enviar entregable por email | `/artifact-delivery` | `write_file`, `email`, `artifact_present` |
| Entrega | Diagrama de flujo para plan o informe | `/chart` | `artifact_present` |
| UX | Desambiguar petición vaga | `/clarify` | *(none)* |
| Seguridad | Checkpoint antes de borrado masivo | `/workspace-safety` | `list_dir`, `file_stat`, `delete_file` |
| Seguridad | API key pegada / higiene de secretos | `/credential-hygiene` | *(redaction; no secret persistence)* |
| Meta | Mejorar Web Agent en sí | `/web-agent-skill` | `read_file`, `grep`, `skill_manage`, `memory_save` |

---

<a id="playbook-research"></a>

## Investigación y descubrimiento

<details>
<summary><strong>Encontrar creadores / competidores de nicho</strong> — open-web discovery with verified fetches</summary>

When you need a shortlist of people, channels, or companies in a niche — not academic papers.

**Prueba este prompt:**

```
Find 8 YouTube creators in the UAE who regularly post about AI agents or coding assistants.
Verify channel pages with fetches, label each as confirmed/likely/not regional, and save a markdown table under work/research/uae-creators.md — then show it to me.
```

**Bundled skills:** `/open-web-research` (+ `/clarify` if scope unclear; `/structured-extraction` for row shaping; `/artifact-delivery` for preview)

**Herramientas que se activan:** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Búsqueda de papers / citas</strong> — arXiv and Semantic Scholar paths</summary>

When you want papers, citations, or a mini literature review — not general creator discovery.

**Prueba este prompt:**

```
Find 5 recent arXiv papers (2024–2026) on retrieval-augmented generation for code assistants.
Summarize each in 3 bullets, include PDF links, and save work/research/rag-code-assistants.md with a references section.
```

**Bundled skills:** `/research-pack` (+ `/artifact-delivery` for preview)

**Herramientas que se activan:** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Extraer tabla o JSON de una página</strong> — fetch, parse, normalize</summary>

When a webpage has rows you want as CSV or JSON — not a narrative summary.

**Prueba este prompt:**

```
Fetch https://example.com/pricing (or any public pricing page I paste next) and extract plan name, price, and key limits into a deduped JSON array.
Save work/extract/pricing.json and show me a preview table.
```

**Bundled skills:** `/structured-extraction` (+ `/artifact-delivery` for preview)

**Herramientas que se activan:** `web_fetch`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-meta"></a>

## Meta

<details>
<summary><strong>Descubrir skills instalables online</strong> — registry search and install path</summary>

When you want to find community skills from online registries before installing one.

**Prueba este prompt:**

```
/find-skills markdown wiki knowledge base
Search skills.sh, SkillsMP, and Cursor marketplace — return the top 5 by installs or stars with links. Do not install yet; just rank them.
```

**Bundled skills:** `/find-skills` (+ `/clarify` if query ambiguous; `/web-agent-skill` if installing)

**Herramientas que se activan:** `web_search`, `web_fetch`, `skill_manage`

</details>

<details>
<summary><strong>Mejorar Web Agent en sí</strong> — safe self-evolution in this repo</summary>

When you are hacking on Web Agent runtime, skills, or capabilities — not general app work in your workspace.

**Prueba este prompt:**

```
Read how bundled skills are indexed in src/agent/runtime/memory/skills.ts and suggest one surgical improvement to the skills context block. Do not edit bundled SKILL.md files — propose a patch plan only.
```

**Bundled skills:** `/web-agent-skill` (+ `/memory-layers` for where to store lessons)

**Herramientas que se activan:** `read_file`, `grep`, `skill_manage`, `memory_save`

</details>

---

<a id="playbook-memory"></a>

## Memoria y conocimiento

<details>
<summary><strong>Guardar preferencia durable</strong> — facts that survive reloads</summary>

When a preference should persist across sessions — not a one-off session note.

**Prueba este prompt:**

```
Remember this for future turns: my default formatter is Prettier with semi: true and singleQuote: false.
Tell me exactly what key you stored and how I can verify it next session.
```

**Bundled skills:** `/memory-layers`

**Herramientas que se activan:** `memory_save`, `memory_recall`

</details>

<details>
<summary><strong>Capturar contexto de sesión</strong> — lightweight in-session notes</summary>

When you want a decision or status captured for this conversation — not a permanent fact.

**Prueba este prompt:**

```
We're exploring option B for the dashboard layout. Append a short session note with that decision and what we ruled out — I don't need this as a permanent fact yet.
```

**Bundled skills:** `/memory-layers`

**Herramientas que se activan:** `session_memory_append`, `session_memory_list`

</details>

<details>
<summary><strong>Espejar memoria en vault estilo Obsidian</strong> — PARA markdown for humans</summary>

When you want browseable wiki files synced from runtime memory — default vault under `.webagent/knowledge-vault/`.

**Prueba este prompt:**

```
/wiki_setup
/wiki_sync all
/wiki_search deployment
Show me what landed in the vault index and one snippet from search.
```

**Bundled skills:** `/memory-layers`

**Herramientas que se activan:** `wiki_setup`, `wiki_sync`, `wiki_search`

</details>

<details>
<summary><strong>Buscar en un chat antiguo</strong> — search archived sessions</summary>

When you remember discussing something but not which session — keyword search across history.

**Prueba este prompt:**

```
Search my past conversations for mentions of "Prettier" or "formatter" and quote the most relevant snippet with the session date if available.
```

**Bundled skills:** `/memory-layers`

**Herramientas que se activan:** `session_search`

</details>

---

<a id="playbook-planning"></a>

## Planificación y ejecución

<details>
<summary><strong>Plan spec-first (sin ejecutar aún)</strong> — `/plan` before code</summary>

When you want a reviewable markdown spec saved under `plans/` — implementation comes on a follow-up message.

**Prueba este prompt:**

```
/plan Add a dark-mode toggle to the settings panel with persisted preference and a short README note
```

**Seguimiento (siguiente mensaje):**

```
Execute the plan you just wrote.
```

**Bundled skills:** `/plan` command + `/task-planning` (+ `/task-execution` on follow-up; `/artifact-delivery` for plan preview)

**Herramientas que se activan:** `read_file`, `grep`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Descomponer petición en todos</strong> — decompose before tool fan-out</summary>

When one message contains several deliverables — ordered todos before action.

**Prueba este prompt:**

```
I need you to: (1) list top-level files in the workspace, (2) grep for TODO comments, (3) write a one-page summary markdown. Break this into todos first and show me the list before doing step 1.
```

**Bundled skills:** `/task-planning` (+ `/chart` if ≥4 steps; `/task-execution` after approval)

**Herramientas que se activan:** `todo_write`, `skill_view`

</details>

<details>
<summary><strong>Ejecutar plan multi-paso aprobado</strong> — gated step-by-step run</summary>

When todos already exist and you said "go ahead" — full report at the end.

**Prueba este prompt:**

```
Execute the plan you just wrote. Stop if a step fails and give me a partial report.
```

**Bundled skills:** `/task-execution` (+ `/task-planning` if no plan; `/systematic-debugging` on failure; `/artifact-delivery` for report)

**Herramientas que se activan:** `todo_write`, `read_file`, `write_file`, `grep`, `artifact_present`

</details>

---

<a id="playbook-automation"></a>

## Automatización

<details>
<summary><strong>Digest diario con pestaña abierta</strong> — heartbeat cron, not host crontab</summary>

When you want a recurring job while the app tab stays open — digests, reminders, periodic search.

**Prueba este prompt:**

```
Register a daily heartbeat job at 9:00 AM (my timezone) that web_searches "AI agent browser news", fetches the top 2 results, and appends a 5-bullet digest to work/digests/daily.md. List the job with cron_list when done.
```

**Bundled skills:** `/heartbeat-cron` (+ `/browser-runtime-map` for step tools; `/artifact-delivery` for delivery options)

**Herramientas que se activan:** `cron_register`, `cron_list`, `web_search`, `web_fetch`, `write_file`

</details>

---

<a id="playbook-workspace"></a>

## Workspace y archivos

<details>
<summary><strong>Arrancar carpeta de side project</strong> — scaffold before writes</summary>

When starting a new app, demo, or spike — isolated folder under `projects/` or `work/`.

**Prueba este prompt:**

```
Create projects/expense-tracker/ with a minimal README, package.json stub, and src/ folder. Show me the tree when done.
```

**Bundled skills:** `/project-scaffold`

**Herramientas que se activan:** `make_dir`, `write_file`, `tree`

</details>

<details>
<summary><strong>Reorganizar archivos con seguridad</strong> — checkpoint mindset before moves</summary>

When cleaning up uploads or old drafts — list and verify before bulk moves or deletes.

**Prueba este prompt:**

```
List everything under uploads/ and work/. Propose a safe reorganization (moves only, no deletes yet) and explain what you'd checkpoint first.
```

**Bundled skills:** `/workspace-safety`, `/browser-runtime-map`

**Herramientas que se activan:** `list_dir`, `find_files`, `move_file`, `tree`

</details>

---

<a id="playbook-debug"></a>

## Depuración y fiabilidad

<details>
<summary><strong>Caza de bugs por hipótesis</strong> — reproduce before random edits</summary>

When something fails, flakes, or regresses — structured diagnosis, not guess-and-patch.

**Prueba este prompt:**

```
The chat input stops accepting paste after I upload an image. Form one hypothesis, name the smallest read-only checks you'd run first (grep/read_file), and only then suggest a fix.
```

**Bundled skills:** `/systematic-debugging`

**Herramientas que se activan:** `read_file`, `grep`, `file_diff`, `run_shell`

</details>

<details>
<summary><strong>Fallo de shell / npx en WebContainer</strong> — pick the right tool</summary>

When `curl`, `git clone`, or `npx` fails — use file and HTTP tools instead of host shell.

**Prueba este prompt:**

```
run_shell failed with "command not found" when I asked you to curl an API. Fetch the same URL with web_fetch instead and explain what works in this browser runtime vs what doesn't.
```

**Bundled skills:** `/browser-runtime-map`

**Herramientas que se activan:** `read_file`, `web_fetch`, `grep`

</details>

---

<a id="playbook-multimodal"></a>

## Multimodal

<details>
<summary><strong>Leer captura o diagrama</strong> — vision before reasoning</summary>

When the input is an image path in the workspace or an upload — OCR, UI state, architecture diagrams.

**Prueba este prompt:**

```
I uploaded a screenshot to uploads/. Analyze it with vision: list every visible error message and button label verbatim, then save work/notes/screenshot-audit.md.
```

**Bundled skills:** `/multimodal-ingest`

**Herramientas que se activan:** `vision_analyze`, `write_file`

</details>

<details>
<summary><strong>Resumir tutorial de YouTube</strong> — transcript-first</summary>

When you paste a YouTube link — full transcript with timestamps before summarizing.

**Prueba este prompt:**

```
Summarize this tutorial: https://www.youtube.com/watch?v=dQw4w9WgXcQ
Pull the transcript, extract 8 timestamped takeaways, and present a short markdown report.
```

**Bundled skills:** `/multimodal-ingest` (+ `/artifact-delivery` for preview)

**Herramientas que se activan:** `youtube_transcribe`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-delivery"></a>

## Entrega y comunicación

<details>
<summary><strong>Presentar informe en la app</strong> — View popup, not inline dump</summary>

When the deliverable is markdown or a file — use the artifact bar for preview/download.

**Prueba este prompt:**

```
Write a one-page weekly status report to work/reports/week.md (Goals / Done / Blockers / Next) and present it with artifact_present — don't paste the full body in chat.
```

**Bundled skills:** `/artifact-delivery`

**Herramientas que se activan:** `write_file`, `artifact_present`

</details>

<details>
<summary><strong>Enviar entregable por email</strong> — outbound via Resend when configured</summary>

When you need the report emailed — requires Resend configured in settings.

**Prueba este prompt:**

```
Draft work/reports/summary.md with a 5-bullet project update, present it, and if email is configured send it to my address with subject "Weekly update".
```

**Bundled skills:** `/artifact-delivery` (+ `/credential-hygiene` if keys mentioned)

**Herramientas que se activan:** `write_file`, `email`, `artifact_present`

</details>

<details>
<summary><strong>Diagrama de flujo para plan o informe</strong> — Mermaid via artifact preview</summary>

When a diagram clarifies steps, flows, or architecture — GitHub-style Mermaid in artifact view.

**Prueba este prompt:**

```
Draw a Mermaid flowchart of my morning routine automation (wake → digest → todo review → deep work) and present it so I can view the diagram in the artifact popup.
```

**Bundled skills:** `/chart` (+ `/artifact-delivery`)

**Herramientas que se activan:** `artifact_present`

</details>

---

<a id="playbook-ux"></a>

## UX

<details>
<summary><strong>Desambiguar petición vaga</strong> — structured choices, no guessing</summary>

When intent is ambiguous — one clarification block with options in the UI.

**Prueba este prompt:**

```
Help me organize my stuff.
```

O explícitamente:

```
/clarify I want to improve my workflow but I'm not sure where to start
```

**Bundled skills:** `/clarify`

**Herramientas que se activan:** *(none — emits `<<<CLARIFY>>>` block)*

</details>

---

<a id="playbook-safety"></a>

## Seguridad e higiene

<details>
<summary><strong>Checkpoint antes de borrado masivo</strong> — list and stat before destructive ops</summary>

When you want cleanup — export or list scope before `delete_file` or wide refactors.

**Prueba este prompt:**

```
I want to delete everything under work/scratch/. List what's there with sizes, confirm nothing outside that tree would be touched, then delete only if the list matches my intent.
```

**Bundled skills:** `/workspace-safety`

**Herramientas que se activan:** `list_dir`, `file_stat`, `delete_file`

</details>

<details>
<summary><strong>API key pegada / higiene de secretos</strong> — redact, never persist secrets</summary>

When you accidentally paste a key or ask to store secrets — rotate guidance, no `memory_save` for raw tokens.

**Prueba este prompt:**

```
I pasted this by mistake: sk-test-1234567890abcdef — redact it from your reply, tell me what you will NOT store, and how to rotate safely.
```

**Bundled skills:** `/credential-hygiene`

**Herramientas que se activan:** *(redaction guidance; avoid `memory_save` for secrets)*

</details>

---

## Documentación relacionada

- [test-prompts.md](test-prompts.md) — prompts de humo para contribuidores
- [README.es.md](../../README.es.md) — visión del producto y catálogo de herramientas
- [CAPABILITIES.md](CAPABILITIES.md) — añadir skills y capacidades
