# `@deepseek-ai/dsh-tui-app`

[English](README.md) | 中文

`dsh-tui-app` 是交互式终端 profile 的内置 patch 层。它直接组合在 [`dsh-base`](../base/README.md) 之上，在 Host 进程内启动 [`dsh-tui`](../../ui/tui/README.md)，且不添加 Host gateway、Client runtime、浏览器传输、IPC 载体或网络监听器。

## 组合

该 patch 禁用共享 HMR 行，选择部署工具展示模式，添加 worker-thread code runtime，并在 TUI 行之前挂载 `tui-startup`。启动 provider 解析应用自有的 `--resume` 与初始任务参数；TUI 行通过惰性 Cordis 配置接收该值，且不会读取全局 argv。

本组合包有意排除 `dsh-client-app`：Ink 在同一个 Cordis 配置树内直接使用 Agent、Session、命令、审批、问题和工具展示 API。invariant 服务以及 `dsh-tui`、`dsh-tui-app` 配套入口检查实时 controller 的 Agent、交互 provider 和启动 provider 关系。

## 模型体验

本组合包提供终端部署 persona：编码 agent 会收到其模型、工作目录，以及用户正在通过 `dsh` 终端客户端交互这一事实。工具 schema 与其他模型可见内容来自 `dsh-base` 和选定的工具展示模式。

#### KV Cache 影响

终端 persona 在稳定的首个提示位置替换 base 包的空 persona。本组合包不添加传输专用的模型请求层。

## 限制

- 该 profile 要求 stdin 和 stdout 都可交互；自动化场景应通过 `dsh exec` 使用 headless profile。
- 本组合包只负责 Node 终端组合。未来的桌面壳层是复用共享应用状态的独立载体，不属于该 profile。
