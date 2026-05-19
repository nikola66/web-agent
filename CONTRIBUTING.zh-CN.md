# 参与贡献

**语言：** [English](CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [简体中文](CONTRIBUTING.zh-CN.md) · [Deutsch](CONTRIBUTING.de.md)

感谢为 Web Agent 做贡献。

## 目录

- [原则](#原则)
- [开发环境](#开发环境)
- [常用命令](#常用命令)
- [提交 PR 之前](#提交-pr-之前)
- [报告 Bug](#报告-bug)
- [PR 风格](#pr-风格)
- [贡献者文档](#贡献者文档)

## 原则

- 改动尽量小而精准。
- 非必要不增加复杂度。
- 清理因你的改动产生的过时代码。
- 保持项目的浏览器原生、本地优先、配置隔离设计。
- 不要提交按 profile 镜像的工作区（`memory/`、`tmp/`、`knowledge-vault/`、`.webagent/`、SQLite 等）：它们属于浏览器存储，已在 `.gitignore` 中。

## 开发环境

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
git lfs install
git lfs pull
npm install
npm run dev
```

打开 `http://localhost:5173`。根目录 `npm install` 会通过 `postinstall` 安装 turn judge 侧车依赖。ONNX 模型位于 `models/turn-judge/` — 见 [docs/turn-judge.md](docs/turn-judge.md)。

## 常用命令

```bash
npm run dev
npm run build
npm run test
npm run judge:test
npm run test:browser
```

## 提交 PR 之前

- 确认改动解决真实问题
- 保持 diff 聚焦
- 行为变更时更新文档（先改英文源文件，用户可见文案变更时同步 `*.es.md`、`*.zh-CN.md`、`*.de.md`）
- 影响运行时时添加或更新测试
- 避免无关重构

若涉及浏览器本地持久化、运行时隔离、上传、工具或 profile 状态，请在 PR 描述中说明影响。

## 报告 Bug

在 GitHub 创建 issue，包含：

- 预期结果
- 实际结果
- 精确复现步骤
- 浏览器与操作系统
- 问题出现在托管演示、本地开发或两者

安全相关问题请使用 [SECURITY.md](SECURITY.md)，不要公开 issue。

## PR 风格

- 优先最小且正确的修复
- 匹配现有代码风格
- 删除无用 import、过时分支和本地残留
- 用户可见文案简洁具体

## 贡献者文档

- [README.zh-CN.md](README.zh-CN.md)
- [CAPABILITIES.md](CAPABILITIES.md)
- [docs/README.zh-CN.md](docs/README.zh-CN.md)
- [docs/ARCHITECTURE.zh-CN.md](docs/ARCHITECTURE.zh-CN.md)
- [docs/turn-judge.md](docs/turn-judge.md)
- [docs/agent-notes.md](docs/agent-notes.md)
- [docs/testing-checklist.md](docs/testing-checklist.md)
