---
kind: upgrade-guide
description: "终端所有权严格优先于后台脱离模式：存在活跃终端持有人时，即使设置了 DSH_DETACHED=1，SIGHUP 仍会恢复终端并以 129 退出。"
---

# 收到 SIGHUP 时终端所有权优先于后台脱离模式

[English](guide.md) | 中文

## 变更

本次变更新增显式 `DSH_DETACHED=1`，用于无终端 owner 的后台 profile，并为交互式 profile 连接同步终端复原。这不代表旧发布版本已存在 DSH_DETACHED 行为；未设置此选项的普通启动保留既有 SIGHUP 行为。

现在终端所有权严格优先于脱离执行模式：

- 当存在已注册的交互终端持有人时（`activeCount > 0`），收到 `SIGHUP` 始终会调用同步终端恢复（`restoreNow()`）并请求有界退出，状态码为 129（`128 + SIGHUP`）退出。
- `DSH_DETACHED=1` 仅在没有活跃终端持有人时（`activeCount === 0`）才会忽略 `SIGHUP`。

该优先级规则兼顾了 Node.js 引擎本身的机制（`src/node.cc` 中的 `node::ResetSignalHandlers()`）：Node.js 在启动阶段无条件将继承的信号处理重置为 `SIG_DFL`，必须通过运行时的协调逻辑同时保障脱离执行与终端的干净清理。

## 迁移

1. 对于无交互终端控制的 headless、后台守护进程或自动化 ACP 工作流，如需在挂断后存活，显式设置 `DSH_DETACHED=1`。由于这些场景注册的终端持有人为 0（`activeCount === 0`），启动器会在这些启动中忽略 `SIGHUP`。
2. 对于交互式终端会话（例如 `dsh --profile tui`），启动器在 SIGHUP 时同步尽力复原终端并请求状态码 129 退出。TTY 丢失、SIGKILL 或 native abort 时不能保证复原。
