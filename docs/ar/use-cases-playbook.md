<!-- i18n-sync: en@73a242b 2026-05-21 -->

**اللغات:** [English](../use-cases-playbook.md) · [简体中文](../zh-CN/use-cases-playbook.md) · [Español](../es/use-cases-playbook.md) · [العربية](use-cases-playbook.md)

# دليل المساعد الشخصي

خمسة وعشرون سيناريو للنسخ واللصق لإنجاز عمل حقيقي مع Web Agent. كل مدخل يرتبط بالمهارات المجمّعة والأدوات المتوقعة. المطالبات بالإنجليزية — الصقها كما هي في الدردشة.

**تصفية حسب الفئة:** [بحث](#playbook-research) · [ذاكرة](#playbook-memory) · [تخطيط](#playbook-planning) · [أتمتة](#playbook-automation) · [مساحة عمل](#playbook-workspace) · [تصحيح](#playbook-debug) · [متعدد الوسائط](#playbook-multimodal) · [تسليم](#playbook-delivery) · [تجربة](#playbook-ux) · [أمان](#playbook-safety) · [Meta](#playbook-meta)

## فهرس سريع

| الفئة | حالة الاستخدام | Bundled skill(s) | Key tools |
| --- | --- | --- | --- |
| بحث | إيجاد منشئي محتوى / منافسين في niche | `/open-web-research` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| بحث | أوراق أكاديمية / استشهادات | `/research-pack` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| بحث | استخراج جدول أو JSON من صفحة | `/structured-extraction` | `web_fetch`, `write_file`, `artifact_present` |
| Meta | اكتشاف skills قابلة للتثبيت | `/find-skills` | `web_search`, `web_fetch`, `skill_manage` |
| ذاكرة | حفظ تفضيل دائم | `/memory-layers` | `memory_save`, `memory_recall` |
| ذاكرة | تدوين سياق الجلسة | `/memory-layers` | `session_memory_append`, `session_memory_list` |
| ذاكرة | Mirroring إلى vault بأسلوب Obsidian | `/memory-layers` | `wiki_setup`, `wiki_sync`, `wiki_search` |
| ذاكرة | البحث في محادثة قديمة | `/memory-layers` | `session_search` |
| تخطيط | خطة spec-first (بدون تنفيذ) | `/plan`, `/task-planning` | `read_file`, `grep`, `write_file`, `artifact_present` |
| تخطيط | تقسيم طلب متعدد إلى todos | `/task-planning` | `todo_write`, `skill_view` |
| تخطيط | تنفيذ خطة متعددة الخطوات | `/task-execution` | `todo_write`, `read_file`, `write_file`, `artifact_present` |
| أتمتة | Digest يومي مع تبويب مفتوح | `/heartbeat-cron` | `cron_register`, `cron_list`, `web_search`, `web_fetch` |
| مساحة عمل | تهيئة مجلد مشروع جانبي | `/project-scaffold` | `make_dir`, `write_file`, `tree` |
| مساحة عمل | إعادة تنظيم ملفات بأمان | `/workspace-safety`, `/browser-runtime-map` | `list_dir`, `find_files`, `move_file`, `tree` |
| تصحيح | تصحيح بالفرضيات | `/systematic-debugging` | `read_file`, `grep`, `file_diff`, `run_shell` |
| تصحيح | Shell / `npx` failed in WebContainer | `/browser-runtime-map` | `read_file`, `web_fetch`, `grep` |
| متعدد الوسائط | قراءة لقطة شاشة أو مخطط | `/multimodal-ingest` | `vision_analyze`, `write_file` |
| متعدد الوسائط | تلخيص tutorial على YouTube | `/multimodal-ingest` | `youtube_transcribe`, `write_file`, `artifact_present` |
| تسليم | عرض تقرير داخل التطبيق | `/artifact-delivery` | `write_file`, `artifact_present` |
| تسليم | إرسال deliverable بالبريد | `/artifact-delivery` | `write_file`, `email`, `artifact_present` |
| تسليم | مخطط انسيابي للخطة أو التقرير | `/chart` | `artifact_present` |
| تجربة | توضيح طلب غامض | `/clarify` | *(none)* |
| أمان | Checkpoint قبل حذف جماعي | `/workspace-safety` | `list_dir`, `file_stat`, `delete_file` |
| أمان | مفتاح API ملصوق / hygiene | `/credential-hygiene` | *(redaction; no secret persistence)* |
| Meta | تحسين Web Agent نفسه | `/web-agent-skill` | `read_file`, `grep`, `skill_manage`, `memory_save` |

---

<a id="playbook-research"></a>

## البحث والاكتشاف

<details>
<summary><strong>إيجاد منشئي محتوى / منافسين في niche</strong> — open-web discovery with verified fetches</summary>

When you need a shortlist of people, channels, or companies in a niche — not academic papers.

**جرّب هذا الـ prompt:**

```
Find 8 YouTube creators in the UAE who regularly post about AI agents or coding assistants.
Verify channel pages with fetches, label each as confirmed/likely/not regional, and save a markdown table under work/research/uae-creators.md — then show it to me.
```

**Bundled skills:** `/open-web-research` (+ `/clarify` if scope unclear; `/structured-extraction` for row shaping; `/artifact-delivery` for preview)

**الأدوات المتوقعة:** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>أوراق أكاديمية / استشهادات</strong> — arXiv and Semantic Scholar paths</summary>

When you want papers, citations, or a mini literature review — not general creator discovery.

**جرّب هذا الـ prompt:**

```
Find 5 recent arXiv papers (2024–2026) on retrieval-augmented generation for code assistants.
Summarize each in 3 bullets, include PDF links, and save work/research/rag-code-assistants.md with a references section.
```

**Bundled skills:** `/research-pack` (+ `/artifact-delivery` for preview)

**الأدوات المتوقعة:** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>استخراج جدول أو JSON من صفحة</strong> — fetch, parse, normalize</summary>

When a webpage has rows you want as CSV or JSON — not a narrative summary.

**جرّب هذا الـ prompt:**

```
Fetch https://example.com/pricing (or any public pricing page I paste next) and extract plan name, price, and key limits into a deduped JSON array.
Save work/extract/pricing.json and show me a preview table.
```

**Bundled skills:** `/structured-extraction` (+ `/artifact-delivery` for preview)

**الأدوات المتوقعة:** `web_fetch`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-meta"></a>

## Meta

<details>
<summary><strong>اكتشاف skills قابلة للتثبيت</strong> — registry search and install path</summary>

When you want to find community skills from online registries before installing one.

**جرّب هذا الـ prompt:**

```
/find-skills markdown wiki knowledge base
Search skills.sh, SkillsMP, and Cursor marketplace — return the top 5 by installs or stars with links. Do not install yet; just rank them.
```

**Bundled skills:** `/find-skills` (+ `/clarify` if query ambiguous; `/web-agent-skill` if installing)

**الأدوات المتوقعة:** `web_search`, `web_fetch`, `skill_manage`

</details>

<details>
<summary><strong>تحسين Web Agent نفسه</strong> — safe self-evolution in this repo</summary>

When you are hacking on Web Agent runtime, skills, or capabilities — not general app work in your workspace.

**جرّب هذا الـ prompt:**

```
Read how bundled skills are indexed in src/agent/runtime/memory/skills.ts and suggest one surgical improvement to the skills context block. Do not edit bundled SKILL.md files — propose a patch plan only.
```

**Bundled skills:** `/web-agent-skill` (+ `/memory-layers` for where to store lessons)

**الأدوات المتوقعة:** `read_file`, `grep`, `skill_manage`, `memory_save`

</details>

---

<a id="playbook-memory"></a>

## الذاكرة والمعرفة

<details>
<summary><strong>حفظ تفضيل دائم</strong> — facts that survive reloads</summary>

When a preference should persist across sessions — not a one-off session note.

**جرّب هذا الـ prompt:**

```
Remember this for future turns: my default formatter is Prettier with semi: true and singleQuote: false.
Tell me exactly what key you stored and how I can verify it next session.
```

**Bundled skills:** `/memory-layers`

**الأدوات المتوقعة:** `memory_save`, `memory_recall`

</details>

<details>
<summary><strong>تدوين سياق الجلسة</strong> — lightweight in-session notes</summary>

When you want a decision or status captured for this conversation — not a permanent fact.

**جرّب هذا الـ prompt:**

```
We're exploring option B for the dashboard layout. Append a short session note with that decision and what we ruled out — I don't need this as a permanent fact yet.
```

**Bundled skills:** `/memory-layers`

**الأدوات المتوقعة:** `session_memory_append`, `session_memory_list`

</details>

<details>
<summary><strong>Mirroring إلى vault بأسلوب Obsidian</strong> — PARA markdown for humans</summary>

When you want browseable wiki files synced from runtime memory — default vault under `.webagent/knowledge-vault/`.

**جرّب هذا الـ prompt:**

```
/wiki_setup
/wiki_sync all
/wiki_search deployment
Show me what landed in the vault index and one snippet from search.
```

**Bundled skills:** `/memory-layers`

**الأدوات المتوقعة:** `wiki_setup`, `wiki_sync`, `wiki_search`

</details>

<details>
<summary><strong>البحث في محادثة قديمة</strong> — search archived sessions</summary>

When you remember discussing something but not which session — keyword search across history.

**جرّب هذا الـ prompt:**

```
Search my past conversations for mentions of "Prettier" or "formatter" and quote the most relevant snippet with the session date if available.
```

**Bundled skills:** `/memory-layers`

**الأدوات المتوقعة:** `session_search`

</details>

---

<a id="playbook-planning"></a>

## التخطيط والتنفيذ

<details>
<summary><strong>خطة spec-first (بدون تنفيذ)</strong> — `/plan` before code</summary>

When you want a reviewable markdown spec saved under `plans/` — implementation comes on a follow-up message.

**جرّب هذا الـ prompt:**

```
/plan Add a dark-mode toggle to the settings panel with persisted preference and a short README note
```

**متابعة (الرسالة التالية):**

```
Execute the plan you just wrote.
```

**Bundled skills:** `/plan` command + `/task-planning` (+ `/task-execution` on follow-up; `/artifact-delivery` for plan preview)

**الأدوات المتوقعة:** `read_file`, `grep`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>تقسيم طلب متعدد إلى todos</strong> — decompose before tool fan-out</summary>

When one message contains several deliverables — ordered todos before action.

**جرّب هذا الـ prompt:**

```
I need you to: (1) list top-level files in the workspace, (2) grep for TODO comments, (3) write a one-page summary markdown. Break this into todos first and show me the list before doing step 1.
```

**Bundled skills:** `/task-planning` (+ `/chart` if ≥4 steps; `/task-execution` after approval)

**الأدوات المتوقعة:** `todo_write`, `skill_view`

</details>

<details>
<summary><strong>تنفيذ خطة متعددة الخطوات</strong> — gated step-by-step run</summary>

When todos already exist and you said "go ahead" — full report at the end.

**جرّب هذا الـ prompt:**

```
Execute the plan you just wrote. Stop if a step fails and give me a partial report.
```

**Bundled skills:** `/task-execution` (+ `/task-planning` if no plan; `/systematic-debugging` on failure; `/artifact-delivery` for report)

**الأدوات المتوقعة:** `todo_write`, `read_file`, `write_file`, `grep`, `artifact_present`

</details>

---

<a id="playbook-automation"></a>

## الأتمتة

<details>
<summary><strong>Digest يومي مع تبويب مفتوح</strong> — heartbeat cron, not host crontab</summary>

When you want a recurring job while the app tab stays open — digests, reminders, periodic search.

**جرّب هذا الـ prompt:**

```
Register a daily heartbeat job at 9:00 AM (my timezone) that web_searches "AI agent browser news", fetches the top 2 results, and appends a 5-bullet digest to work/digests/daily.md. List the job with cron_list when done.
```

**Bundled skills:** `/heartbeat-cron` (+ `/browser-runtime-map` for step tools; `/artifact-delivery` for delivery options)

**الأدوات المتوقعة:** `cron_register`, `cron_list`, `web_search`, `web_fetch`, `write_file`

</details>

---

<a id="playbook-workspace"></a>

## مساحة العمل والملفات

<details>
<summary><strong>تهيئة مجلد مشروع جانبي</strong> — scaffold before writes</summary>

When starting a new app, demo, or spike — isolated folder under `projects/` or `work/`.

**جرّب هذا الـ prompt:**

```
Create projects/expense-tracker/ with a minimal README, package.json stub, and src/ folder. Show me the tree when done.
```

**Bundled skills:** `/project-scaffold`

**الأدوات المتوقعة:** `make_dir`, `write_file`, `tree`

</details>

<details>
<summary><strong>إعادة تنظيم ملفات بأمان</strong> — checkpoint mindset before moves</summary>

When cleaning up uploads or old drafts — list and verify before bulk moves or deletes.

**جرّب هذا الـ prompt:**

```
List everything under uploads/ and work/. Propose a safe reorganization (moves only, no deletes yet) and explain what you'd checkpoint first.
```

**Bundled skills:** `/workspace-safety`, `/browser-runtime-map`

**الأدوات المتوقعة:** `list_dir`, `find_files`, `move_file`, `tree`

</details>

---

<a id="playbook-debug"></a>

## التصحيح والموثوقية

<details>
<summary><strong>تصحيح بالفرضيات</strong> — reproduce before random edits</summary>

When something fails, flakes, or regresses — structured diagnosis, not guess-and-patch.

**جرّب هذا الـ prompt:**

```
The chat input stops accepting paste after I upload an image. Form one hypothesis, name the smallest read-only checks you'd run first (grep/read_file), and only then suggest a fix.
```

**Bundled skills:** `/systematic-debugging`

**الأدوات المتوقعة:** `read_file`, `grep`, `file_diff`, `run_shell`

</details>

<details>
<summary><strong>فشل shell / npx في WebContainer</strong> — pick the right tool</summary>

When `curl`, `git clone`, or `npx` fails — use file and HTTP tools instead of host shell.

**جرّب هذا الـ prompt:**

```
run_shell failed with "command not found" when I asked you to curl an API. Fetch the same URL with web_fetch instead and explain what works in this browser runtime vs what doesn't.
```

**Bundled skills:** `/browser-runtime-map`

**الأدوات المتوقعة:** `read_file`, `web_fetch`, `grep`

</details>

---

<a id="playbook-multimodal"></a>

## متعدد الوسائط

<details>
<summary><strong>قراءة لقطة شاشة أو مخطط</strong> — vision before reasoning</summary>

When the input is an image path in the workspace or an upload — OCR, UI state, architecture diagrams.

**جرّب هذا الـ prompt:**

```
I uploaded a screenshot to uploads/. Analyze it with vision: list every visible error message and button label verbatim, then save work/notes/screenshot-audit.md.
```

**Bundled skills:** `/multimodal-ingest`

**الأدوات المتوقعة:** `vision_analyze`, `write_file`

</details>

<details>
<summary><strong>تلخيص tutorial على YouTube</strong> — transcript-first</summary>

When you paste a YouTube link — full transcript with timestamps before summarizing.

**جرّب هذا الـ prompt:**

```
Summarize this tutorial: https://www.youtube.com/watch?v=dQw4w9WgXcQ
Pull the transcript, extract 8 timestamped takeaways, and present a short markdown report.
```

**Bundled skills:** `/multimodal-ingest` (+ `/artifact-delivery` for preview)

**الأدوات المتوقعة:** `youtube_transcribe`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-delivery"></a>

## التسليم والتواصل

<details>
<summary><strong>عرض تقرير داخل التطبيق</strong> — View popup, not inline dump</summary>

When the deliverable is markdown or a file — use the artifact bar for preview/download.

**جرّب هذا الـ prompt:**

```
Write a one-page weekly status report to work/reports/week.md (Goals / Done / Blockers / Next) and present it with artifact_present — don't paste the full body in chat.
```

**Bundled skills:** `/artifact-delivery`

**الأدوات المتوقعة:** `write_file`, `artifact_present`

</details>

<details>
<summary><strong>إرسال deliverable بالبريد</strong> — outbound via Resend when configured</summary>

When you need the report emailed — requires Resend configured in settings.

**جرّب هذا الـ prompt:**

```
Draft work/reports/summary.md with a 5-bullet project update, present it, and if email is configured send it to my address with subject "Weekly update".
```

**Bundled skills:** `/artifact-delivery` (+ `/credential-hygiene` if keys mentioned)

**الأدوات المتوقعة:** `write_file`, `email`, `artifact_present`

</details>

<details>
<summary><strong>مخطط انسيابي للخطة أو التقرير</strong> — Mermaid via artifact preview</summary>

When a diagram clarifies steps, flows, or architecture — GitHub-style Mermaid in artifact view.

**جرّب هذا الـ prompt:**

```
Draw a Mermaid flowchart of my morning routine automation (wake → digest → todo review → deep work) and present it so I can view the diagram in the artifact popup.
```

**Bundled skills:** `/chart` (+ `/artifact-delivery`)

**الأدوات المتوقعة:** `artifact_present`

</details>

---

<a id="playbook-ux"></a>

## تجربة المستخدم

<details>
<summary><strong>توضيح طلب غامض</strong> — structured choices, no guessing</summary>

When intent is ambiguous — one clarification block with options in the UI.

**جرّب هذا الـ prompt:**

```
Help me organize my stuff.
```

أو صراحةً:

```
/clarify I want to improve my workflow but I'm not sure where to start
```

**Bundled skills:** `/clarify`

**الأدوات المتوقعة:** *(none — emits `<<<CLARIFY>>>` block)*

</details>

---

<a id="playbook-safety"></a>

## الأمان والنظافة

<details>
<summary><strong>Checkpoint قبل حذف جماعي</strong> — list and stat before destructive ops</summary>

When you want cleanup — export or list scope before `delete_file` or wide refactors.

**جرّب هذا الـ prompt:**

```
I want to delete everything under work/scratch/. List what's there with sizes, confirm nothing outside that tree would be touched, then delete only if the list matches my intent.
```

**Bundled skills:** `/workspace-safety`

**الأدوات المتوقعة:** `list_dir`, `file_stat`, `delete_file`

</details>

<details>
<summary><strong>مفتاح API ملصوق / hygiene</strong> — redact, never persist secrets</summary>

When you accidentally paste a key or ask to store secrets — rotate guidance, no `memory_save` for raw tokens.

**جرّب هذا الـ prompt:**

```
I pasted this by mistake: sk-test-1234567890abcdef — redact it from your reply, tell me what you will NOT store, and how to rotate safely.
```

**Bundled skills:** `/credential-hygiene`

**الأدوات المتوقعة:** *(redaction guidance; avoid `memory_save` for secrets)*

</details>

---

## وثائق ذات صلة

- [test-prompts.md](test-prompts.md) — مطالبات humo للمساهمين
- [README.ar.md](../../README.ar.md) — نظرة عامة والأدوات
- [CAPABILITIES.md](CAPABILITIES.md) — إضافة skills وقدرات
