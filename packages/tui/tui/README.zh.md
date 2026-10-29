---
description: "DeepSeek Harness 交互式终端用户界面，提供原始键盘处理、富文本渲染、提问与审批流程，以及确定性终端状态复原。"
kind: package-reference
---

# @deepseek-ai/dsh-tui

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tui` 为 DeepSeek Harness 提供交互式终端用户界面。它使用 raw 模式、括号粘贴、多行提示缓冲、字素感知 Unicode 列宽计算、有界回滚历史、助手流式更新、交互式用户提问选择，以及工具执行审批与拒绝，直接运行在用户终端模拟器内。它与 `@deepseek-ai/dsh-app-boot` 终端复原服务集成，在致命诊断前和退出过程中同步尽力复原终端。

## 目录

- [使用本包](#use-this-package)
- [配置](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过已安装 CLI 的 profile 在交互式终端中启动。启动器负责应用启动和退出；单独挂载本插件不会提供所需的 Agent 运行时。

```sh
dsh --profile tui
```

在 TUI 内使用 `/help`、`/new`、`/sessions`、`/resume <sessionId>`、`/model` 和 `/quit`。恢复会话是交互命令，不是启动器的 `--resume` 选项。标准输入与输出必须都是 TTY；管道执行使用既有 headless profile。

<a id="configuration"></a>
## 配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `locale` | `'zh' \| 'en'` | `zh` | 界面语言 |
| `maxScrollbackLines` | `integer` | `2000` | 保留行数；范围 10–100000 |
| `maxScrollbackLineLength` | `integer` | `4096` | 每行保留字符数；范围 10–65536 |
| `maxInputBytes` | `integer` | `32768` | 草稿字节数；范围 64–1048576 |
| `maxPasteBytes` | `integer` | `65536` | 粘贴缓冲字节数；范围 64–1048576 |
| `maxHistoryEntries` | `integer` | `500` | 输入历史条数；范围 10–10000 |
| `maxStreamAccumulatorChars` | `integer` | `32768` | 流式保留字符数；范围 256–1048576 |
| `redrawIntervalMs` | `integer` | `33` | 流式重绘间隔，毫秒；范围 10–1000 |

非法配置会报错，不会静默截断到范围内。默认值与范围由 [config.ts](src/config.ts) 维护。

<a id="model-experience"></a>
## Model Experience

None, as the TUI adds no model instruction text; model choices, ordinary user messages and interaction responses use the existing Agent services.

#### KV Cache effect

The interactive TUI adds nothing to the request prefix; it only submits user messages and interaction responses.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **要求交互式 TTY**——本插件需要交互式 TTY，不支持无头或管道化执行。
- **单一活跃会话**——当前 TUI 一次管理一个前台会话，通过命令切换会话。
- **平台验收**——本地 macOS PTY、安装产物原生/Node PTC 交互及 keyless Session replay 已通过独立评审。Linux 原生 PTY、Windows ConPTY、真实 provider 和生产发布尚未验证。见[验收记录](../../../.plans/feature-expansion-2026-10-24/codex-tui-acceptance.md)。
- **终端复原限制**——复原为尽力操作；SIGKILL、native abort 或 TTY 丢失时不能保证恢复。显式后台模式见 [CLI 说明](../../../apps/cli/README.zh.md)。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
