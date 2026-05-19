<!-- i18n-sync: en@8293e87 2026-05-20 -->

# 架构

`web-agent` 高层结构图。更新于 2026-05-18。

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

「代理」在浏览器标签页内的 Nodebox/WebContainer 沙箱中运行——不在服务器上。`src/agent/adapter.ts` 将其作为类 Node 进程启动，通过 stdout/stdin 通信。

### IPC 标记协议

嵌入式运行时无法直接 `fetch`（CORS / 无 origin）。HTTP 请求通过 stdout 写出帧标记：

```
<<<WEBAGENT_PROXY_REQ:<id>>>{"method":"POST","url":"…","headers":{…},"body":"…"}<<<END_WEBAGENT_PROXY_REQ>>>
```

`adapter.ts` 解析这些标记（约 834–900 行），经 `/api/proxy` 路由（开发：`vite.config.ts`；生产：`scripts/cors-proxy-server.mjs` 或 Caddy），再将响应写回 stdin：

```
<<<WEBAGENT_PROXY_RESP:<id>>>{"status":200,"body":"…"}<<<END_WEBAGENT_PROXY_RESP>>>
```

流式 LLM 响应使用相同帧格式（`src/agent/runtime/llm/streaming.ts` 中的 `ipcProxyStreamRequest`）。

## 存储层

| 层 | 后端 | 版本 | 用途 |
| --- | --- | --- | --- |
| Profiles | idb-keyval | envelope `{version,…}` | Profile CRUD（`src/core/profiles.ts`） |
| Credentials | idb-keyval | 按 key | PBKDF2 + AES-GCM API keys |
| Settings (UI) | idb-keyval | 无 | 侧栏宽度、主题等 |
| Workspace files | OPFS | 无 | WebContainer FS |
| Agent memory | sql.js (WASM) | 列迁移 | facts、learnings、jobs、snapshots |
| Debug log | OPFS JSONL | 无 | 工具调用、错误 |

## 代理循环

1. `src/core/orchestrator.ts` 启动 profile → `adapter.ts` 生成运行时。
2. 用户输入 → `src/agent/runtime/turn.ts:agentTurn()`。
3. `streamOpenAI()` 发起请求（直连 HTTP 或 IPC 帧）。
4. 解析流式块 → 提取工具调用。
5. `runTools()`（registry.ts）执行内置或能力工具。
6. 结果超过 10 KB → 写入工作区文件（内联上限 `MAX_TOOL_RESULT_INLINE_CHARS`）。
7. Loop Guard（`loop-guard.ts` + 浏览器 `supervisor/`）经 IPC 对最近消息打分并决定 continue / stop（适配器内 MiniLM NLI）。默认开启；通过 `.env` 中 `VITE_WEBAGENT_LOOP_GUARD*` 配置（见 `.env.example` 与 [agent-notes.md](agent-notes.md)）。
8. 每轮最多 64 轮（`WEBAGENT_MAX_AGENT_ROUNDS`）。

每轮使用 `AbortController`；`/stop` 触发 `abortCurrentTurn()`。

## 工具注册

- 内置：`src/agent/runtime/tools/builtins/` — 模块加载时注册。
- 能力工具：`src/capabilities/tools/<id>/{manifest.json, handler.js}` — 懒加载；**与内置同名则跳过**（控制台 + JSONL 警告）。
- 工具目录经 `src/agent/tool-catalog.ts` 导出到浏览器供 UI 使用 emoji/图标。

## 构建流水线

```
scripts/build-embed-runtime.mjs   → dist/agent-runtime/*.js
vite build                        → dist/assets/*
```

分块策略（`vite.config.ts`）：`sqljs`、`xterm`、`nodebox`、`markdown`、`icons`、`react-vendor`、`zustand`。

重面板（`FilesPopup`、`MemoryTab`、`ProfileEditor`）经 `React.lazy` 加载。

## 优先查阅

| 任务 | 起点 |
| --- | --- |
| 添加工具 | `src/agent/runtime/tools/builtins/` |
| 添加能力技能 | `src/capabilities/skills/<id>/SKILL.md` |
| 修改代理循环 | `src/agent/runtime/turn.ts` |
| 新频道 | `src/capabilities/channels/<id>/` |
| 新 LLM 提供商 | `src/core/providers/<id>.json` + manifest |
| UI 面板 | `src/ui/components/` |
| 持久化变更 | `src/core/profiles.ts` + 提升 `STORAGE_SCHEMA_VERSION` |
