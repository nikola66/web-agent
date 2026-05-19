<!-- i18n-sync: en@8293e87 2026-05-20 -->

# 面向 AI 编码代理的仓库指南

适用于在 `web-agent` 中工作的 Claude Code、Codex 等 AI 编码代理。

## 工程风格

- 做精准修复，非必要不增加代码行数。
- 变更或移除功能时，同一轮清理相关陈旧代码。
- 少写代码优于多写。
- 意图不清时先提问澄清。
- 能扩展现有模块时不要新建文件。
- 不要写描述「代码在做什么」的注释——只写非显而易见的「为什么」。

## 项目结构

架构上下文（运行时布局、IPC、存储层）见 `docs/zh-CN/ARCHITECTURE.md`。除非用户指定语言，否则以英文 canonical 文档为准。

关键入口：

- `src/main.tsx` — React 根
- `src/core/orchestrator.ts` — 代理生命周期
- `src/agent/adapter.ts` — 浏览器 UI 与嵌入式 Node 运行时桥接
- `src/agent/runtime/turn.ts` — 主 LLM 循环
- `src/agent/runtime/tools/registry.ts` — 内置与能力工具加载

`src/agent/runtime` 树**排除在 `tsc` 之外**（见 `tsconfig.json`）。该目录修改不会在构建时类型检查；依赖测试与运行时验证。

## 提交前

- `npx tsc -b --noEmit` 通过
- `npm test` 通过
- `npm run build` 成功；无新增过大 chunk
- UI 改动时在 `npm run dev` 中对相关面板做一次冒烟
