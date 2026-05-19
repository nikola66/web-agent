<!-- i18n-sync: en@8293e87 2026-05-20 -->

# 模块化能力

Web Agent 支持受信任的仓库级能力目录。添加文件夹、重新构建后，宿主会将其复制到 `.webagent/capabilities/` 供运行时扫描。

## 内置工具

原生运行时工具：在 `src/agent/runtime/tools/builtins/<tool_name>.ts` 创建文件并导出 `defineTool(...)` 默认定义。`npm run build:embed-runtime` 会从这些文件重新生成内置索引与浏览器安全目录。

## 能力工具

创建 `src/capabilities/tools/<tool_id>/`：

- `manifest.json`
- `handler.ts`（仓库源码；`npm run build:embed-runtime` 会输出 `handler.js` 到 `dist/capabilities-embed/` 以便打包）

运行时复制的文件在 `.webagent/capabilities/` 下使用 **`handler.js`** 文件名。

`manifest.json`：

```json
{
  "id": "example_tool",
  "emoji": "🧩",
  "description": "Explain exactly what this tool does.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "value": { "type": "string" }
    },
    "required": ["value"],
    "additionalProperties": false
  },
  "requiresConfirmation": false
}
```

`handler.ts`（编译为 `handler.js`）：

```js
export async function run(args, ctx) {
  return { ok: true, value: args.value };
}
```

工具 id 须匹配 `/^[a-z][a-z0-9_]*$/`。能力工具不能覆盖内置工具 id。

## 提供商

创建 `src/capabilities/providers/<provider_id>/manifest.json`。

清单使用现有 OpenAI 兼容形状：`id`、`name`、`kind: "openai"`、`requiresUserApiKey`，以及可选 `model`、`apiKey`、`runtime` 字段。带 `runtime.fallbackBaseUrl` 的提供商会自动被 Vite LLM 代理允许。

## 频道

创建 `src/capabilities/channels/<channel_id>/`：

- `manifest.json`
- `runtime.ts`（编译为 `dist/capabilities-embed/` 中的 `runtime.js`）

`runtime.js` 导出 `start(deps)` 并返回 `{ stop() {} }`。V1 支持轮询式适配器。Telegram 以能力文件夹实现；旧工作区快照若无复制的能力文件则仍可通过遗留回退使用。

## 技能

创建 `src/capabilities/skills/<skill_id>/SKILL.md`。

捆绑技能与用户创建技能使用相同的 `SKILL.md` 校验。`.webagent/skills/` 中用户技能优先于同名捆绑技能。

## 验证

```bash
npm run build:embed-runtime
tsx --test tests/capability-loader.test.ts tests/tool-registry-catalog.test.ts
npm run build
```

运行时调用 `capability_list` 可检查已复制的能力文件夹。
