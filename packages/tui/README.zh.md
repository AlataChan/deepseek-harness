---
description: "基于 base 的终端用户界面交互式应用层，提供终端内交互式会话循环。"
kind: "package-group"
---

# packages/tui

[English](README.md) | 中文

## 概述

tui 组为 DeepSeek Harness 提供交互式终端用户界面。它直接运行在用户的终端模拟器中，支持原始键盘输入、括号粘贴、多行编辑、字素感知列宽渲染、助手流式输出、交互式用户提问选择、工具调用审批与拒绝，以及尽力执行的终端状态复原。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tui`](tui/README.zh.md) | DeepSeek Harness 交互式终端用户界面 | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [终端子系统参考](../../docs/subsystems/terminal.zh.md)——终端会话生命周期、交互式按键流式传输以及清理约定。
- [Profile 管理](../../docs/subsystems/boot.zh.md)——`tui` profile 的组装与加载机制。
- [app-boot](../boot/app-boot/README.zh.md)——`tui` profile 如何组装与加载。
- [dsh-tui-bundle](../bundle/tui/README.zh.md)——在 `dsh-base` 之上组装 TUI 层的组合包。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
