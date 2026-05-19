# 架构

**语言：** [English](ARCHITECTURE.md) · [Español](ARCHITECTURE.es.md) · [简体中文](ARCHITECTURE.zh-CN.md) · [Deutsch](ARCHITECTURE.de.md)

`web-agent` 高层结构说明。更新于 2026-05-19。

## 目录

- [分层](#分层)
- [运行时边界](#运行时边界)
- [存储层](#存储层)
- [Agent 循环](#agent-循环)
- [工具注册](#工具注册)
- [构建流水线](#构建流水线)
- [从哪里入手](#从哪里入手)

## 分层

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite + Tailwind)                        │
│  ─────────────────────────────────────────────────────────── │
│  src/App.tsx ─ src/ui/components/{Terminal, ChatInput,       │
│                Sidebar, FilesPopup, MemoryTab, ProfileEditor}│
│  src/ui/stores/{runtime, profile, settings}-store  (Zustand) │
│                              │                                │
│                              ▼                                │
│  src/core/orchestrator.ts   ─ lifecycle, terminal, storage   │
│  src/core/workspace.ts      ─ WebContainer FS / shell        │
│  src/core/persistence.ts    ─ idb-keyval + OPFS              │
│  src/core/credential-vault  ─ AES-GCM encrypted API keys     │
│                              │                                │
│                              ▼                                │
│  src/agent/adapter.ts       ─ spawns embedded agent runtime  │
│                                in Nodebox / WebContainer     │
│                              │   stdout/stdin IPC markers    │
│                              ▼                                │
│  src/agent/runtime/         ─ Node-style agent (excluded     │
│    ├─ turn.ts                 from tsc; built via            │
│    ├─ tools/registry.ts       scripts/build-embed-runtime)   │
│    ├─ llm/streaming.ts                                       │
│    ├─ memory/* (sql.js)                                      │
│    └─ logging, channels, ...                                 │
│                              │                                │
│                              ▼                                │
│  HTTPS to LLM provider (OpenRouter / Ollama / custom)        │
│  via /api/llm/<provider> reverse proxy (vite.config.ts)      │
└──────────────────────────────────────────────────────────────┘
```

## 运行时边界

「Agent」在浏览器标签页内的 Nodebox/WebContainer 沙箱中运行，而非服务器。`src/agent/adapter.ts` 以类 Node 进程启动它，并通过 stdout/stdin 通信。

### IPC 标记协议

嵌入式运行时无法直接 `fetch`（CORS / 无 origin）。HTTP 请求通过 stdout 写入帧标记：

```
<<<WEBAGENT_PROXY_REQ:<id>>>{"method":"POST","url":"…","headers":{…},"body":"…"}<<<END_WEBAGENT_PROXY_REQ>>>
```

`adapter.ts` 解析这些标记（约第 ~834–900 行），经 `/api/proxy` 路由（开发：`vite.config.ts`；生产：`scripts/cors-proxy-server.mjs` 或 Caddy），再将响应写回 stdin：

```
<<<WEBAGENT_PROXY_RESP:<id>>>{"status":200,"body":"…"}<<<END_WEBAGENT_PROXY_RESP>>>
```

LLM 流式响应使用相同帧格式（`src/agent/runtime/llm/streaming.ts` 中的 `ipcProxyStreamRequest`）。

## 存储层

| 层            | 后端           | 版本化                | 用途                                   |
|---------------|----------------|-----------------------|----------------------------------------|
| Profiles      | idb-keyval     | envelope `{version,…}`| Profile CRUD (`src/core/profiles.ts`)  |
| Credentials   | idb-keyval     | key-based             | PBKDF2 + AES-GCM API 密钥              |
| Settings (UI) | idb-keyval     | none                  | 侧栏宽度、主题等                       |
| Workspace files| OPFS          | none                  | WebContainer 文件系统                  |
| Agent memory  | sql.js (WASM)  | column-add migrations | facts、learnings、jobs、snapshots      |
| Debug log     | OPFS JSONL     | none                  | 工具调用、错误                         |

## Agent 循环

1. `src/core/orchestrator.ts` 启动 profile → `adapter.ts` 拉起 runtime。
2. 用户输入 → `src/agent/runtime/turn.ts:agentTurn()`。
3. `streamOpenAI()` 发起请求（直连 HTTP 或 IPC 帧）。
4. 解析流式块 → 提取 tool calls。
5. `runTools()`（registry.ts）执行内置或 capability 工具。
6. 结果超过 10 KB → 写入工作区文件（内联上限 `MAX_TOOL_RESULT_INLINE_CHARS`）。
7. **Turn judge** 侧车（[`server/turn-judge`](../server/turn-judge)）从 [`models/turn-judge/`](../models/turn-judge/) 加载 ONNX，分类 `continue` / `stop` / `ask_user`。浏览器调用同源 `POST /api/turn-judge`（Vite 或 Caddy → `127.0.0.1:8787/judge`）。`WEBAGENT_TURN_JUDGE=0` 可禁用。不可达或低置信度时 `turn.ts` 保守地 `stop`。部署见 [turn-judge.md](turn-judge.md)。
8. 每轮最多 64 个 round（`WEBAGENT_MAX_AGENT_ROUNDS`）。

每轮一个 `AbortController`；`/stop` 触发 `abortCurrentTurn()`。

## 工具注册

- 内置工具：`src/agent/runtime/tools/builtins/` — 模块加载时注册。
- Capability 工具：`src/capabilities/tools/<id>/{manifest.json, handler.js}` — 懒加载；**与内置同名则跳过**（控制台 + JSONL 警告）。
- 工具目录经 `src/agent/tool-catalog.ts` 导出到浏览器 UI（emoji/图标）。

## 构建流水线

```
scripts/build-embed-runtime.mjs   → dist/agent-runtime/*.js
vite build                        → dist/assets/*
```

分块策略（`vite.config.ts`）：

| Chunk          | 内容                           |
|----------------|--------------------------------|
| `sqljs`        | sql.js + WASM                  |
| `xterm`        | @xterm/* terminal              |
| `nodebox`      | @codesandbox/nodebox（如使用） |
| `markdown`     | markdown-it                    |
| `icons`        | lucide-react                   |
| `react-vendor` | react, react-dom, scheduler    |
| `zustand`      | 状态库                         |

重型面板（`FilesPopup`、`MemoryTab`、`ProfileEditor`）使用 `React.lazy`，避免阻塞首屏。

## 从哪里入手

| 任务              | 起点                                             |
|-------------------|--------------------------------------------------|
| 添加工具          | `src/agent/runtime/tools/builtins/`              |
| 添加 capability 技能 | `src/capabilities/skills/<id>/SKILL.md`       |
| 修改 agent 循环   | `src/agent/runtime/turn.ts`                      |
| Turn judge        | `server/turn-judge/`, `models/turn-judge/`       |
| 添加频道          | `src/capabilities/channels/<id>/`                |
| 新 LLM 提供商     | `src/core/providers/<id>.json` + manifest        |
| UI 面板           | `src/ui/components/`                             |
| 持久化变更        | `src/core/profiles.ts` + 提升 `STORAGE_SCHEMA_VERSION` |
