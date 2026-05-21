![Web Agent](public/images/preview.webp)

<div align="center">

# Web Agent

**浏览器原生 AI 代理：隔离工作区、持久记忆、零安装摩擦。**

[在线演示](https://webagent.aratech.ae) · [GitHub](https://github.com/nikola66/web-agent) · [Ko-fi 支持](http://ko-fi.com/nikola66) · [贡献指南](CONTRIBUTING.zh-CN.md) · [安全](SECURITY.zh-CN.md)

**语言：** [English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [العربية](README.ar.md)

</div>

<table>
  <tr>
    <td><img src="public/images/screenshot/Screenshot1.webp" alt="Web Agent screenshot 1" /></td>
    <td><img src="public/images/screenshot/Screenshot2.webp" alt="Web Agent screenshot 2" /></td>
    <td><img src="public/images/screenshot/Screenshot3.webp" alt="Web Agent screenshot 3" /></td>
    <td><img src="public/images/screenshot/Screenshot4.webp" alt="Web Agent screenshot 4" /></td>
    <td><img src="public/images/screenshot/Screenshot5.webp" alt="Web Agent screenshot 5" /></td>
  </tr>
</table>

<!-- i18n-sync: en@73a242b 2026-05-21 -->

Web Agent 是在 WebContainers 上直接在浏览器中运行的开源 AI 代理。终端用户无需安装：无 Docker、无 VPS、无 VM、无 Mac mini、无 Hostinger、无本地 Python 栈。打开应用、启动 profile 即可工作。

面向普通用户简单、面向高级用户强大：隔离 profile、浏览器本地持久化、工具、技能、会话、反思、学习、cron、**规划模式**（`/plan`）、**PARA + Obsidian 风格知识库**（`wiki_*` 工具与 `/wiki_*` 斜杠命令），以及留在用户机器上的自改进运行时。

## 目录

- [为什么选择 Web Agent](#为什么选择-web-agent)
- [亮点](#亮点)
- [能力概览](#能力概览)
- [斜杠命令](#斜杠命令)
- [设置与提供商](#设置与提供商)
- [工具](#工具)
- [技能](#技能)
- [工作区功能](#工作区功能)
- [持久化如何工作](#持久化如何工作)
- [入门预设](#入门预设)
- [个人助手场景手册](#个人助手场景手册)
- [快速开始](#快速开始)
- [开发](#开发)
- [架构一览](#架构一览)
- [隐私与安全](#隐私与安全)
- [开源](#开源)
- [支持与赞助](#支持与赞助)
- [贡献](#贡献)
- [许可证](#许可证)

## 为什么选择 Web Agent

- **点开即用**。终端用户浏览器启动，无需安装。
- **默认隔离**。每个 profile 独立工作区、记忆与运行时状态。
- **自学习**。技能、反思、学习、事实与会话记忆持续积累；复杂任务后 **Hermes 风格的后台回合审查** 可自动创建或修补技能；**curator** 在标签页打开时通过 heartbeat 整合 agent 创建的技能——全部留在浏览器本地。
- **本地优先持久化**。工作区、记忆、会话、技能存于浏览器存储，可导出/导入。
- **托管无服务端用户状态**。演示站只提供应用，文件与代理状态留在浏览器。
- **开源**。MIT 许可，可自由使用、分叉与修改。

## 亮点

- 基于 WebContainers 的浏览器原生 Node.js 运行时
- Isolated profiles with separate workspaces and memories
- Built-in tools for files, shell, search, fetch, memory, sessions, cron, skills, and **knowledge vault** (`wiki_setup`, `wiki_sync`, `wiki_search`)
- **`/plan` planning mode**: research the workspace, save a dated markdown plan under `plans/`, present it with `artifact_present`, then execute on a **follow-up** message
- **`/wiki_setup` · `/wiki_sync` · `/wiki_search`**: deterministic shortcuts that route to the wiki tools (default vault root: `.webagent/knowledge-vault/`)
- Persistent fact store, rolling session memory, reflections, and learnings
- **Hermes-style self-improvement**: post-turn background review (skill + memory capture on complex turns), skill provenance (`.webagent/skills/.usage.json`), and periodic curator consolidation while the app tab is open
- Uploads into the live workspace with image handoff to vision tools
- Encrypted API keys stored locally in the browser
- Export and import flows for long-lived browser-local workspaces
- Hosted demo for zero-friction trial usage
- **工具循环护栏**（默认开启）：Hermes 风格确定性检测每轮内重复工具失败与幂等无进展读取；通过 `VITE_WEBAGENT_TOOL_LOOP_*` 配置（见 [docs/zh-CN/agent-notes.md](docs/zh-CN/agent-notes.md)）

## 能力概览

Web Agent 不只是聊天框，而是浏览器原生代理运行时，三层协作：

- `⌨️ Slash commands` for fast operator control
- `🛠️ Tools` for concrete actions in the workspace and on the web
- `📚 Skills` for reusable procedures and higher-level behavior

```mermaid
flowchart TB
  subgraph input ["👤 You"]
    U["👤 Operator"]
  end
  subgraph steer ["🎯 How you steer"]
    C["⌨️ Slash commands"]
    P["💬 Natural language"]
  end
  subgraph runtime ["⚙️ Agent runtime"]
    S["📚 Skills"]
    T["🛠️ Tools"]
  end
  subgraph sinks ["📦 Where work lands"]
    W["📁 Workspace files"]
    M["🧠 Memory layers"]
    A["⏱️ Cron & automation"]
    R["🌐 Web & vision"]
  end
  U --> C
  U --> P
  C --> S
  P --> S
  S --> T
  T --> W
  T --> M
  T --> A
  T --> R
```

### Planning, wiki vault, and self-learning

These three loops sit beside the main capability diagram: **planning** produces reviewable specs before implementation; the **wiki** mirrors runtime memory into browseable markdown (Obsidian-friendly); **self-learning** ties facts, session notes, skills, reflections, and **autonomous post-turn review** together over time.

#### Planning (`/plan`)

```mermaid
flowchart TB
  subgraph plan ["📋 Planning mode · /plan"]
    direction TB
    P["📋 /plan + goal"] --> R["🔍 Read-only workspace research"]
    R --> W["✍️ write_file → plans/*.md"]
    W --> A["📄 artifact_present · view / download"]
    A --> N["⏸️ Stop — next turn: execute or revise"]
  end
```

#### Knowledge vault (`wiki_*` / `/wiki_*`)

```mermaid
flowchart TB
  subgraph scaffold ["🏗️ Scaffold once"]
    U["🧭 wiki_setup"] --> V["📂 PARA + KnowledgeVault"]
  end
  subgraph project ["🔄 Project runtime → vault"]
    M["🧠 memory_* · session_* · learnings"] --> S["🔁 wiki_sync"]
    V --> S
    S --> I["📑 index · log · ops"]
  end
  subgraph browse ["🔎 Browse & search"]
    Q["🔍 wiki_search"] --> V
  end
```

#### Self-learning loop

```mermaid
flowchart TB
  subgraph run ["🤖 Every turn"]
    X["🤖 Tools & conversation"]
    BR["💾 Post-turn background review"]
  end
  subgraph store ["🧠 What gets remembered"]
    F["💾 memory_* · durable facts"]
    SM["📝 session_memory_* · rolling notes"]
    SK["📚 skill_* · reusable SKILL.md"]
    RF["💡 reflections · promotable learnings"]
    U["📊 .usage.json · skill provenance"]
  end
  subgraph maintain ["🧹 Periodic maintenance"]
    C["🧹 Curator · consolidate & archive"]
  end
  subgraph mirror ["📓 Optional human mirror"]
    W2["📓 wiki_sync projection"]
  end
  X --> F
  X --> SM
  X --> SK
  X --> RF
  X -->|complex turn| BR
  BR --> SK
  BR --> F
  SK --> U
  U --> C
  C --> SK
  RF -.->|💡 hints| F
  RF -.->|💡 hints| SK
  F --> W2
  SM --> W2
```

**Every turn:** tool results feed facts, session notes, reflections, and learnings. Reflections and learnings surface as **hints** in later prompts (not automatic promotion).

**After complex turns** (todo/plan gates or high step count), a **post-turn background review** may run — non-blocking, after the user-visible reply — with restricted `skill_*` and `memory_*` tools. Defaults: skill review every **10 tool iterations** without a foreground skill write (`WEBAGENT_SKILL_REVIEW_INTERVAL`); memory review every **10 user turns** (`WEBAGENT_MEMORY_REVIEW_INTERVAL`). Terminal summary example: `Self-improvement review: Skill 'deploy-checklist' updated · Memory updated`.

**Skill provenance:** skills created in background review are tagged `created_by: agent` in `.webagent/skills/.usage.json` (usage counters, lifecycle state). **Curator** runs on heartbeat (~weekly while the tab is open): stale/archive idle agent-created skills, consolidate overlaps; pinned skills opt out; archives go to `.webagent/skills/.archive/` (no hard delete). Tune with `WEBAGENT_CURATOR_INTERVAL_MS`, `WEBAGENT_CURATOR_STALE_AFTER_DAYS`, `WEBAGENT_CURATOR_ARCHIVE_AFTER_DAYS`.

For choosing **facts vs session vs skills vs vault**, use the bundled **`/memory-layers`** skill.

### Quick Capability Map

| Area | What lives there | What it enables |
| --- | --- | --- |
| `⌨️ Commands` | Session controls like `/help`, `/compact`, `/plan`, `/checkpoint`, `/wiki_*` | Faster navigation, recovery, planning, vault ops, and operator control |
| `🛠️ Workspace tools` | Read, write, edit, diff, move, search, shell | Real work inside an isolated project workspace |
| `🧠 Memory tools` | Facts, session notes, conversation recall | Persistent context that improves continuity |
| `📓 Wiki tools` | `wiki_setup`, `wiki_sync`, `wiki_search` | PARA-shaped markdown vault and search when memory tools are not enough |
| `📋 Planning` | `/plan` + `write_file` into `plans/` + `artifact_present` | Spec-first workflows: plan now, implement on the next turn |
| `⏱️ Automation tools` | Heartbeat cron jobs and todos | Recurring tasks while the app is open |
| `🌐 Remote tools` | Search, fetch, email, vision, YouTube transcript | Web-aware and multimodal task execution |
| `📚 Skills` | Reusable `SKILL.md` procedures | Higher-level workflows; background review and curator maintain agent-created skills |

## 斜杠命令

These commands make the terminal experience feel like an operator console rather than a plain chatbot. They cover help, interruption, context compaction, **planning mode**, **wiki vault** shortcuts, checkpoint-based recovery, and direct skill invocation.

| Command | What it does |
| --- | --- |
| `/help` | Show built-in commands and available tools. |
| `/clear` | Clear conversation history for a fresh thread; keeps agent and user identity. |
| `/compact` | Summarize older context and keep the current thread going. |
| `/plan [goal]` | **Planning mode:** research the workspace with read-only tools, write the full plan markdown under `plans/`, present it via `artifact_present`, then **stop** — reply on the **next** turn with “execute the plan” (or edits) to implement. |
| `/find_skills [query]` | **Find-skills mode:** search online skill registries (skills.sh, SkillsMP, Cursor Marketplace, etc.) and return the top 5 skills by installs, stars, or votes. |
| `/clarify [topic]` | **Clarify mode:** emit one structured clarification block when intent is ambiguous — no tools; UI shows choice buttons. |
| `/checkpoint [name]` | Save a named snapshot of current history for rollback. |
| `/rollback [name]` | List checkpoints or restore a named checkpoint. |
| `/skills [search]` | List installed skills, or search skills by query. |
| `/wiki_setup [path]` | Initialize the PARA + wiki scaffold (`Projects/`, `Areas/`, `Resources/KnowledgeVault/…`, `Archives/`). Optional workspace-relative root; default **`.webagent/knowledge-vault`**. Workspaces that still use the old default vault folder **`knowledge-vault/`** are relocated automatically on the next wiki operation that omits `root_path`. |
| `/wiki_sync [scope] [path]` | Push runtime projections into the vault: **`facts`**, **`session`**, or **`all`** (includes learnings). Optional path after `scope`. Requires `wiki_setup` first. |
| `/wiki_search <query>` | Search markdown under the wiki vault (ranked hits + snippets). |
| `/<skill> [task]` | Invoke an installed skill for a task. |
| `/stop` | Interrupt the current run. |
| `/exit` | Exit the active terminal agent session. |

> `📌 Tip:` 使用 `/find_skills pdf`（或任意主题）在线发现热门技能，再用 `/skills install <url>` 安装。

> `📌 Tip:` Use `/skills` to discover capabilities, then jump straight into a workflow with `/<skill-slug> [task]`.

> `📌 Tip:` Natural-language asks like “set up my knowledge vault” or “sync facts to the wiki” map to the same **`wiki_*`** tools as the `/wiki_*` slash commands.

## 设置与提供商

Web Agent exposes provider configuration in two places: the profile editor for the active chat/model provider, and the Settings sidebar for browser-routed web tools and email delivery.

### Model Providers

Each profile can choose its own provider, optional model override, API key, and personality. Current built-in profile providers are:

| Provider | Type | Notes |
| --- | --- | --- |
| `OpenRouter` | Hosted model router | Default provider with broad model access through one key. |
| `Ollama (cloud)` | Hosted OpenAI-compatible provider | Uses Ollama's cloud API rather than a local daemon. |
| `Custom (OpenAI-compatible)` | Bring-your-own endpoint | Supports a custom base URL and API key for compatible `/v1` providers. |

### Browser Tool Providers

These power built-in web actions from the Settings panel:

| Provider | Powers | Notes |
| --- | --- | --- |
| `TinyFish` | `web_search`, `web_fetch` | Default browser-tool provider configured in Settings. |
| `Resend` | `email` | Used for outbound email with a verified sender address. |

### What You Can Configure

- `🧠 Per-profile model provider`: choose the model backend for each agent profile.
- `🔧 Model override`: set a specific model instead of the provider default.
- `🔐 Per-profile API key`: store credentials separately from other profiles.
- `🌐 Custom base URL`: point the custom provider at any OpenAI-compatible endpoint.
- `✉️ Email delivery`: add Resend credentials for digest or outbound mail flows.

## 工具

Web Agent ships with a broad native tool belt. The built-ins cover workspace manipulation, search, memory, automation, skill management, and browser-routed remote actions.

### Tool Groups

| Group | Includes | Best for |
| --- | --- | --- |
| `📁 Files & Workspace` | `read_file`, `write_file`, `edit_file`, `multi_edit`, `move_file`, `delete_file`, `tree`, `list_dir`, `find_files`, `grep`, `file_diff`, `file_stat`, `make_dir` | Building, editing, inspecting, and organizing project files |
| `🧠 Memory & Recall` | `memory_save`, `memory_recall`, `memory_search`, `session_memory_append`, `session_memory_list`, `session_search` | Long-lived facts, rolling notes, and recovering prior context |
| `📓 Knowledge wiki` | `wiki_setup`, `wiki_sync`, `wiki_search` | PARA + Obsidian-friendly vault under the workspace; project facts/session/learnings into markdown; full-text vault search |
| `📚 Skills` | `skill_list`, `skill_view`, `skill_save`, `skill_manage`, `skill_bulk_save`, `skill_delete`, `skill_recall` | Discovering, reading, creating, importing, and maintaining skills |
| `⏱️ Automation` | `cron_register`, `cron_list`, `todo_write` | Recurring jobs, heartbeat-driven workflows, and checklists |
| `🌐 Remote & Multimodal` | `web_search`, `web_fetch`, `vision_analyze`, `youtube_transcribe`, `email` | Research, fetching live content, image analysis, transcripts, and outbound delivery |
| `🖥️ System & Output` | `run_shell`, `system_info`, `artifact_present`, `apply_patch` | Executing commands, checking environment state, presenting artifacts, and surgical patching |

<details>
<summary><strong>🛠️ Full tool catalog</strong></summary>

| Tool | What it does |
| --- | --- |
| `🩹 apply_patch` | Apply unified patch operations for surgical file changes. |
| `🪄 artifact_present` | Present markdown to the browser host with view or download affordances. |
| `📋 cron_list` | List heartbeat cron jobs from `.webagent/cronjobs.json`. |
| `⏱️ cron_register` | Register recurring heartbeat jobs that run while the app tab is open. |
| `🗑️ delete_file` | Delete a file from the workspace. |
| `🛠️ edit_file` | Replace a matching snippet or fully replace file contents. |
| `✉️ email` | Send outbound email through Resend-configured delivery. |
| `🧾 file_diff` | Show a line-oriented diff between two UTF-8 workspace files. |
| `📌 file_stat` | Return filesystem metadata for a workspace path. |
| `🔎 find_files` | Find files by glob-like name patterns. |
| `🔍 grep` | Search file contents by text or regex. |
| `📁 list_dir` | List workspace files and directories with optional recursion and filtering. |
| `📂 make_dir` | Create directories recursively inside the workspace. |
| `🧠 memory_recall` | Recall a saved memory fact by exact key. |
| `💾 memory_save` | Save a durable memory fact under a stable key. |
| `🔮 memory_search` | Search saved memory facts by substring. |
| `📦 move_file` | Move or rename a workspace path. |
| `🛠️ multi_edit` | Apply multiple find-and-replace edits in one file. |
| `📄 read_file` | Read a UTF-8 file from the workspace. |
| `🖥️ run_shell` | Run a shell command in the workspace runtime. |
| `📝 session_memory_append` | Append a lightweight note to rolling session memory. |
| `🗂️ session_memory_list` | Read the newest entries from rolling session memory. |
| `📇 session_search` | Search archived workspace conversations by keywords. |
| `📚 skill_bulk_save` | Batch import or save multiple skills in one operation. |
| `🗑️ skill_delete` | Delete a saved skill from the workspace library. |
| `📋 skill_list` | Search and list saved skills. |
| `🧠 skill_manage` | Create, patch, edit, delete, import, or manage reusable skills. |
| `🔍 skill_recall` | Load a raw `SKILL.md` by name for backward compatibility. |
| `📚 skill_save` | Save a reusable `SKILL.md` procedure immediately. |
| `📖 skill_view` | Load a skill's full `SKILL.md` or an allowed support file. |
| `📟 system_info` | Return a safe system snapshot including time, timezone, uptime, and memory. |
| `✅ todo_write` | Create or update checklist-style todos. |
| `🌲 tree` | Render a bounded directory tree view. |
| `🖼️ vision_analyze` | Analyze an image with the configured vision model. |
| `🌐 web_fetch` | Fetch and summarize content from a URL. |
| `🔍 web_search` | Search the web and return ranked results. |
| `📓 wiki_search` | Search markdown files under the wiki vault root; ranked snippets when `memory_search` is not enough. |
| `📓 wiki_setup` | Create the PARA + `Resources/KnowledgeVault/` scaffold (idempotent). |
| `🔄 wiki_sync` | Update vault `index.md` / `log.md` and write `ops/wiki-sync-*.md` from facts, session tail, and/or learnings. |
| `✍️ write_file` | Write text to a file and create parent folders as needed. |
| `📹 youtube_transcribe` | Fetch a full YouTube transcript with timestamps. |

</details>

## 技能

Skills are reusable procedures stored as `SKILL.md` files. They let Web Agent switch from raw tool usage to structured workflows that can be invoked on demand.

### Bundled Skills

| Slash command | Name | What it is for | Tags |
| --- | --- | --- | --- |
| `/find_skills` | Find Skills | Search online skill registries and return the top 5 matches by installs, stars, or votes. | `skills`, `discovery`, `registry`, `marketplace`, `install` |
| `/clarify` | Clarify | Emit one structured clarification block when user intent is ambiguous, so the UI can present choices instead of guessing. | `ux`, `ambiguity`, `clarification`, `dialog` |
| `/project-scaffold` | Project Scaffold | Create an isolated workspace folder for a new app, demo, spike, sandbox, or test harness before file generation begins. | `project`, `scaffold`, `verification` |
| `/research-pack` | Research Pack | Run scholarly research workflows using existing web tools such as arXiv and Semantic Scholar paths. | `research`, `papers`, `citations`, `academic`, `arxiv`, `semantic-scholar` |
| `/systematic-debugging` | Systematic Debugging | Use a lightweight hypothesis-and-experiment loop for bugs and flaky behavior. | `debugging`, `reliability`, `investigation`, `science` |
| `/memory-layers` | Memory Layers | Pick the right layer among facts, session notes, skills, and wiki projections — avoid duplicate or contradictory stored context. | `memory`, `session`, `skills`, `facts`, `context` |
| `/web-agent-skill` | Web Agent Skill | Evolve Web Agent safely using its runtime, memory layers, cron, bundled skills, and repository truth. | `web-agent`, `self-evolution`, `maintenance`, `skills`, `memory`, `cron` |

Additional bundled skills appear under `/skills`; the table above highlights common starting points.

### Why Skills Matter

- `🧩 Reusable`: a good workflow only needs to be written once.
- `🛡️ Safer`: skills encode preferred patterns before the agent starts changing files.
- `⚡ Faster`: `/skill-slug [task]` is quicker than re-explaining a workflow every session.
- `🧠 Teachable`: users can grow the agent by saving new procedures directly into the workspace.
- `🔄 Self-improving`: after complex turns, background review can patch or create skills automatically; curator keeps the library consolidated over time.

### Wiki vs memory (short)

- **`memory_*` / `session_*`** hold the canonical structured context the runtime uses.
- **`wiki_sync`** projects summaries and sync markers into markdown for humans (or Obsidian); treat the vault as a **browseable mirror**, not a second source of truth, unless you intentionally archive prose there.

## 工作区功能

Every profile gets its own isolated workspace rooted in browser storage. The workspace layer is designed to feel like a lightweight project environment, not just an attachment bucket.

| Feature | What it means |
| --- | --- |
| `📁 Isolated per profile` | Each agent profile gets its own workspace and runtime state. |
| `💾 Persistent snapshots` | Files survive reloads using browser-side persistence. |
| `📤 Export / Import` | The Workspaces tab can export a profile snapshot to JSON and import it later. |
| `🖼️ Upload handoff` | Uploaded files land in the live workspace, including image paths for vision tools. |
| `🧰 File operations` | Read, write, edit, diff, move, delete, list, grep, and tree tools all operate inside the workspace. |
| `🖥️ Live shell access` | The runtime can execute supported workspace commands in the browser-native Node environment. |
| `📋 Saved plans` | `/plan` writes timestamped markdown under **`plans/`** (workspace-relative; legacy `.webagent/plans/` still readable). |
| `📓 Knowledge vault` | Default **`.webagent/knowledge-vault/`** PARA tree with **`Resources/KnowledgeVault/`** for wikilinks, logs, and ops detail files after `wiki_sync`. Older **`knowledge-vault/`** trees migrate automatically when you use default wiki paths. |
| `🧹 Clean reset` | Destroy a single profile workspace or nuke all local agent state from the sidebar. |
| `📊 Storage visibility` | The Workspaces tab shows browser storage usage and quota. |

### Workspace UX

- `Workspaces tab`: export, import, destroy, and inspect browser storage usage for the active profile.
- `Files popup`: browse the live `/workspace`, preview files, and interact with the working tree.
- `uploads/`: user-uploaded assets are normalized under `uploads/` for safe tool access.

## 持久化如何工作

Web Agent keeps user state in browser storage on the user’s machine. That includes workspaces, sessions, memory, facts, learnings, skills (including `.webagent/skills/.usage.json` provenance and `.archive/` for curator moves), todos, cron metadata, curator state under `.webagent/skills/.curator_state`, saved **`/plan`** markdown under **`plans/`** (legacy `.webagent/plans/` paths remain readable), wiki vault files under **`.webagent/knowledge-vault/`** by default (legacy **`knowledge-vault/`** at the workspace root is automatically moved there when wiki tools run without an explicit `root_path`), and local credentials. Nothing in that persistent agent state is meant to live on the server.

As long as the browser keeps its local storage and OPFS data, the agent keeps its history and workspace. When you want portability, export the workspace or browser-local state and import it later on the same machine or another one.

For hosted deployments, the safest framing is:

- **The app can be hosted anywhere**
- **The agent state lives in the browser**
- **The server should only deliver the app and relay allowed upstream requests when needed**

**Self-hosting (Railpack / Dokploy):** Use the repo `railpack.json` for `deploy.startCommand` (`scripts/start-with-proxy.sh`) and `deploy.aptPackages` (extends defaults with `caddy`). Do not add a `start` script in `package.json` for this: Railpack treats it as a custom start command, skips the built-in static+Caddy image path, and the sidecar setup breaks. The checked-in `Caddyfile` matches **Debian’s apt Caddy (~2.6)** (no `persist_config` or global `trusted_proxies` block). `web_fetch` / `web_search` without TinyFish rely on the small Node listener in `scripts/cors-proxy-server.mjs` (default `127.0.0.1:8799`).

## 入门预设

可复制起点。请按你的机器调整路径与密钥。

### 托管试用

1. Open [webagent.aratech.ae](https://webagent.aratech.ae).
2. Create or select a profile → add an API key from [OpenRouter](https://openrouter.ai) or [Ollama](https://ollama.com).
3. Click **Launch** → send a short task (e.g. “list files in the workspace”).

Recommended model on OpenRouter: **Gemma 4** (good speed, price, and tool calling). Any compatible model works.

### 本地开发

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
cp .env.example .env.local   # optional: tool guardrails, debug log, launch mode
npm run dev
```

Open `http://localhost:5173`. Tool guardrail env vars are documented in [.env.example](.env.example).

### 操作者工作流

**规划** — 先写规格，下一轮再实现：

```
/plan Add a /health route and document it in README
```

Review the plan under `plans/`, then on the **next** message:

```
Execute the plan you just wrote.
```

**知识库** — 记忆的 PARA markdown 镜像：

```
/wiki_setup
/wiki_sync all
/wiki_search deployment
```

Default vault root: `.webagent/knowledge-vault/`. Legacy `knowledge-vault/` at workspace root migrates automatically.

## 个人助手场景手册

25 个个人助手场景：可复制提示词、对应 bundled 技能与常用工具。完整示例卡片见 **[docs/zh-CN/use-cases-playbook.md](docs/zh-CN/use-cases-playbook.md)**。提示词为英文——请原样粘贴到聊天框。

**按类别筛选：** [研究](docs/zh-CN/use-cases-playbook.md#playbook-research) · [记忆](docs/zh-CN/use-cases-playbook.md#playbook-memory) · [规划](docs/zh-CN/use-cases-playbook.md#playbook-planning) · [自动化](docs/zh-CN/use-cases-playbook.md#playbook-automation) · [工作区](docs/zh-CN/use-cases-playbook.md#playbook-workspace) · [调试](docs/zh-CN/use-cases-playbook.md#playbook-debug) · [多模态](docs/zh-CN/use-cases-playbook.md#playbook-multimodal) · [交付](docs/zh-CN/use-cases-playbook.md#playbook-delivery) · [体验](docs/zh-CN/use-cases-playbook.md#playbook-ux) · [安全](docs/zh-CN/use-cases-playbook.md#playbook-safety) · [元](docs/zh-CN/use-cases-playbook.md#playbook-meta)

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
| 规划 | 先写规格再实现 | `/plan`, `/task-planning` | `read_file`, `grep`, `write_file`, `artifact_present` |
| 规划 | 拆解多步请求为 todos | `/task-planning` | `todo_write`, `skill_view` |
| 规划 | 执行已批准的多步计划 | `/task-execution` | `todo_write`, `read_file`, `write_file`, `artifact_present` |
| 自动化 | 标签页打开时的每日摘要 | `/heartbeat-cron` | `cron_register`, `cron_list`, `web_search`, `web_fetch` |
| 工作区 | 新建副项目目录 | `/project-scaffold` | `make_dir`, `write_file`, `tree` |
| 工作区 | 安全整理文件 | `/workspace-safety`, `/browser-runtime-map` | `list_dir`, `find_files`, `move_file`, `tree` |
| 调试 | 假设驱动的排错 | `/systematic-debugging` | `read_file`, `grep`, `file_diff`, `run_shell` |
| 调试 | WebContainer 中 shell / `npx` 失败 | `/browser-runtime-map` | `read_file`, `web_fetch`, `grep` |
| 多模态 | 解读截图或图表 | `/multimodal-ingest` | `vision_analyze`, `write_file` |
| 多模态 | 总结 YouTube 教程 | `/multimodal-ingest` | `youtube_transcribe`, `write_file`, `artifact_present` |
| 交付 | 在应用内展示报告 | `/artifact-delivery` | `write_file`, `artifact_present` |
| 交付 | 邮件发送交付物 | `/artifact-delivery` | `write_file`, `email`, `artifact_present` |
| 交付 | 计划或报告的流程图 | `/chart` | `artifact_present` |
| 体验 | 澄清模糊需求 | `/clarify` | *(none)* |
| 安全 | 批量删除前检查点 | `/workspace-safety` | `list_dir`, `file_stat`, `delete_file` |
| 安全 | 粘贴 API 密钥 / 密钥卫生 | `/credential-hygiene` | *(redaction; no secret persistence)* |
| 元 | 改进 Web Agent 本身 | `/web-agent-skill` | `read_file`, `grep`, `skill_manage`, `memory_save` |

## 快速开始

### 使用托管演示

Open [webagent.aratech.ae](https://webagent.aratech.ae), create or select a profile, add a free key from [OpenRouter.ai](https://openrouter.ai) or [Ollama](https://ollama.com), click **Launch**, and start chatting.

For Web Agent, `Gemma4` is the recommended model because it strikes a strong balance between speed, price, and tool-calling support, including images, audio, and video. You can choose any model you prefer.

### 本地运行

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
npm run dev
```

Open `http://localhost:5173`.

## 开发

```bash
npm run dev
npm run build
npm run test
npm run test:browser
```

贡献者文档：

- [docs/zh-CN/README.md](docs/zh-CN/README.md) — 文档索引
- [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)
- [docs/zh-CN/AGENTS.md](docs/zh-CN/AGENTS.md)
- [docs/zh-CN/CAPABILITIES.md](docs/zh-CN/CAPABILITIES.md)
- [docs/zh-CN/ARCHITECTURE.md](docs/zh-CN/ARCHITECTURE.md)
- [docs/zh-CN/agent-notes.md](docs/zh-CN/agent-notes.md)
- [docs/zh-CN/testing-checklist.md](docs/zh-CN/testing-checklist.md)
- [docs/GLOSSARY.md](docs/GLOSSARY.md) · [docs/TRANSLATING.md](docs/TRANSLATING.md)

## 架构一览

- **Frontend**: React + Vite + xterm.js
- **Runtime**: Node.js inside WebContainers
- **Persistence**: IndexedDB + OPFS in the browser
- **Isolation**: profile-scoped workspaces and runtime state
- **Model access**: OpenRouter or OpenAI-compatible providers
- **Plans & vault**: timestamped plans under `plans/` (legacy `.webagent/plans/` readable); optional PARA wiki tree (default `.webagent/knowledge-vault/`) synchronized via `wiki_*` tools
- **Tool loop guardrails**: per-turn deterministic detection of repeated tool failures and idempotent no-progress reads; thresholds in `.env.example`
- **Self-improvement loop**: post-turn background review + skill provenance + heartbeat curator (Hermes-inspired; see [Self-learning loop](#self-learning-loop))

The agent runtime is embedded into the browser app, mounted into a live workspace, and launched inside a terminal-backed Node environment. Profiles keep personalities, settings, workspace state, and memory separated.

## 隐私与安全

- Workspace files, sessions, memory, skills, and local credentials stay browser-side.
- API keys are stored locally and encrypted before persistence.
- Profiles are isolated from each other.
- Hosted mode should remain transit-only for upstream requests, not a persistence backend for user state.

报告与安全立场见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。

## 开源

Web Agent 是开源项目。 You are free to use it, fork it, modify it, and distribute it under the [MIT License](LICENSE).

Inspired by OpenClaw, [Hermes Agent](https://github.com/NousResearch/hermes-agent), and OpenCrabs.

Special thanks to the Nodebox used technology and the open source project behind it. It is beautiful software and made Web Agent possible.

## 支持与赞助

If Web Agent saves you time or helps your work, support ongoing development on [Ko-fi](http://ko-fi.com/nikola66). Sponsorship helps fund continued maintenance, new capabilities, UI polish, and long-term improvements.

<table>
  <tr>
    <td align="center"><a href="http://ko-fi.com/nikola66">Support on Ko-fi</a></td>
    <td align="center"><a href="https://github.com/nikola66/web-agent">Star on GitHub</a></td>
  </tr>
</table>

### Sponsor This Project

<table>
  <tr>
    <td align="center"><img src="public/logos/sponsor-placeholder.svg" width="180" alt="Sponsor placeholder" /><br />Sponsor project<br />Place logo here</td>
    <td align="center"><img src="public/logos/sponsor-placeholder.svg" width="180" alt="Sponsor placeholder" /><br />Sponsor project<br />Place logo here</td>
    <td align="center"><img src="public/logos/sponsor-placeholder.svg" width="180" alt="Sponsor placeholder" /><br />Sponsor project<br />Place logo here</td>
  </tr>
</table>

## 贡献

欢迎 issue 与 PR。请先阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)，保持改动精准，并维护浏览器原生、本地优先设计。

## 许可证

MIT。见 [LICENSE](LICENSE)。

> 完整工具目录、斜杠命令表与能力图见 [英文 README](README.md)。
