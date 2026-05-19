<!-- i18n-sync: en@8293e87 2026-05-20 -->

# 代理说明（Web Agent 单运行时）

面向在 `src/agent/`、`src/runtimes/webcontainer/` 及 profile/工作区持久化上工作的贡献者。

## WebContainer 文件系统

WebContainer 使用分层虚拟文件系统。宿主页面挂载（`wc.mount`）落在挂载层；子进程可在进程层创建文件，可能遮蔽同路径挂载。

**本项目模式**

- 代理运行时从 **`dist/agent-runtime/*.js`**（`?raw`）导入，启动时写入 `/workspace/.webagent/*.js`（需先 `npm run build:embed-runtime`）。
- 运行时旁 Markdown（`HEARTBEAT.md` 等）仍通过 Vite 插件从 `./runtime/*.md?raw` 导入。
- 首次运行写入 `/workspace/AGENT.md`、`/workspace/USER.md`；Unicode emoji 库挂载为 `/workspace/EMOJIS.md`。
- `HOME=/tmp`，避免 Node 在只读挂载根目录写临时文件失败。

## OPFS 快照

工作区持久化路径：

`profiles/{profileId}/snapshot/workspace/...`

`restoreFilesystem(profileId)` 遍历该 OPFS 前缀并写回 WebContainer FS。

`saveWorkspaceSnapshot(profileId)` 在 WC 内运行简短 `node -e` 列出 `/workspace` 下所有文件，再读回 OPFS。

遗留 `snapshots/openclaw`、`snapshots/hermes` 由 `runLegacySnapshotMigration()`（`src/core/migrate.ts`）一次性删除。

## 代理运行时（`src/agent/runtime/` → `dist/agent-runtime/`）

- **源码：** `src/agent/runtime/**/*.ts`（import 使用 `.js` 以符合 Node ESM）。
- **输出：** `scripts/build-embed-runtime.mjs` 写入 `dist/agent-runtime/`。
- **浏览器包：** `src/agent/adapter.ts` 以 `?raw` 导入并在启动时写入 `/workspace/<profile>/.webagent/*.js`。
- **目标：** 嵌入式运行时（Nodebox）内 Node；保持 API 兼容。
- **LLM：** 原生 `fetch` 流式 — OpenAI 兼容 SSE 与 Anthropic SSE。
- **工具：** 模型输出 `<<<TOOL>>>{"name":"...","arguments":{...}}<<<END>>>`；代理从历史剥离并在进程内执行。

## Loop Guard

本地 **continue / stop / ask_user** 决策是唯一的运行时循环机制（旧版正则 auto-continue 已移除）。每步助手回复后，Nodebox 运行时请求浏览器适配器用 vendored MobileBERT MNLI 分类器（Transformers.js ONNX）对最近消息打分。ORT WASM 由 `/transformers-ort/` 提供；模型权重为 `/models/loop-guard/` 静态文件（`public/models/loop-guard/`，刷新：`npm run download:loop-guard-model`）。

本地开发用 [`.env.local`](../../.env.local)（gitignore；Vite 自动加载）。[`.env.example`](../../.env.example) 记录生产式默认值。Loop Guard 旋钮使用 `VITE_WEBAGENT_*` 前缀；`buildEnv()` 镜像为嵌入式运行时的 `WEBAGENT_*`。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `VITE_WEBAGENT_LOOP_GUARD` | `1` | `0` / `false` 禁用 Loop Guard（无 nudge 时停止）。 |
| `VITE_WEBAGENT_MAX_AUTO_CONTINUE_NUDGES` | `20` | 每用户轮 continue nudge 上限。 |
| `VITE_WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES` | `30` | 开放网络研究意图时更高上限。 |
| `VITE_WEBAGENT_LOOP_GUARD_MAX_MESSAGES` | `6` | NLI 前提包含的消息数。 |
| `VITE_WEBAGENT_LOOP_GUARD_STOP_THRESHOLD` | `0.62` | 「任务似已完成」分数。 |
| `VITE_WEBAGENT_LOOP_GUARD_ASK_USER_THRESHOLD` | `0.60` | 「应请用户澄清」分数。 |
| `VITE_WEBAGENT_LOOP_GUARD_CONTINUE_THRESHOLD` | `0.58` | 「应继续工作」分数。 |

阈值顺序：stop → ask_user → continue；均未达栏则 **stop**（安全默认）。

调试：`VITE_WEBAGENT_DEBUG_LOG=1`，在会话 JSONL 中查找 `turn_loop_guard` / `turn_loop_guard_nudge`。

**与 Loop Guard 分离：** `tool-failure-streak.ts` 会在单轮内因重复相同工具失败而停止（确定性 streak）。

## 开放网络研究（Hermes 风格）

- 捆绑技能：`open-web-research` — 扇出 `web_search`，`web_fetch` 验证，回答前最低努力。
- 安全并行工具（`web_search`、`web_fetch`、`grep`、`read_file` 等）在同一助手轮中并发（上限 6）。
- 研究轮使用更高 Loop Guard nudge 上限（`VITE_WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES`，默认 30）。
- 可选：`WEBAGENT_MAX_AGENT_ROUNDS=90` 用于长探索；在 Settings 配置浏览器代理搜索 API key — DuckDuckGo 回退对冷门查询较弱。
- Telegram 在频道轮活跃时每 90s 发送 `Still researching…`。

## Profile

- JSON 存于 idb-keyval，键 `profiles:v1`。
- 适配器传入 `WEBAGENT_PROFILE_NAME`、`WEBAGENT_PERSONALITY`、`WEBAGENT_PROVIDER`、可选 `WEBAGENT_MODEL` 及 API key 环境变量。

## UI 字符串中的 ANSI

在 TypeScript 模板字面量中嵌入终端转义序列时，保持合法 JS 字符串（勿在换行处截断 `\x1b`）。
