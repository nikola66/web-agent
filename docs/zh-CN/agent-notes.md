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

## 工具循环护栏

每轮确定性工具循环护栏（Hermes 风格）。完整环境变量见 [英文 agent-notes](../agent-notes.md#tool-loop-guardrails)。实现：`tool-loop-guardrails.ts`，集成于 `turn.ts`。

## 开放网络研究（Hermes 风格）

- 捆绑技能：`open-web-research` — 扇出 `web_search`，`web_fetch` 验证，回答前最低努力。
- 安全并行工具（`web_search`、`web_fetch`、`grep`、`read_file` 等）在同一助手轮中并发（上限 6）。
- 可选：`WEBAGENT_MAX_AGENT_ROUNDS=90` 用于长探索；在 Settings 配置浏览器代理搜索 API key — DuckDuckGo 回退对冷门查询较弱。
- Telegram 在频道轮活跃时每 90s 发送 `Still working…`。

## Profile

- JSON 存于 idb-keyval，键 `profiles:v1`。
- 适配器传入 `WEBAGENT_PROFILE_NAME`、`WEBAGENT_PERSONALITY`、`WEBAGENT_PROVIDER`、可选 `WEBAGENT_MODEL` 及 API key 环境变量。

## UI 字符串中的 ANSI

在 TypeScript 模板字面量中嵌入终端转义序列时，保持合法 JS 字符串（勿在换行处截断 `\x1b`）。
