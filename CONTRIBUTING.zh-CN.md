<!-- i18n-sync: en@8293e87 2026-05-20 -->

**语言：** [English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md) · [Español](CONTRIBUTING.es.md) · [العربية](CONTRIBUTING.ar.md)

# 贡献指南

感谢为 Web Agent 做贡献。

## 原则

- 保持改动精准、克制。
- 非必要不增加复杂度。
- 在同一轮修改中清理因你的改动产生的陈旧代码。
- 保持项目的浏览器原生、本地优先、配置隔离设计。
- 不要提交按 profile 隔离的工作区镜像（`memory/`、`tmp/`、`knowledge-vault/`、`.webagent/`、SQLite 数据库等）：它们属于浏览器存储，已在 `.gitignore` 中列出。

## 开发环境

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
npm install
npm run dev
```

打开 `http://localhost:5173`。

## 常用命令

```bash
npm run dev
npm run build
npm run test
npm run test:browser
```

## 提交 Pull Request 之前

- 确认改动解决真实问题
- 保持 diff 聚焦
- 行为变更时更新文档；若涉及面向用户的文案，请同步更新英文及受影响的本地化文件（见 [docs/TRANSLATING.md](docs/TRANSLATING.md)）
- 影响运行时行为时添加或更新测试
- 避免无关重构

若涉及浏览器本地持久化、运行时隔离、上传、工具或 profile 状态，请在 PR 描述中清楚说明影响。

## 报告 Bug

在 GitHub 创建 issue，包含：

- 预期行为
- 实际行为
- 精确复现步骤
- 浏览器与操作系统
- 问题出现在托管演示、本地开发，还是两者皆有

安全敏感问题请使用 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)，不要公开 issue。

## Pull Request 风格

- 优先最小正确修复
- 匹配现有代码风格
- 删除因你的改动产生的无用 import、死分支与本地残留
- 面向用户的文案简洁、具体

## 贡献者文档

- [README.zh-CN.md](README.zh-CN.md) — [English](README.md) · [Español](README.es.md) · [العربية](README.ar.md)
- [docs/zh-CN/README.md](docs/zh-CN/README.md) — 文档索引
- [docs/zh-CN/CAPABILITIES.md](docs/zh-CN/CAPABILITIES.md)
- [docs/zh-CN/ARCHITECTURE.md](docs/zh-CN/ARCHITECTURE.md)
- [docs/zh-CN/agent-notes.md](docs/zh-CN/agent-notes.md)
- [docs/zh-CN/testing-checklist.md](docs/zh-CN/testing-checklist.md)
- [docs/GLOSSARY.md](docs/GLOSSARY.md) · [docs/TRANSLATING.md](docs/TRANSLATING.md)
