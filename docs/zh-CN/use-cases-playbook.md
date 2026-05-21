<!-- i18n-sync: en@73a242b 2026-05-21 -->

**语言：** [English](../use-cases-playbook.md) · [简体中文](use-cases-playbook.md) · [Español](../es/use-cases-playbook.md) · [العربية](../ar/use-cases-playbook.md)

# 个人助手场景手册

25 个可复制场景，帮你在 Web Agent 里完成实际工作。每条对应 bundled 技能及其工具契约。提示词保持英文——请原样粘贴到聊天框。

**按类别筛选：** [研究](#playbook-research) · [记忆](#playbook-memory) · [规划](#playbook-planning) · [自动化](#playbook-automation) · [工作区](#playbook-workspace) · [调试](#playbook-debug) · [多模态](#playbook-multimodal) · [交付](#playbook-delivery) · [体验](#playbook-ux) · [安全](#playbook-safety) · [元](#playbook-meta)

## 快速索引

| 类别 | 场景 | Bundled skill(s) | Key tools |
| --- | --- | --- | --- |
| 研究 | 发现细分创作者 / 竞品 | `/open-web-research` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| 研究 | 学术论文 / 引用检索 | `/research-pack` | `web_search`, `web_fetch`, `write_file`, `artifact_present` |
| 研究 | 从页面提取表格或 JSON | `/structured-extraction` | `web_fetch`, `write_file`, `artifact_present` |
| 元 | 在线发现可安装技能 | `/find_skills` | `web_search`, `web_fetch`, `skill_manage` |
| 记忆 | 保存持久偏好 | `/memory-layers` | `memory_save`, `memory_recall` |
| 记忆 | 记录滚动会话上下文 | `/memory-layers` | `session_memory_append`, `session_memory_list` |
| 记忆 | 同步到 Obsidian 风格知识库 | `/memory-layers` | `wiki_setup`, `wiki_sync`, `wiki_search` |
| 记忆 | 从旧对话中查找 | `/memory-layers` | `session_search` |
| 规划 | 先写规格再实现（暂不执行） | `/plan`, `/task-planning` | `read_file`, `grep`, `write_file`, `artifact_present` |
| 规划 | 拆解多步请求为 todos | `/task-planning` | `todo_write`, `skill_view` |
| 规划 | 执行已批准的多步计划 | `/task-execution` | `todo_write`, `read_file`, `write_file`, `artifact_present` |
| 自动化 | 标签页打开时的每日摘要 | `/heartbeat-cron` | `cron_register`, `cron_list`, `web_search`, `web_fetch` |
| 工作区 | 新建副项目目录 | `/project-scaffold` | `make_dir`, `write_file`, `tree` |
| 工作区 | 安全整理文件 | `/workspace-safety`, `/browser-runtime-map` | `list_dir`, `find_files`, `move_file`, `tree` |
| 调试 | 假设驱动的排错 | `/systematic-debugging` | `read_file`, `grep`, `file_diff`, `run_shell` |
| 调试 | Shell / `npx` failed in WebContainer | `/browser-runtime-map` | `read_file`, `web_fetch`, `grep` |
| 多模态 | 解读截图或图表 | `/multimodal-ingest` | `vision_analyze`, `write_file` |
| 多模态 | 总结 YouTube 教程 | `/multimodal-ingest` | `youtube_transcribe`, `write_file`, `artifact_present` |
| 交付 | 在应用内展示报告 | `/artifact-delivery` | `write_file`, `artifact_present` |
| 交付 | 邮件发送交付物 | `/artifact-delivery` | `write_file`, `email`, `artifact_present` |
| 交付 | 计划或报告的流程图 | `/chart` | `artifact_present` |
| 体验 | 澄清模糊需求 | `/clarify` | *(none)* |
| 安全 | 批量删除前检查点 | `/workspace-safety` | `list_dir`, `file_stat`, `delete_file` |
| 安全 | 粘贴 API 密钥 / 密钥卫生 | `/credential-hygiene` | *(redaction; no secret persistence)* |
| 元 | 改进 Web Agent 本身 | `/web-agent-skill` | `read_file`, `grep`, `skill_manage`, `memory_save` |

---

<a id="playbook-research"></a>

## 研究与发现

<details>
<summary><strong>发现细分创作者 / 竞品</strong> — open-web discovery with verified fetches</summary>

需要某 niche 下的人、频道或公司短名单时——不是学术论文。

**试试这条提示词：**

```
Find 8 YouTube creators in the UAE who regularly post about AI agents or coding assistants.
Verify channel pages with fetches, label each as confirmed/likely/not regional, and save a markdown table under work/research/uae-creators.md — then show it to me.
```

**Bundled 技能：** `/open-web-research` (+ `/clarify` if scope unclear; `/structured-extraction` for row shaping; `/artifact-delivery` for preview)

**会触发的工具：** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>学术论文 / 引用检索</strong> — arXiv and Semantic Scholar paths</summary>

需要论文、引用或迷你文献综述时——不是一般创作者发现。

**试试这条提示词：**

```
Find 5 recent arXiv papers (2024–2026) on retrieval-augmented generation for code assistants.
Summarize each in 3 bullets, include PDF links, and save work/research/rag-code-assistants.md with a references section.
```

**Bundled 技能：** `/research-pack` (+ `/artifact-delivery` for preview)

**会触发的工具：** `web_search`, `web_fetch`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>从页面提取表格或 JSON</strong> — fetch, parse, normalize</summary>

网页上有你要变成 CSV 或 JSON 的行时——不是叙述性摘要。

**试试这条提示词：**

```
Fetch https://example.com/pricing (or any public pricing page I paste next) and extract plan name, price, and key limits into a deduped JSON array.
Save work/extract/pricing.json and show me a preview table.
```

**Bundled 技能：** `/structured-extraction` (+ `/artifact-delivery` for preview)

**会触发的工具：** `web_fetch`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-meta"></a>

## 元

<details>
<summary><strong>在线发现可安装技能</strong> — registry search and install path</summary>

安装前想从在线 registry 找社区技能时。

**试试这条提示词：**

```
/find_skills markdown wiki knowledge base
Search skills.sh, SkillsMP, and Cursor marketplace — return the top 5 by installs or stars with links. Do not install yet; just rank them.
```

**Bundled 技能：** `/find_skills` (+ `/clarify` if query ambiguous; `/web-agent-skill` if installing)

**会触发的工具：** `web_search`, `web_fetch`, `skill_manage`

</details>

<details>
<summary><strong>改进 Web Agent 本身</strong> — safe self-evolution in this repo</summary>

在改 Web Agent 运行时、技能或能力时——不是工作区里的一般应用工作。

**试试这条提示词：**

```
Read how bundled skills are indexed in src/agent/runtime/memory/skills.ts and suggest one surgical improvement to the skills context block. Do not edit bundled SKILL.md files — propose a patch plan only.
```

**Bundled 技能：** `/web-agent-skill` (+ `/memory-layers` for where to store lessons)

**会触发的工具：** `read_file`, `grep`, `skill_manage`, `memory_save`

</details>

---

<a id="playbook-memory"></a>

## 记忆与知识

<details>
<summary><strong>保存持久偏好</strong> — facts that survive reloads</summary>

偏好应跨会话持久时——不是一次性会话笔记。

**试试这条提示词：**

```
Remember this for future turns: my default formatter is Prettier with semi: true and singleQuote: false.
Tell me exactly what key you stored and how I can verify it next session.
```

**Bundled 技能：** `/memory-layers`

**会触发的工具：** `memory_save`, `memory_recall`

</details>

<details>
<summary><strong>记录滚动会话上下文</strong> — lightweight in-session notes</summary>

想记录本次对话中的决策或状态时——不是永久事实。

**试试这条提示词：**

```
We're exploring option B for the dashboard layout. Append a short session note with that decision and what we ruled out — I don't need this as a permanent fact yet.
```

**Bundled 技能：** `/memory-layers`

**会触发的工具：** `session_memory_append`, `session_memory_list`

</details>

<details>
<summary><strong>同步到 Obsidian 风格知识库</strong> — PARA markdown for humans</summary>

想要可从运行时记忆同步、可浏览的 wiki 文件时——默认 vault 在 `.webagent/knowledge-vault/`。

**试试这条提示词：**

```
/wiki_setup
/wiki_sync all
/wiki_search deployment
Show me what landed in the vault index and one snippet from search.
```

**Bundled 技能：** `/memory-layers`

**会触发的工具：** `wiki_setup`, `wiki_sync`, `wiki_search`

</details>

<details>
<summary><strong>从旧对话中查找</strong> — search archived sessions</summary>

记得讨论过某事但不知哪次会话时——在历史中关键词搜索。

**试试这条提示词：**

```
Search my past conversations for mentions of "Prettier" or "formatter" and quote the most relevant snippet with the session date if available.
```

**Bundled 技能：** `/memory-layers`

**会触发的工具：** `session_search`

</details>

---

<a id="playbook-planning"></a>

## 规划与执行

<details>
<summary><strong>先写规格再实现（暂不执行）</strong> — `/plan` before code</summary>

想要可审阅的 markdown 规格保存在 `plans/` 下时——实现放在后续消息。

**试试这条提示词：**

```
/plan Add a dark-mode toggle to the settings panel with persisted preference and a short README note
```

**后续（下一条消息）：**

```
Execute the plan you just wrote.
```

**Bundled 技能：** `/plan` command + `/task-planning` (+ `/task-execution` on follow-up; `/artifact-delivery` for plan preview)

**会触发的工具：** `read_file`, `grep`, `write_file`, `artifact_present`

</details>

<details>
<summary><strong>拆解多步请求为 todos</strong> — decompose before tool fan-out</summary>

一条消息含多个交付物时——先有序 todos 再行动。

**试试这条提示词：**

```
I need you to: (1) list top-level files in the workspace, (2) grep for TODO comments, (3) write a one-page summary markdown. Break this into todos first and show me the list before doing step 1.
```

**Bundled 技能：** `/task-planning` (+ `/chart` if ≥4 steps; `/task-execution` after approval)

**会触发的工具：** `todo_write`, `skill_view`

</details>

<details>
<summary><strong>执行已批准的多步计划</strong> — gated step-by-step run</summary>

已有 todos 且你说「继续」时——最后给出完整报告。

**试试这条提示词：**

```
Execute the plan you just wrote. Stop if a step fails and give me a partial report.
```

**Bundled 技能：** `/task-execution` (+ `/task-planning` if no plan; `/systematic-debugging` on failure; `/artifact-delivery` for report)

**会触发的工具：** `todo_write`, `read_file`, `write_file`, `grep`, `artifact_present`

</details>

---

<a id="playbook-automation"></a>

## 自动化

<details>
<summary><strong>标签页打开时的每日摘要</strong> — heartbeat cron, not host crontab</summary>

应用标签页保持打开时需要 recurring 任务时——摘要、提醒、周期搜索。

**试试这条提示词：**

```
Register a daily heartbeat job at 9:00 AM (my timezone) that web_searches "AI agent browser news", fetches the top 2 results, and appends a 5-bullet digest to work/digests/daily.md. List the job with cron_list when done.
```

**Bundled 技能：** `/heartbeat-cron` (+ `/browser-runtime-map` for step tools; `/artifact-delivery` for delivery options)

**会触发的工具：** `cron_register`, `cron_list`, `web_search`, `web_fetch`, `write_file`

</details>

---

<a id="playbook-workspace"></a>

## 工作区与文件

<details>
<summary><strong>新建副项目目录</strong> — scaffold before writes</summary>

启动新 app、demo 或 spike 时——在 `projects/` 或 `work/` 下隔离文件夹。

**试试这条提示词：**

```
Create projects/expense-tracker/ with a minimal README, package.json stub, and src/ folder. Show me the tree when done.
```

**Bundled 技能：** `/project-scaffold`

**会触发的工具：** `make_dir`, `write_file`, `tree`

</details>

<details>
<summary><strong>安全整理文件</strong> — checkpoint mindset before moves</summary>

清理 uploads 或旧草稿时——批量移动或删除前列表并确认。

**试试这条提示词：**

```
List everything under uploads/ and work/. Propose a safe reorganization (moves only, no deletes yet) and explain what you'd checkpoint first.
```

**Bundled 技能：** `/workspace-safety`, `/browser-runtime-map`

**会触发的工具：** `list_dir`, `find_files`, `move_file`, `tree`

</details>

---

<a id="playbook-debug"></a>

## 调试与可靠性

<details>
<summary><strong>假设驱动的排错</strong> — reproduce before random edits</summary>

失败、 flaky 或回归时——结构化诊断，不是乱改。

**试试这条提示词：**

```
The chat input stops accepting paste after I upload an image. Form one hypothesis, name the smallest read-only checks you'd run first (grep/read_file), and only then suggest a fix.
```

**Bundled 技能：** `/systematic-debugging`

**会触发的工具：** `read_file`, `grep`, `file_diff`, `run_shell`

</details>

<details>
<summary><strong>WebContainer 中 shell / npx 失败</strong> — pick the right tool</summary>

当 `curl`、`git clone` 或 `npx` 失败时——用文件与 HTTP 工具代替 host shell。

**试试这条提示词：**

```
run_shell failed with "command not found" when I asked you to curl an API. Fetch the same URL with web_fetch instead and explain what works in this browser runtime vs what doesn't.
```

**Bundled 技能：** `/browser-runtime-map`

**会触发的工具：** `read_file`, `web_fetch`, `grep`

</details>

---

<a id="playbook-multimodal"></a>

## 多模态

<details>
<summary><strong>解读截图或图表</strong> — vision before reasoning</summary>

输入是工作区图片路径或上传时——OCR、UI 状态、架构图。

**试试这条提示词：**

```
I uploaded a screenshot to uploads/. Analyze it with vision: list every visible error message and button label verbatim, then save work/notes/screenshot-audit.md.
```

**Bundled 技能：** `/multimodal-ingest`

**会触发的工具：** `vision_analyze`, `write_file`

</details>

<details>
<summary><strong>总结 YouTube 教程</strong> — transcript-first</summary>

粘贴 YouTube 链接时——先带时间戳的完整 transcript 再总结。

**试试这条提示词：**

```
Summarize this tutorial: https://www.youtube.com/watch?v=dQw4w9WgXcQ
Pull the transcript, extract 8 timestamped takeaways, and present a short markdown report.
```

**Bundled 技能：** `/multimodal-ingest` (+ `/artifact-delivery` for preview)

**会触发的工具：** `youtube_transcribe`, `write_file`, `artifact_present`

</details>

---

<a id="playbook-delivery"></a>

## 交付与沟通

<details>
<summary><strong>在应用内展示报告</strong> — View popup, not inline dump</summary>

交付物是 markdown 或文件时——用 artifact 栏预览/下载。

**试试这条提示词：**

```
Write a one-page weekly status report to work/reports/week.md (Goals / Done / Blockers / Next) and present it with artifact_present — don't paste the full body in chat.
```

**Bundled 技能：** `/artifact-delivery`

**会触发的工具：** `write_file`, `artifact_present`

</details>

<details>
<summary><strong>邮件发送交付物</strong> — outbound via Resend when configured</summary>

需要邮件发送报告时——需在设置中配置 Resend。

**试试这条提示词：**

```
Draft work/reports/summary.md with a 5-bullet project update, present it, and if email is configured send it to my address with subject "Weekly update".
```

**Bundled 技能：** `/artifact-delivery` (+ `/credential-hygiene` if keys mentioned)

**会触发的工具：** `write_file`, `email`, `artifact_present`

</details>

<details>
<summary><strong>计划或报告的流程图</strong> — Mermaid via artifact preview</summary>

图表能澄清步骤、流程或架构时——在 artifact 视图中用 GitHub 风格 Mermaid。

**试试这条提示词：**

```
Draw a Mermaid flowchart of my morning routine automation (wake → digest → todo review → deep work) and present it so I can view the diagram in the artifact popup.
```

**Bundled 技能：** `/chart` (+ `/artifact-delivery`)

**会触发的工具：** `artifact_present`

</details>

---

<a id="playbook-ux"></a>

## 用户体验

<details>
<summary><strong>澄清模糊需求</strong> — structured choices, no guessing</summary>

意图模糊时——在 UI 中一个带选项的澄清块。

**试试这条提示词：**

```
Help me organize my stuff.
```

或显式使用：

```
/clarify I want to improve my workflow but I'm not sure where to start
```

**Bundled 技能：** `/clarify`

**会触发的工具：** *(none — emits `<<<CLARIFY>>>` block)*

</details>

---

<a id="playbook-safety"></a>

## 安全与卫生

<details>
<summary><strong>批量删除前检查点</strong> — list and stat before destructive ops</summary>

想清理时——在 `delete_file` 或大范围重构前列出范围。

**试试这条提示词：**

```
I want to delete everything under work/scratch/. List what's there with sizes, confirm nothing outside that tree would be touched, then delete only if the list matches my intent.
```

**Bundled 技能：** `/workspace-safety`

**会触发的工具：** `list_dir`, `file_stat`, `delete_file`

</details>

<details>
<summary><strong>粘贴 API 密钥 / 密钥卫生</strong> — redact, never persist secrets</summary>

误粘贴密钥或要求存 secret 时——轮换指引，勿用 `memory_save` 存原始 token。

**试试这条提示词：**

```
I pasted this by mistake: sk-test-1234567890abcdef — redact it from your reply, tell me what you will NOT store, and how to rotate safely.
```

**Bundled 技能：** `/credential-hygiene`

**会触发的工具：** *(redaction guidance; avoid `memory_save` for secrets)*

</details>

---

## 相关文档

- [test-prompts.md](test-prompts.md) — 贡献者冒烟提示词
- [README.zh-CN.md](../../README.zh-CN.md) — 产品概览与工具目录
- [CAPABILITIES.md](CAPABILITIES.md) — 添加技能与能力
