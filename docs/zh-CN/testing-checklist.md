<!-- i18n-sync: en@8293e87 2026-05-20 -->

# 手动测试清单 — Web Agent

## Profile

- [ ] 首次加载从内置名称池创建命名 profile
- [ ] 创建第二个 profile，自定义个性与强调色
- [ ] 代理**已停止**时切换活动 profile；重载后选择仍保留
- [ ] 无法删除最后一个 profile

## 启动 / 终端

- [ ] **Launch Web Agent** 在约 5 秒内出现粉色 `❯` 提示符（首次 WebContainer 启动可能更慢）
- [ ] 无 API key 时代理打印清晰错误并退出，UI 不崩溃
- [ ] 有效 key 下发送短消息；出现流式回复
- [ ] **Stop** 终止进程；状态栏回到 Stopped
- [ ] 调整终端大小；布局仍可用（PTY resize 不冻结标签页）

## 工具（冒烟）

在运行中的代理里要求其：

- [ ] 在 `/workspace` 下 `read_file` / `write_file`
- [ ] `list_dir` 或 `tree`
- [ ] `grep` 或 `find_files`
- [ ] `run_shell`（如 `echo test`）
- [ ] 对公开 `https://` URL 使用 `web_fetch`

## 持久化

- [ ] 在 `/workspace` 创建文件，**Stop**，重载页面，**Launch** — 该 profile 下文件仍在
- [ ] **Export workspace**（Workspaces 标签）下载 JSON
- [ ] （可选）将同一 JSON **Import** 到另一 profile

## 设置

- [ ] **Custom** 提供商：base URL + API key；代理解析 `CUSTOM_BASE_URL` / `CUSTOM_API_KEY`
